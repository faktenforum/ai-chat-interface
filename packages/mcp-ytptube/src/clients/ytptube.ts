/**
 * YTPTube API client for adding URLs, polling status, and downloading audio files.
 * Uses GET /api/download/{filename} for file retrieval (no shared volume).
 */

import { logger } from '../utils/logger.ts';

const DEFAULT_POLL_INTERVAL_MS = 3000;

/** When true, log full API response bodies for debugging URL normalization and YTPTube behaviour. */
const DEBUG_API =
  process.env.MCP_YTPTUBE_DEBUG_API === '1' ||
  process.env.MCP_YTPTUBE_DEBUG_API === 'true' ||
  process.env.LOG_LEVEL === 'debug';

function logApiResponse(method: string, path: string, response: unknown): void {
  if (!DEBUG_API) return;
  const payload =
    typeof response === 'object' && response !== null && JSON.stringify(response).length > 2000
      ? { _truncated: true, _length: JSON.stringify(response).length, _preview: JSON.stringify(response).slice(0, 500) }
      : response;
  logger.debug({ method, path, response: payload }, 'YTPTube API response');

  // Log each item's top-level keys so we can see what YTPTube returns (e.g. video_id, extractor, id).
  const items: unknown[] = Array.isArray(response)
    ? response
    : response != null && typeof response === 'object' && Array.isArray((response as { items?: unknown[] }).items)
      ? (response as { items: unknown[] }).items
      : response != null && typeof response === 'object' && Array.isArray((response as { queue?: unknown[] }).queue)
        ? (response as { queue: unknown[] }).queue
        : response != null && typeof response === 'object' && Array.isArray((response as { history?: unknown[] }).history)
          ? (response as { history: unknown[] }).history
          : [];
  if (items.length > 0) {
    for (let i = 0; i < Math.min(items.length, 5); i++) {
      const item = items[i];
      if (item != null && typeof item === 'object') {
        const keys = Object.keys(item as object);
        const sample = keys.reduce((acc, k) => {
          const v = (item as Record<string, unknown>)[k];
          acc[k] = typeof v === 'string' && v.length > 80 ? `${v.slice(0, 80)}…` : v;
          return acc;
        }, {} as Record<string, unknown>);
        logger.debug({ method, path, itemIndex: i, keys, sample }, 'YTPTube API item (for video_id / extractor)');
      }
    }
  }
}
const DEFAULT_MAX_WAIT_MS = 60 * 60 * 1000; // 1 hour

/** Folder used by MCP tools for transcript and download jobs (single folder for all). */
export const MCP_DOWNLOAD_FOLDER = 'downloads';

export interface YTPTubeConfig {
  baseUrl: string;
  apiKey?: string;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

export interface HistoryItem {
  id?: string;
  _id?: string;
  url?: string;
  title?: string;
  status?: string;
  folder?: string;
  /** Filename of the downloaded file when status=finished (YTPTube History API). */
  filename?: string;
  template?: string;
  progress?: number;
  /** Platform video ID from YTPTube/yt-dlp (e.g. YouTube video id). */
  video_id?: string;
  /** Extractor name from yt-dlp (e.g. "youtube", "instagram", "TikTok"). */
  extractor?: string;
  /** Extractor key: "extractor video_id" format used by YTPTube in logs. */
  extractor_key?: string;
  /** YTPTube archive id: "extractor video_id" (e.g. "youtube jNQXAC9IVRw", "instagram DTN7YIrDD5D"). */
  archive_id?: string;
  [key: string]: unknown;
}

export interface PostHistoryBody {
  url: string;
  preset?: string;
  folder?: string;
  template?: string;
  cli?: string;
  cookies?: string;
  auto_start?: boolean;
}

export interface FileBrowserEntry {
  type: string;
  content_type?: string;
  name?: string;
  path?: string;
  is_file?: boolean;
  is_dir?: boolean;
  [key: string]: unknown;
}

export interface FileBrowserResponse {
  path: string;
  contents?: FileBrowserEntry[];
}

export function getAuthHeaders(apiKey?: string): Record<string, string> {
  if (!apiKey) return {};
  if (apiKey.includes(':')) {
    const b64 = Buffer.from(apiKey, 'utf8').toString('base64');
    return { Authorization: `Basic ${b64}` };
  }
  return { Authorization: `Basic ${apiKey}` };
}

/**
 * Build a public download URL for direct file access.
 * YTPTube does not expose an endpoint that returns a download URL; the only way is to construct
 * the URL per API spec: GET /api/download/{filename} with relative path (URL-encoded segments).
 * Auth: ?apikey=<base64_urlsafe(username:password)> per API.md.
 * Path: encode each segment so slashes remain literal (e.g. transcripts/filename.mp3).
 */
export function buildPublicDownloadUrl(
  relativePath: string,
  publicBaseUrl: string,
  apiKey?: string,
): string {
  const base = (publicBaseUrl ?? '').replace(/\/+$/, '');
  const segments = relativePath.replace(/^\//, '').split('/').filter(Boolean);
  const pathEnc = segments.map((s) => encodeURIComponent(s)).join('/');
  const url = `${base}/api/download/${pathEnc}`;
  if (!apiKey) return url;
  const raw = apiKey.includes(':') ? Buffer.from(apiKey, 'utf8').toString('base64') : apiKey;
  const base64url = raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${url}?apikey=${encodeURIComponent(base64url)}`;
}

export function ensureSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Build relative path from item.folder and item.filename when both are set (YTPTube finished items).
 * Returns e.g. "downloads/video.mp4" or "video.mp4"; leading slash stripped. Otherwise null.
 */
export function relativePathFromItem(item: HistoryItem): string | null {
  if (!item || typeof item !== 'object') return null;
  const fn = typeof (item as { filename?: string }).filename === 'string' ? (item as { filename: string }).filename.trim() : '';
  if (!fn) return null;
  const folder = typeof item.folder === 'string' ? item.folder.trim() : '';
  const path = folder ? `${folder}/${fn}` : fn;
  return path.replace(/^\/+/, '');
}

/** Audio file extensions (yt-dlp may output m4a, webm, opus, etc. besides mp3). */
const MEDIA_AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.webm', '.opus', '.aac', '.ogg', '.wav'];
const MEDIA_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v', '.flv'];

/** Derive media type from file path (extension). Used to prefer video vs audio item when multiple exist for same URL. */
export function getMediaTypeFromPath(path: string | null): 'audio' | 'video' | null {
  const lower = (path ?? '').toLowerCase();
  if (MEDIA_AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'audio';
  if (MEDIA_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'video';
  return null;
}

/** Progress 0–100 from YTPTube history item. */
export function formatProgress(item: HistoryItem): number {
  const p = item.progress;
  if (typeof p === 'number' && p >= 0 && p <= 100) return Math.round(p);
  return 0;
}

/**
 * POST /api/history – add one or more URLs. Returns array of { id?, status }.
 * We use single-item body and take the first returned id.
 */
export async function postHistory(
  config: YTPTubeConfig,
  body: PostHistoryBody,
): Promise<HistoryItem[]> {
  const base = ensureSlash(config.baseUrl);
  const res = await fetch(`${base}api/history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(config.apiKey),
    },
    body: JSON.stringify({ ...body, auto_start: body.auto_start ?? true }),
  });

  if (!res.ok) {
    const text = await res.text();
    let err: string;
    try {
      const j = JSON.parse(text) as { error?: string };
      err = j.error ?? text;
    } catch {
      err = text || res.statusText;
    }
    throw new Error(`YTPTube POST /api/history failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as unknown;
  logApiResponse('POST', 'api/history', data);

  // Normalize: YTPTube may return array, single item, or { items: [...] } / { queue: [...] }
  if (Array.isArray(data)) return data as HistoryItem[];
  if (data != null && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as HistoryItem[];
    if (Array.isArray(obj.queue)) return obj.queue as HistoryItem[];
    if (Array.isArray(obj.history)) return obj.history as HistoryItem[];
    if (typeof obj.id !== 'undefined' || typeof (obj as { _id?: unknown })._id !== 'undefined') {
      return [obj as HistoryItem];
    }
  }
  return [];
}

/** Response shape of GET /api/history (legacy type=all or no type, or paginated type=queue/done). */
export interface GetHistoryResponse {
  queue?: HistoryItem[];
  history?: HistoryItem[];
  items?: HistoryItem[];
  pagination?: unknown;
}

/** Response item from POST /api/yt-dlp/archive_id/ – canonical archive_id for a URL (any platform). */
export interface ArchiveIdResult {
  index: number;
  url: string;
  id: string | null;
  ie_key: string | null;
  archive_id: string | null;
  error: string | null;
}

/**
 * POST /api/yt-dlp/archive_id/ – get archive_id (and ie_key, id) for URLs without adding to queue.
 * Use when URL has no canonicalVideoKey or when URL-based match fails (e.g. Facebook, Vimeo).
 */
export async function getArchiveIdForUrls(
  config: YTPTubeConfig,
  urls: string[],
): Promise<ArchiveIdResult[]> {
  const base = ensureSlash(config.baseUrl);
  const res = await fetch(`${base}api/yt-dlp/archive_id/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(config.apiKey),
    },
    body: JSON.stringify(urls),
  });

  if (!res.ok) {
    const text = await res.text();
    let err: string;
    try {
      const j = JSON.parse(text) as { error?: string };
      err = j.error ?? text;
    } catch {
      err = text || res.statusText;
    }
    throw new Error(`YTPTube POST /api/yt-dlp/archive_id/ failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as ArchiveIdResult[];
  logApiResponse('POST', 'api/yt-dlp/archive_id/', data);
  return Array.isArray(data) ? data : [];
}

/** Normalize YTPTube archive_id (e.g. "Facebook 1678716196448181") to key format used by canonicalKeyFromItem. */
export function normalizeArchiveIdToKey(archiveId: string | null | undefined): string | null {
  if (typeof archiveId !== 'string' || !archiveId.trim()) return null;
  const normalized = archiveId.trim().replace(/\s+/g, ':').toLowerCase();
  return normalized.includes(':') ? normalized : null;
}

/**
 * GET /api/yt-dlp/url/info – metadata for a URL without adding to queue.
 * Returns title, duration, extractor, thumbnail, etc. (yt-dlp info dict).
 */
export interface UrlInfoResponse {
  title?: string;
  duration?: number;
  extractor?: string;
  thumbnail?: string;
  /** Available subtitles (lang code -> format list) from yt-dlp info. */
  subtitles?: Record<string, unknown>;
  /** Automatic captions (lang code -> format list) from yt-dlp info. */
  automatic_captions?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function getUrlInfo(config: YTPTubeConfig, videoUrl: string): Promise<UrlInfoResponse> {
  const base = ensureSlash(config.baseUrl);
  const enc = encodeURIComponent(videoUrl);
  const res = await fetch(`${base}api/yt-dlp/url/info?url=${enc}`, {
    headers: getAuthHeaders(config.apiKey),
  });

  if (!res.ok) {
    const text = await res.text();
    let err: string;
    try {
      const j = JSON.parse(text) as { error?: string };
      err = j.error ?? text;
    } catch {
      err = text || res.statusText;
    }
    throw new Error(`YTPTube GET /api/yt-dlp/url/info failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as UrlInfoResponse;
  logApiResponse('GET', 'api/yt-dlp/url/info', data);
  return data;
}

/**
 * GET /api/history – queue and history. Use to resolve item by URL.
 * Supports legacy { queue, history } and paginated { items }.
 */
export async function getHistory(config: YTPTubeConfig): Promise<GetHistoryResponse> {
  const base = ensureSlash(config.baseUrl);
  const res = await fetch(`${base}api/history`, {
    headers: getAuthHeaders(config.apiKey),
  });

  if (!res.ok) {
    const text = await res.text();
    let err: string;
    try {
      const j = JSON.parse(text) as { error?: string };
      err = j.error ?? text;
    } catch {
      err = text || res.statusText;
    }
    throw new Error(`YTPTube GET /api/history failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as GetHistoryResponse;
  logApiResponse('GET', 'api/history', data);
  return data;
}

/**
 * GET /api/history?type=queue&per_page=200 – queue only. Use after POST to resolve new item by URL.
 */
export async function getHistoryQueue(config: YTPTubeConfig): Promise<HistoryItem[]> {
  const base = ensureSlash(config.baseUrl);
  const res = await fetch(`${base}api/history?type=queue&per_page=200`, {
    headers: getAuthHeaders(config.apiKey),
  });

  if (!res.ok) {
    const text = await res.text();
    let err: string;
    try {
      const j = JSON.parse(text) as { error?: string };
      err = j.error ?? text;
    } catch {
      err = text || res.statusText;
    }
    throw new Error(`YTPTube GET /api/history?type=queue failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { queue?: HistoryItem[]; history?: HistoryItem[]; items?: HistoryItem[] };
  logApiResponse('GET', 'api/history?type=queue', data);
  if (Array.isArray(data.items)) return data.items;
  const queue = data.queue ?? [];
  return queue;
}

/**
 * GET /api/history?type=done&per_page=200 – history (done) only. Use when resolving by URL and item may be finished.
 */
export async function getHistoryDone(config: YTPTubeConfig): Promise<HistoryItem[]> {
  const base = ensureSlash(config.baseUrl);
  const res = await fetch(`${base}api/history?type=done&per_page=200`, {
    headers: getAuthHeaders(config.apiKey),
  });

  if (!res.ok) {
    const text = await res.text();
    let err: string;
    try {
      const j = JSON.parse(text) as { error?: string };
      err = j.error ?? text;
    } catch {
      err = text || res.statusText;
    }
    throw new Error(`YTPTube GET /api/history?type=done failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { queue?: HistoryItem[]; history?: HistoryItem[]; items?: HistoryItem[] };
  logApiResponse('GET', 'api/history?type=done', data);
  if (Array.isArray(data.items)) return data.items;
  const history = data.history ?? [];
  return history;
}

/**
 * Canonical key for a video URL: same key => same video.
 * Based on yt-dlp extractor patterns for major platforms.
 * - YouTube: "youtube:" + video ID (shorts/watch/youtu.be/embed/v/e)
 * - Instagram: "instagram:" + media ID (reel/p/tv path segment)
 * - TikTok: "tiktok:" + video ID (numeric)
 * - Twitter/X: "twitter:" + status ID (numeric)
 * - Vimeo: "vimeo:" + video ID (numeric)
 * - Twitch: "twitch:" + video/clip ID
 * - Facebook: "facebook:" + video ID (numeric)
 * - Douyin: "douyin:" + video ID (numeric)
 * - Reddit: "reddit:" + post ID (from comments URL)
 * - Dailymotion: "dailymotion:" + video ID
 * - Bilibili: "bilibili:" + video ID (BV/AV format)
 * - Rumble: "rumble:" + video ID
 * - SoundCloud: "soundcloud:" + uploader/title slug
 * - BitChute: "bitchute:" + video ID
 * - 9GAG: "9gag:" + gag ID
 * - Streamable: "streamable:" + video ID
 * - Wistia: "wistia:" + media ID (10-char)
 * - PeerTube: "peertube:" + host + UUID
 * - Bandcamp: "bandcamp:" + uploader/track slug
 * - Odysee/LBRY: "lbry:" + claim ID (hex)
 * - VK: "vk:" + owner_id_video_id
 * - Coub: "coub:" + video ID
 * - Mixcloud: "mixcloud:" + user/track slug
 * - Imgur: "imgur:" + media ID
 * - Naver TV: "naver:" + video ID
 * - Youku: "youku:" + video ID
 * - Zhihu: "zhihu:" + zvideo ID
 * - TED: "ted:" + talk slug
 * - Dumpert: "dumpert:" + media ID
 * - Weibo: "weibo:" + status ID
 * - archive.org: "archiveorg:" + details ID
 * - Rutube: "rutube:" + video ID (32-char)
 * - TwitCasting: "twitcasting:" + movie ID
 * - Telegram: "telegram:" + channel/message ID
 * - Dropbox: "dropbox:" + file ID
 * - Cloudflare Stream: "cloudflarestream:" + video ID
 * - XHamster: "xhamster:" + video ID
 * - XVideos: "xvideos:" + video ID
 * - Pornhub: "pornhub:" + viewkey
 * - Kick: "kick:" + VOD UUID or clip ID
 * - Nebula: "nebula:" + video slug
 * - Newgrounds: "newgrounds:" + numeric ID (audio/listen, portal/view)
 * - Floatplane: "floatplane:" + post ID
 * - CDA (cda.pl): "cda:" + video ID
 * - Utreon/Playeur: "utreon:" + slug
 * - Likee: "likee:" + video ID
 * - Iwara: "iwara:" + video ID
 * - EbaumsWorld: "ebaumsworld:" + numeric ID
 * - Odnoklassniki (OK.ru): "okru:" + video ID
 * - Dropout: "dropout:" + video slug
 * - CuriosityStream: "curiositystream:" + numeric ID
 * - Bandlab: "bandlab:" + track/post/revision ID
 * - Gettr: "gettr:" + post/streaming ID
 * - Minds: "minds:" + media ID
 * - Aparat: "aparat:" + video hash
 * - AcFun: "acfun:" + ac ID
 * - XNXX: "xnxx:" + video ID
 * - DrTuber: "drtuber:" + numeric ID
 * - Dailymail (video): "dailymail:" + numeric ID
 * - Bluesky: "bluesky:" + handle:post ID
 * - Flickr: "flickr:" + photo ID
 * - Others: normalized URL (origin + pathname, no query, trailing slash stripped)
 *
 * URL sanitization (yt-dlp style): protocol-relative URLs (//...) get https:;
 * common typos (httpss://, rmtp://) are fixed before parsing.
 */

/**
 * Sanitize URL before canonical key extraction (from yt-dlp sanitize_url).
 * - Protocol-relative URLs (//example.com) → https://example.com
 * - Common typos: httpss:// → https://, rmtp(s|e):// → rtmp\1://
 */
function sanitizeUrlForCanonical(url: string): string | null {
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  if (/^httpss:\/\//i.test(url)) return url.replace(/^httpss:\/\//i, 'https://');
  if (/^rmtp([es]?):\/\//i.test(url)) return url.replace(/^rmtp([es]?):\/\//i, 'rtmp$1://');
  return url;
}

export function canonicalVideoKey(url: string): string | null {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return null;

  const sanitized = sanitizeUrlForCanonical(trimmed);
  if (!sanitized) return null;

  try {
    const parsed = new URL(sanitized);
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = parsed.pathname.replace(/\/$/, '') || '/';

    // YouTube: various forms → youtube:VIDEO_ID
    if (hostname === 'youtube.com' || hostname === 'youtu.be') {
      let videoId: string | null = null;
      if (hostname === 'youtu.be') {
        videoId = pathname.slice(1) || null;
      } else if (pathname.startsWith('/shorts/')) {
        videoId = pathname.slice(8) || null;
      } else if (pathname.startsWith('/embed/')) {
        videoId = pathname.slice(7) || null;
      } else if (pathname.startsWith('/v/')) {
        videoId = pathname.slice(3) || null;
      } else if (pathname.startsWith('/e/')) {
        videoId = pathname.slice(3) || null;
      } else if (pathname === '/watch') {
        videoId = parsed.searchParams.get('v');
      }
      // YouTube video IDs are always 11 characters (alphanumeric, dash, underscore)
      if (videoId && /^[0-9A-Za-z_-]{11}$/.test(videoId)) {
        return `youtube:${videoId}`;
      }
    }

    // Instagram: /reel/ID, /p/ID, /tv/ID → instagram:ID (hostname already normalized, no www)
    if (hostname === 'instagram.com') {
      const m = pathname.match(/^\/(reel|p|tv)\/([^/]+)/);
      if (m) return `instagram:${m[2]}`;
    }

    // TikTok: /@user/video/ID, /video/ID, or /t/ID (short links) → tiktok:ID
    if (hostname === 'tiktok.com' || hostname === 'vm.tiktok.com' || hostname === 'vt.tiktok.com') {
      // Short links: /t/ID
      if (hostname === 'vm.tiktok.com' || hostname === 'vt.tiktok.com') {
        const shortId = pathname.slice(1);
        if (shortId) return `tiktok:${shortId}`;
      }
      // Regular video URLs: /@user/video/ID or /video/ID
      const m = pathname.match(/\/video\/(\d+)/);
      if (m) return `tiktok:${m[1]}`;
    }

    // Douyin (Chinese TikTok): /video/ID → douyin:ID
    if (hostname === 'douyin.com') {
      const m = pathname.match(/\/video\/(\d+)/);
      if (m) return `douyin:${m[1]}`;
    }

    // Twitter/X: /status/ID, /i/videos/ID, or /i/cards/tfw/v1/ID → twitter:ID
    if (hostname === 'twitter.com' || hostname === 'x.com' || hostname === 'mobile.twitter.com') {
      // /status/ID or /i/web/status/ID
      let statusMatch = pathname.match(/\/(?:i\/web\/)?status\/(\d+)/);
      if (statusMatch) return `twitter:${statusMatch[1]}`;
      // /i/videos/ID or /i/videos/tweet/ID
      let videosMatch = pathname.match(/\/i\/videos(?:\/tweet)?\/(\d+)/);
      if (videosMatch) return `twitter:${videosMatch[1]}`;
      // /i/cards/tfw/v1/ID
      let cardsMatch = pathname.match(/\/i\/cards\/tfw\/v1\/(\d+)/);
      if (cardsMatch) return `twitter:${cardsMatch[1]}`;
    }

    // Vimeo: /ID (numeric) → vimeo:ID
    if (hostname === 'vimeo.com' || hostname === 'player.vimeo.com') {
      // Main pattern: /ID where ID is numeric
      const numericMatch = pathname.match(/^\/(\d+)(?:\/|$)/);
      if (numericMatch) return `vimeo:${numericMatch[1]}`;
      // On-demand: /ondemand/.../ID
      const ondemandMatch = pathname.match(/\/ondemand\/[^/]+\/([^/?#]+)/);
      if (ondemandMatch) return `vimeo:${ondemandMatch[1]}`;
    }

    // Twitch: /videos/ID or /clip/ID → twitch:ID
    if (hostname === 'twitch.tv' || hostname === 'go.twitch.tv' || hostname === 'm.twitch.tv' || hostname === 'clips.twitch.tv') {
      // Videos: /videos/ID or /user/video/ID
      const videoMatch = pathname.match(/\/(?:videos|video)\/(\d+)/);
      if (videoMatch) return `twitch:${videoMatch[1]}`;
      // Clips: /clip/ID or clips.twitch.tv/ID
      const clipMatch = pathname.match(/\/(?:clip\/)?([^/?#]+)/);
      if (clipMatch && hostname === 'clips.twitch.tv') {
        return `twitch:clip:${clipMatch[1]}`;
      }
      if (pathname.includes('/clip/')) {
        const clipPathMatch = pathname.match(/\/clip\/([^/?#]+)/);
        if (clipPathMatch) return `twitch:clip:${clipPathMatch[1]}`;
      }
    }

    // Facebook: /reel/ID, /watch?v=ID, or /videos/ID (www/m/facebook.com, fb.com, fb.watch) → facebook:ID
    // YTPTube/yt-dlp often store reel URLs as m.facebook.com/watch/?v=ID; we must match that for get_status(video_url).
    const fbHost =
      hostname === 'facebook.com' ||
      hostname === 'm.facebook.com' ||
      hostname === 'fb.com' ||
      hostname === 'fb.watch';
    if (fbHost) {
      const reelMatch = pathname.match(/\/reel\/(\d+)/);
      if (reelMatch) return `facebook:${reelMatch[1]}`;
      if (pathname === '/watch' || pathname === '/watch/') {
        const v = parsed.searchParams.get('v');
        if (v && /^\d+$/.test(v)) return `facebook:${v}`;
      }
      const videosMatch = pathname.match(/\/videos\/(\d+)/);
      if (videosMatch) return `facebook:${videosMatch[1]}`;
    }

    // Reddit: /r/subreddit/comments/ID/... → reddit:ID
    if (hostname === 'reddit.com' || hostname.endsWith('.reddit.com') || hostname === 'redd.it') {
      // /r/subreddit/comments/ID/... or /user/username/comments/ID/...
      const commentsMatch = pathname.match(/\/(?:r|user)\/[^/]+\/comments\/([^/?#&]+)/);
      if (commentsMatch) return `reddit:${commentsMatch[1]}`;
    }

    // Dailymotion: /video/ID or dai.ly/ID → dailymotion:ID
    if (hostname === 'dailymotion.com' || hostname.endsWith('.dailymotion.com') || hostname === 'dai.ly') {
      if (hostname === 'dai.ly') {
        const shortId = pathname.slice(1);
        if (shortId) return `dailymotion:${shortId}`;
      }
      // /video/ID or /embed/video/ID
      const videoMatch = pathname.match(/\/(?:embed\/)?video\/([^/?_&#]+)/);
      if (videoMatch) {
        // Dailymotion IDs typically start with 'x' followed by alphanumeric
        const id = videoMatch[1].split('_')[0]; // Remove trailing title slug
        return `dailymotion:${id}`;
      }
    }

    // Bilibili: /video/BV... or /video/av... → bilibili:BV... or bilibili:av...
    const bilibiliHostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (bilibiliHostname === 'player.bilibili.com' && pathname === '/player.html') {
      const aid = parsed.searchParams.get('aid');
      if (aid) return `bilibili:av${aid}`;
    }
    if (bilibiliHostname === 'bilibili.com' || bilibiliHostname === 'bilibili.tv' || bilibiliHostname === 'biliintl.com') {
      // /video/BV... or /video/av... (case-insensitive)
      const bvMatch = pathname.match(/\/video\/([aAbB][vV][^/?#&]+)/i);
      if (bvMatch) {
        const id = bvMatch[1].toUpperCase();
        return `bilibili:${id}`;
      }
      // /video/av... (legacy format)
      const avMatch = pathname.match(/\/video\/av(\d+)/i);
      if (avMatch) return `bilibili:av${avMatch[1]}`;
    }

    // Rumble: /vID or /embed/ID → rumble:ID
    if (hostname === 'rumble.com') {
      // /embed/ID or /embed/prefix.ID
      const embedMatch = pathname.match(/\/embed\/(?:[0-9a-z]+\.)?([0-9a-z]+)/);
      if (embedMatch) return `rumble:${embedMatch[1]}`;
      // /vID (main video URLs)
      const videoMatch = pathname.match(/^\/(v[^/?#]+)/);
      if (videoMatch) {
        // Remove .html extension if present
        const id = videoMatch[1].replace(/\.html$/, '');
        return `rumble:${id}`;
      }
    }

    // SoundCloud: /uploader/title → soundcloud:uploader/title
    if (hostname === 'soundcloud.com' || hostname === 'm.soundcloud.com') {
      // Main pattern: /uploader/title (excluding special paths like tracks/, sets/, etc.)
      const scMatch = pathname.match(/^\/([\w\d-]+)\/([\w\d-]+)(?:\/([^/?#]+))?(?:\?|$|#)/);
      if (scMatch) {
        const uploader = scMatch[1];
        const title = scMatch[2];
        const skipPaths = ['tracks', 'albums', 'sets', 'reposts', 'likes', 'spotlight', 'comments'];
        if (!skipPaths.includes(title)) {
          return `soundcloud:${uploader}/${title}`;
        }
      }
    }

    // BitChute: /video/ID, /embed/ID → bitchute:ID
    if (hostname === 'bitchute.com' || hostname === 'old.bitchute.com') {
      const bcMatch = pathname.match(/\/(?:video|embed|torrent\/[^/]+)\/([^/?#&]+)/);
      if (bcMatch) return `bitchute:${bcMatch[1]}`;
    }

    // 9GAG: /gag/ID → 9gag:ID
    if (hostname === '9gag.com') {
      const gagMatch = pathname.match(/\/gag\/([^/?#&]+)/);
      if (gagMatch) return `9gag:${gagMatch[1]}`;
    }

    // Streamable: /ID, /e/ID, /s/ID → streamable:ID
    if (hostname === 'streamable.com') {
      const streamMatch = pathname.match(/^\/(?:e\/|s\/)?([\w]+)$/);
      if (streamMatch) return `streamable:${streamMatch[1]}`;
    }

    // Wistia: /embed/iframe/ID, /medias/ID (10-char alphanumeric) → wistia:ID
    if (hostname === 'wistia.com' || hostname === 'wistia.net' || hostname.endsWith('.wistia.com') || hostname.endsWith('.wistia.net')) {
      const wistiaMatch = pathname.match(/\/(?:iframe|medias)\/([a-z0-9]{10})/);
      if (wistiaMatch) return `wistia:${wistiaMatch[1]}`;
    }

    // PeerTube: /videos/watch/ID, /videos/embed/ID, /w/ID (UUID) → peertube:host:ID
    const peertubePath = pathname.includes('/videos/watch/') || pathname.includes('/videos/embed/') || pathname.startsWith('/w/');
    if (peertubePath) {
      const uuidMatch = pathname.match(/(?:\/videos\/(?:watch|embed)|\/w)\/([\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12}|[\da-zA-Z]{22})/);
      if (uuidMatch) {
        // Only treat as PeerTube if path is /videos/... or host looks like PeerTube (e.g. framatube.org, peertube.tv)
        if (pathname.includes('/videos/') || /peertube|framatube|tube\.|\.tube\b/.test(hostname)) {
          return `peertube:${hostname}:${uuidMatch[1]}`;
        }
      }
    }

    // Bandcamp: subdomain.bandcamp.com/track/slug → bandcamp:subdomain:slug
    if (hostname.endsWith('.bandcamp.com') && !hostname.startsWith('www.')) {
      const bcTrackMatch = pathname.match(/^\/track\/([^/?#&]+)/);
      if (bcTrackMatch) {
        const subdomain = hostname.replace(/\.bandcamp\.com$/, '');
        return `bandcamp:${subdomain}:${bcTrackMatch[1]}`;
      }
    }

    // Odysee/LBRY: odysee.com, lbry.tv — @channel:cid/name:claim_id or $/video/... → lbry:claim_id
    if (hostname === 'odysee.com' || hostname === 'lbry.tv') {
      // $/video/name or $/embed/... — claim_id often in redirect; path has name
      if (pathname.startsWith('/$/video/') || pathname.startsWith('/$/embed/')) {
        const slug = pathname.replace(/^\/\$\/video\/|\/\$\/embed\/?/, '').split('/')[0];
        if (slug) return `lbry:${hostname}:${slug}`;
      }
      // @channel:channel_id/Video-Name:claim_id — extract last :claim_id (hex)
      const claimMatch = pathname.match(/:([0-9a-f]{1,40})$/);
      if (claimMatch) return `lbry:${claimMatch[1]}`;
    }

    // VK: /video owner_id_video_id or /video?z=video-owner_id_video_id → vk:owner_id_video_id
    if (hostname === 'vk.com' || hostname === 'vk.ru' || hostname === 'm.vk.com' || hostname === 'vksport.vk.com') {
      const zParam = parsed.searchParams.get('z');
      if (zParam && zParam.startsWith('video')) {
        const vkFromZ = zParam.match(/video(-?\d+_\d+)/);
        if (vkFromZ) return `vk:${vkFromZ[1]}`;
      }
      const vkPathMatch = pathname.match(/\/(?:video|clip)(-?\d+_\d+)/);
      if (vkPathMatch) return `vk:${vkPathMatch[1]}`;
    }

    // Coub: /view/ID, /embed/ID, /coubs/ID → coub:ID
    if (hostname === 'coub.com') {
      const coubMatch = pathname.match(/\/(?:view|embed|coubs)\/([\da-z]+)/);
      if (coubMatch) return `coub:${coubMatch[1]}`;
    }

    // Mixcloud: /user/track (exclude stream, uploads, favorites, playlists) → mixcloud:user/track
    if (hostname === 'mixcloud.com' || hostname === 'm.mixcloud.com' || hostname === 'beta.mixcloud.com') {
      const mixMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
      if (mixMatch) {
        const [, user, track] = mixMatch;
        const skip = ['stream', 'uploads', 'favorites', 'listens', 'playlists'];
        if (!skip.includes(track)) return `mixcloud:${user}/${track}`;
      }
    }

    // Imgur: /ID (single media; exclude /a/, /gallery/, /t/) → imgur:ID
    if (hostname === 'imgur.com' || hostname === 'i.imgur.com') {
      if (!pathname.startsWith('/a/') && !pathname.startsWith('/gallery/') && !pathname.startsWith('/t/') && !pathname.startsWith('/topic/') && !pathname.startsWith('/r/')) {
        const imgurMatch = pathname.match(/^\/(?:[^/]+-)?([a-zA-Z0-9]+)\/?$/);
        if (imgurMatch) return `imgur:${imgurMatch[1]}`;
      }
    }

    // Naver TV: tv.naver.com/v/ID, /embed/ID → naver:ID
    if (hostname === 'tv.naver.com' || hostname === 'tvcast.naver.com' || hostname === 'm.tv.naver.com') {
      const naverMatch = pathname.match(/\/(?:v|embed)\/(\d+)/);
      if (naverMatch) return `naver:${naverMatch[1]}`;
    }

    // Youku: v.youku.com/v_show/id_ID, player.youku.com/.../ID → youku:ID
    if (hostname === 'v.youku.com' || hostname === 'player.youku.com' || hostname === 'play.youku.com' || hostname === 'video.tudou.com') {
      const youkuIdMatch = pathname.match(/(?:v_show\/id_|player\.php\/sid\/|v\/)([A-Za-z0-9]+)/);
      if (youkuIdMatch) return `youku:${youkuIdMatch[1]}`;
    }
    if (hostname === 'youku.com') {
      const youkuShowMatch = pathname.match(/\/v_show\/id_([A-Za-z0-9]+)/);
      if (youkuShowMatch) return `youku:${youkuShowMatch[1]}`;
    }

    // Zhihu: zhihu.com/zvideo/ID → zhihu:ID
    if (hostname === 'zhihu.com') {
      const zhihuMatch = pathname.match(/\/zvideo\/(\d+)/);
      if (zhihuMatch) return `zhihu:${zhihuMatch[1]}`;
    }

    // TED: ted.com/talks/slug, embed.ted.com/talks/slug → ted:slug
    if (hostname === 'ted.com' || hostname === 'embed.ted.com' || hostname === 'www.ted.com') {
      const tedMatch = pathname.match(/\/talks\/([\w-]+)/);
      if (tedMatch) return `ted:${tedMatch[1]}`;
    }

    // Dumpert: dumpert.nl/mediabase/ID, /embed/ID, /item/ID → dumpert:ID
    if (hostname === 'dumpert.nl' || hostname === 'legacy.dumpert.nl') {
      const dumpertMatch = pathname.match(/\/(?:mediabase|embed|item)\/([0-9]+[/_][0-9a-zA-Z]+)/);
      if (dumpertMatch) return `dumpert:${dumpertMatch[1]}`;
    }

    // Weibo: weibo.com/uid/status_id or m.weibo.cn/status/status_id → weibo:status_id
    if (hostname === 'weibo.com' || hostname === 'm.weibo.cn') {
      const weiboStatusMatch = pathname.match(/\/(?:status|detail)\/([a-zA-Z0-9]+)/);
      if (weiboStatusMatch) return `weibo:${weiboStatusMatch[1]}`;
      const weiboUrlMatch = pathname.match(/^\/\d+\/([a-zA-Z0-9]+)/);
      if (weiboUrlMatch) return `weibo:${weiboUrlMatch[1]}`;
    }
    if (hostname === 'video.weibo.com' && parsed.searchParams.get('fid')) {
      const fid = parsed.searchParams.get('fid');
      if (fid) return `weibo:${fid}`;
    }

    // archive.org: archive.org/details/ID, /embed/ID → archiveorg:ID
    if (hostname === 'archive.org' || hostname === 'www.archive.org') {
      const archiveMatch = pathname.match(/\/(?:details|embed)\/([^/?#]+)/);
      if (archiveMatch) return `archiveorg:${archiveMatch[1]}`;
    }

    // Rutube: rutube.ru/video/32char, /embed/32char → rutube:ID
    if (hostname === 'rutube.ru') {
      const rutubeMatch = pathname.match(/\/(?:video(?:\/private)?|embed|play\/embed)\/([\da-z]{32})/);
      if (rutubeMatch) return `rutube:${rutubeMatch[1]}`;
    }

    // TwitCasting: twitcasting.tv/user/movie/ID or /twplayer/ID → twitcasting:ID
    if (hostname.endsWith('twitcasting.tv')) {
      const twitMatch = pathname.match(/\/(?:movie|twplayer)\/(\d+)/);
      if (twitMatch) return `twitcasting:${twitMatch[1]}`;
    }

    // Telegram: t.me/channel/ID → telegram:channel:ID
    if (hostname === 't.me') {
      const tgMatch = pathname.match(/^\/([^/]+)\/(\d+)/);
      if (tgMatch) return `telegram:${tgMatch[1]}:${tgMatch[2]}`;
    }

    // Dropbox: dropbox.com/s/ID, /sh/ID → dropbox:ID
    if (hostname === 'dropbox.com' || hostname === 'www.dropbox.com') {
      const dbMatch = pathname.match(/\/(?:s(?:cl\/f[io])?|h?)\/(\w+)/);
      if (dbMatch) return `dropbox:${dbMatch[1]}`;
    }

    // Cloudflare Stream: *.cloudflarestream.com — path or ?video= ID (32 hex)
    if (hostname.endsWith('cloudflarestream.com') || hostname.endsWith('videodelivery.net') || hostname.endsWith('bytehighway.net')) {
      const cfVideoParam = parsed.searchParams.get('video');
      if (cfVideoParam && /^[\da-f]{32}$/.test(cfVideoParam)) return `cloudflarestream:${cfVideoParam}`;
      const cfPathMatch = pathname.match(/\/([\da-f]{32})\/?$/);
      if (cfPathMatch) return `cloudflarestream:${cfPathMatch[1]}`;
    }

    // XHamster: /videos/slug-ID or /movies/ID → xhamster:ID
    if (hostname.includes('xhamster') || hostname === 'xhms.pro' || hostname === 'xhday.com' || hostname === 'xhvid.com') {
      const xhMoviesMatch = pathname.match(/\/movies\/([\dA-Za-z]+)/);
      if (xhMoviesMatch) return `xhamster:${xhMoviesMatch[1]}`;
      const xhVideosMatch = pathname.match(/\/videos\/[^/]+-([\dA-Za-z]+)/);
      if (xhVideosMatch) return `xhamster:${xhVideosMatch[1]}`;
    }

    // XVideos: /video.ID or embedframe/ID → xvideos:ID
    if (hostname.includes('xvideos')) {
      const xvMatch = pathname.match(/(?:video\.?|embedframe\/)([0-9a-z]+)/);
      if (xvMatch) return `xvideos:${xvMatch[1]}`;
    }

    // Pornhub: view_video.php?viewkey=ID or embed/ID → pornhub:ID
    if (hostname.includes('pornhub') || hostname.includes('pornhubpremium') || hostname === 'thumbzilla.com') {
      const phViewkey = parsed.searchParams.get('viewkey');
      if (phViewkey && /^[\da-z]+$/.test(phViewkey)) return `pornhub:${phViewkey}`;
      const phEmbedMatch = pathname.match(/\/embed\/([\da-z]+)/);
      if (phEmbedMatch) return `pornhub:${phEmbedMatch[1]}`;
    }

    // Kick: /user/videos/UUID (VOD) or /user/clips/clip_xxx / ?clip=clip_xxx → kick:ID
    if (hostname === 'kick.com') {
      const kickVodMatch = pathname.match(/\/[\w-]+\/videos\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})/);
      if (kickVodMatch) return `kick:${kickVodMatch[1]}`;
      const kickClipPath = pathname.match(/\/[\w-]+\/clips\/(clip_[\w-]+)/);
      if (kickClipPath) return `kick:${kickClipPath[1]}`;
      const kickClipParam = parsed.searchParams.get('clip');
      if (kickClipParam && kickClipParam.startsWith('clip_')) return `kick:${kickClipParam}`;
    }

    // Nebula: nebula.tv/videos/slug → nebula:slug
    if (hostname === 'nebula.tv' || hostname === 'nebula.app' || hostname === 'watchnebula.com') {
      const nebulaMatch = pathname.match(/\/videos\/([\w-]+)/);
      if (nebulaMatch) return `nebula:${nebulaMatch[1]}`;
    }

    // Newgrounds: /audio/listen/ID or /portal/view/ID (numeric) → newgrounds:ID
    if (hostname === 'newgrounds.com') {
      const ngMatch = pathname.match(/\/(?:audio\/listen|portal\/view)\/(\d+)/);
      if (ngMatch) return `newgrounds:${ngMatch[1]}`;
    }

    // Floatplane: /post/ID → floatplane:ID
    if (hostname === 'floatplane.com') {
      const fpMatch = pathname.match(/^\/post\/([\w-]+)/);
      if (fpMatch) return `floatplane:${fpMatch[1]}`;
    }

    // CDA (cda.pl): /video/ID or ebd.cda.pl/WxH/ID → cda:ID
    if (hostname === 'cda.pl') {
      const cdaMatch = pathname.match(/\/video\/([0-9a-z]+)/);
      if (cdaMatch) return `cda:${cdaMatch[1]}`;
    }
    if (hostname === 'ebd.cda.pl') {
      const cdaEmbedMatch = pathname.match(/\/([0-9a-z]+)$/);
      if (cdaEmbedMatch) return `cda:${cdaEmbedMatch[1]}`;
    }

    // Utreon / Playeur: /v/ID → utreon:ID
    if (hostname === 'utreon.com' || hostname === 'playeur.com') {
      const utMatch = pathname.match(/^\/v\/([\w-]+)/);
      if (utMatch) return `utreon:${utMatch[1]}`;
    }

    // Likee: /video/ID or /user/video/ID or /v/ID → likee:ID
    if (hostname === 'likee.video') {
      const likeeMatch = pathname.match(/(?:\/video\/|\/v\/)([^/?#]+)/);
      if (likeeMatch) return `likee:${likeeMatch[1]}`;
    }

    // Iwara: /videos/ID or /video/ID → iwara:ID
    if (hostname === 'iwara.tv' || hostname === 'ecchi.iwara.tv') {
      const iwaraMatch = pathname.match(/\/videos?\/([a-zA-Z0-9]+)/);
      if (iwaraMatch) return `iwara:${iwaraMatch[1]}`;
    }

    // EbaumsWorld: /videos/.../ID → ebaumsworld:ID
    if (hostname === 'ebaumsworld.com') {
      const ebMatch = pathname.match(/\/videos\/[^/]+\/(\d+)/);
      if (ebMatch) return `ebaumsworld:${ebMatch[1]}`;
    }

    // Odnoklassniki (OK.ru): /video/ID or /videoembed/... → okru:ID
    if (hostname === 'odnoklassniki.ru' || hostname === 'ok.ru') {
      const okMatch = pathname.match(/\/video(?:embed)?\/([\d-]+)/);
      if (okMatch) return `okru:${okMatch[1]}`;
      const okLiveMatch = pathname.match(/\/live\/([\d-]+)/);
      if (okLiveMatch) return `okru:${okLiveMatch[1]}`;
    }

    // Dropout: .../videos/ID → dropout:ID
    if (hostname === 'dropout.tv' || hostname === 'watch.dropout.tv') {
      const doMatch = pathname.match(/\/videos\/([^/?#]+)/);
      if (doMatch) return `dropout:${doMatch[1]}`;
    }

    // CuriosityStream: /video/ID (numeric) → curiositystream:ID
    if (hostname === 'curiositystream.com' || hostname === 'app.curiositystream.com') {
      const csMatch = pathname.match(/^\/video\/(\d+)/);
      if (csMatch) return `curiositystream:${csMatch[1]}`;
    }

    // Bandlab: /track/ID, /post/ID, /revision/ID → bandlab:ID
    if (hostname === 'bandlab.com') {
      const blMatch = pathname.match(/\/(?:track|post|revision)\/([\da-f_-]+)/);
      if (blMatch) return `bandlab:${blMatch[1]}`;
    }

    // Gettr: /post/ID or /streaming/ID → gettr:ID
    if (hostname === 'gettr.com') {
      const gtMatch = pathname.match(/\/(?:post|streaming)\/([a-z0-9]+)/);
      if (gtMatch) return `gettr:${gtMatch[1]}`;
    }

    // Minds: /media/ID, /newsfeed/ID, /archive/view/ID → minds:ID
    if (hostname === 'minds.com') {
      const mindsMatch = pathname.match(/(?:media|newsfeed|archive\/view)\/(\d+)/);
      if (mindsMatch) return `minds:${mindsMatch[1]}`;
    }

    // Aparat: /v/ID or .../videohash/ID → aparat:ID
    if (hostname === 'aparat.com') {
      const aparatMatch = pathname.match(/(?:^\/v\/|videohash\/)([a-zA-Z0-9]+)/);
      if (aparatMatch) return `aparat:${aparatMatch[1]}`;
    }

    // AcFun: /v/acID → acfun:acID
    if (hostname === 'acfun.cn') {
      const acMatch = pathname.match(/\/v\/ac([_\d]+)/);
      if (acMatch) return `acfun:ac${acMatch[1]}`;
    }

    // XNXX: /video-ID/ or /videoID/ → xnxx:ID
    if (hostname.includes('xnxx')) {
      const xnxxMatch = pathname.match(/\/video-?([0-9a-z]+)/);
      if (xnxxMatch) return `xnxx:${xnxxMatch[1]}`;
    }

    // DrTuber: /video/ID or /embed/ID → drtuber:ID
    if (hostname === 'drtuber.com') {
      const dtMatch = pathname.match(/\/(?:video|embed)\/(\d+)/);
      if (dtMatch) return `drtuber:${dtMatch[1]}`;
    }

    // Dailymail (video): /video/.../video-ID or /embed/video/ID → dailymail:ID
    if (hostname === 'dailymail.co.uk') {
      const dmMatch = pathname.match(/(?:video\/[^/]+\/video-|embed\/video\/)(\d+)/);
      if (dmMatch) return `dailymail:${dmMatch[1]}`;
    }

    // Bluesky: .../post/ID → bluesky:handle:ID
    if (hostname === 'bsky.app' || hostname === 'bsky.social' || hostname === 'main.bsky.dev') {
      const bskyMatch = pathname.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
      if (bskyMatch) return `bluesky:${bskyMatch[1]}:${bskyMatch[2]}`;
    }

    // Flickr: /photos/.../ID → flickr:ID
    if (hostname === 'flickr.com' || hostname === 'secure.flickr.com') {
      const flickrMatch = pathname.match(/\/photos\/[^/]+\/(\d+)/);
      if (flickrMatch) return `flickr:${flickrMatch[1]}`;
    }

    // Generic: normalized origin (no www) + pathname for stable comparison
    // Remove dot segments (.. and .) from pathname per RFC 3986
    const normalizedPathname = removeDotSegments(pathname);
    const normalizedHost = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const origin = `${parsed.protocol}//${normalizedHost}`;
    return `${origin}${normalizedPathname}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Remove dot segments from a path per RFC 3986 section 5.2.4.
 * Handles paths like "/a/b/../c/./d" → "/a/c/d"
 */
function removeDotSegments(path: string): string {
  if (!path) return '/';
  
  const segments = path.split('/');
  const output: string[] = [];
  
  for (const segment of segments) {
    if (segment === '.') {
      continue;
    } else if (segment === '..') {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.pop();
      }
    } else {
      output.push(segment);
    }
  }
  
  // Preserve leading slash
  if (segments[0] === '' && (output.length === 0 || output[0] !== '')) {
    output.unshift('');
  }
  
  // Preserve trailing slash if original had one
  if (segments.length > 0 && segments[segments.length - 1] === '' && output[output.length - 1] !== '') {
    output.push('');
  }
  
  return output.join('/') || '/';
}

/**
 * Build a canonical video key from a YTPTube history item using YTPTube/yt-dlp fields.
 * Prefer YTPTube's own identifiers (archive_id, extractor_key) so we don't rely on URL normalization.
 * Returns e.g. "youtube:VIDEO_ID", "instagram:ID", "tiktok:ID", or null if no usable field.
 */
export function canonicalKeyFromItem(item: HistoryItem): string | null {
  if (!item || typeof item !== 'object') return null;

  // YTPTube returns archive_id: "extractor video_id" (e.g. "youtube jNQXAC9IVRw", "instagram DTN7YIrDD5D")
  const archiveId = typeof (item as { archive_id?: string }).archive_id === 'string'
    ? (item as { archive_id: string }).archive_id.trim()
    : null;
  if (archiveId) {
    const normalized = archiveId.replace(/\s+/g, ':').toLowerCase();
    if (normalized.includes(':')) return normalized;
  }

  // Fallback: extractor_key (same format as archive_id)
  const extractorKey = typeof (item as { extractor_key?: string }).extractor_key === 'string'
    ? (item as { extractor_key: string }).extractor_key.trim()
    : null;
  if (extractorKey) {
    const normalized = extractorKey.replace(/\s+/g, ':').toLowerCase();
    if (normalized.includes(':')) return normalized;
  }

  const extractor = typeof item.extractor === 'string' ? item.extractor.trim().toLowerCase() : null;
  const videoId =
    typeof item.video_id === 'string'
      ? (item as { video_id: string }).video_id.trim()
      : typeof item.id === 'string'
        ? (item as { id: string }).id.trim()
        : null;

  if (extractor && videoId) return `${extractor}:${videoId}`;
  if (videoId) return videoId;

  return null;
}

/**
 * Canonical key for display in tool responses (deduplication, debugging).
 * Prefers key from item (archive_id/extractor_key); falls back to canonicalVideoKey(url).
 */
export function canonicalKeyForDisplay(item: HistoryItem | null, fallbackUrl?: string): string | undefined {
  if (item) {
    const fromItem = canonicalKeyFromItem(item);
    if (fromItem) return fromItem;
  }
  const url = (fallbackUrl ?? (item && typeof (item as { url?: string }).url === 'string' ? (item as { url: string }).url : undefined))?.trim();
  if (url) {
    const fromUrl = canonicalVideoKey(url);
    if (fromUrl) return fromUrl;
  }
  return undefined;
}

/**
 * Compare two URLs: same video if canonical keys match, or exact match, or both keys null and normalized URL match.
 */
function urlsMatch(url1: string, url2: string): boolean {
  const u1 = (url1 ?? '').trim();
  const u2 = (url2 ?? '').trim();
  if (u1 === u2) return true;

  const k1 = canonicalVideoKey(u1);
  const k2 = canonicalVideoKey(u2);
  if (k1 != null && k2 != null) return k1 === k2;

  // Fallback: normalize by stripping query and compare origin+path
  try {
    const a = new URL(u1);
    const b = new URL(u2);
    const na = `${a.origin}${a.pathname}`.replace(/\/$/, '').toLowerCase();
    const nb = `${b.origin}${b.pathname}`.replace(/\/$/, '').toLowerCase();
    return na === nb;
  } catch {
    return false;
  }
}

/**
 * Match a request URL to a history item: by URL or by YTPTube canonical key (video_id / extractor).
 * URLs we don't normalize (unknown platforms) are matched by origin+path via urlsMatch; query params are ignored.
 */
function urlMatchesItem(videoUrl: string, item: HistoryItem): boolean {
  const want = (videoUrl ?? '').trim();
  const itemUrl = (item?.url ?? '').trim();
  if (urlsMatch(want, itemUrl)) return true;

  const urlKey = canonicalVideoKey(want);
  const itemKey = canonicalKeyFromItem(item);
  if (urlKey != null && itemKey != null) return urlKey === itemKey;

  return false;
}

/** Find item by URL in queue, history, or items. Matches by URL or by YTPTube video_id/extractor when present. */
export function findItemByUrl(data: GetHistoryResponse, videoUrl: string): { item: HistoryItem; id: string } | null {
  const queue = data.queue ?? [];
  const history = data.history ?? [];
  const items = data.items ?? [];
  const all = items.length > 0 ? items : [...queue, ...history];
  for (const it of all) {
    if (urlMatchesItem(videoUrl, it)) {
      const id = (it as HistoryItem & { _id?: string })._id ?? it.id;
      if (id != null) return { item: it, id: String(id) };
    }
  }
  return null;
}

/** Find item by URL in a list of items. Matches by URL or by YTPTube video_id/extractor when present. */
export function findItemByUrlInItems(items: HistoryItem[], videoUrl: string): { item: HistoryItem; id: string } | null {
  for (const it of items) {
    if (urlMatchesItem(videoUrl, it)) {
      const id = (it as HistoryItem & { _id?: string })._id ?? it.id;
      if (id != null) return { item: it, id: String(id) };
    }
  }
  return null;
}

/** Find item by normalized archive key in a list (from canonicalKeyFromItem or normalizeArchiveIdToKey). */
function findItemByArchiveKeyInItems(
  items: HistoryItem[],
  key: string,
): { item: HistoryItem; id: string } | null {
  for (const it of items) {
    const itemKey = canonicalKeyFromItem(it);
    if (itemKey != null && itemKey === key) {
      const id = (it as HistoryItem & { _id?: string })._id ?? it.id;
      if (id != null) return { item: it, id: String(id) };
    }
  }
  return null;
}

function getAllItems(data: GetHistoryResponse): HistoryItem[] {
  const queue = data.queue ?? [];
  const history = data.history ?? [];
  const items = data.items ?? [];
  return items.length > 0 ? items : [...queue, ...history];
}

/**
 * Find item by video_url: first by URL/canonical key, then by YTPTube archive_id API (works for any platform).
 */
export async function findItemByUrlWithArchiveIdFallback(
  config: YTPTubeConfig,
  data: GetHistoryResponse,
  videoUrl: string,
): Promise<{ item: HistoryItem; id: string } | null> {
  const byUrl = findItemByUrl(data, videoUrl);
  if (byUrl) return byUrl;

  try {
    const results = await getArchiveIdForUrls(config, [videoUrl]);
    const key = results[0] ? normalizeArchiveIdToKey(results[0].archive_id) : null;
    if (key) return findItemByArchiveKeyInItems(getAllItems(data), key);
  } catch (e) {
    logger.debug({ err: e, video_url: videoUrl }, 'YTPTube archive_id fallback failed');
  }
  return null;
}

/**
 * Find item by URL in a list; fallback to archive_id API when URL match fails (any platform).
 */
export async function findItemByUrlInItemsWithArchiveIdFallback(
  config: YTPTubeConfig,
  items: HistoryItem[],
  videoUrl: string,
): Promise<{ item: HistoryItem; id: string } | null> {
  const byUrl = findItemByUrlInItems(items, videoUrl);
  if (byUrl) return byUrl;

  try {
    const results = await getArchiveIdForUrls(config, [videoUrl]);
    const key = results[0] ? normalizeArchiveIdToKey(results[0].archive_id) : null;
    if (key) return findItemByArchiveKeyInItems(items, key);
  } catch (e) {
    logger.debug({ err: e, video_url: videoUrl }, 'YTPTube archive_id fallback failed');
  }
  return null;
}

/**
 * Find item by video_url in data and optionally in queue/done. Uses archive_id API at most once.
 * Use when you have data + queue + done and want a single lookup (e.g. get_status).
 */
export async function findItemByUrlInAll(
  config: YTPTubeConfig,
  data: GetHistoryResponse,
  videoUrl: string,
  options: { queue?: HistoryItem[]; done?: HistoryItem[] } = {},
): Promise<{ item: HistoryItem; id: string } | null> {
  let found = findItemByUrl(data, videoUrl);
  if (found) return found;

  const { queue = [], done = [] } = options;
  found = findItemByUrlInItems(queue, videoUrl) ?? findItemByUrlInItems(done, videoUrl);
  if (found) return found;

  try {
    const results = await getArchiveIdForUrls(config, [videoUrl]);
    const key = results[0] ? normalizeArchiveIdToKey(results[0].archive_id) : null;
    if (key) {
      found =
        findItemByArchiveKeyInItems(getAllItems(data), key) ??
        findItemByArchiveKeyInItems(queue, key) ??
        findItemByArchiveKeyInItems(done, key);
    }
  } catch (e) {
    logger.debug({ err: e, video_url: videoUrl }, 'YTPTube archive_id fallback failed');
  }
  return found ?? null;
}

/**
 * Collect all items matching videoUrl from data, queue, and done (by URL or archive_id).
 */
function collectAllItemsByUrl(
  allItems: HistoryItem[],
  videoUrl: string,
  key: string | null,
): Array<{ item: HistoryItem; id: string }> {
  const candidates: Array<{ item: HistoryItem; id: string }> = [];
  for (const it of allItems) {
    const match = urlMatchesItem(videoUrl, it) || (key != null && canonicalKeyFromItem(it) === key);
    if (match) {
      const id = (it as HistoryItem & { _id?: string })._id ?? it.id;
      if (id != null) candidates.push({ item: it, id: String(id) });
    }
  }
  return candidates;
}

/**
 * Find item by video_url and prefer the one whose file matches the requested media type (video vs audio).
 * Use when multiple items can exist for the same URL (e.g. one audio from transcript, one video).
 */
export async function findItemByUrlAndType(
  config: YTPTubeConfig,
  data: GetHistoryResponse,
  videoUrl: string,
  type: 'audio' | 'video',
  options: { queue?: HistoryItem[]; done?: HistoryItem[] } = {},
): Promise<{ item: HistoryItem; id: string } | null> {
  const { queue = [], done = [] } = options;
  const allItems = [...getAllItems(data), ...queue, ...done];
  let key: string | null = null;
  try {
    const results = await getArchiveIdForUrls(config, [videoUrl]);
    key = results[0] ? normalizeArchiveIdToKey(results[0].archive_id) : null;
  } catch (e) {
    logger.debug({ err: e, video_url: videoUrl }, 'YTPTube archive_id fallback failed');
  }
  const candidates = collectAllItemsByUrl(allItems, videoUrl, key);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const pathType = (item: HistoryItem) => getMediaTypeFromPath(relativePathFromItem(item));
  const matching = candidates.find((c) => pathType(c.item) === type);
  if (matching) return matching;
  const status = (item: HistoryItem) => (item.status ?? '').toLowerCase();
  const finished = candidates.find((c) => status(c.item) === 'finished');
  if (finished) return finished;
  return candidates[0]!; // Prefer finished over skip so caller can queue video when only audio exists
}

const ITEM_NOT_FOUND_MSG =
  'YTPTube item not found. Check that the URL is supported (e.g. some Shorts/forms) and that the job was added successfully.';

/**
 * GET /api/history/{id} – fetch one history item.
 */
export async function getHistoryById(config: YTPTubeConfig, id: string): Promise<HistoryItem> {
  const base = ensureSlash(config.baseUrl);
  const res = await fetch(`${base}api/history/${encodeURIComponent(id)}`, {
    headers: getAuthHeaders(config.apiKey),
  });

  if (!res.ok) {
    if (res.status === 404) throw new Error(ITEM_NOT_FOUND_MSG);
    const text = await res.text();
    let err: string;
    try {
      const j = JSON.parse(text) as { error?: string };
      err = j.error ?? text;
    } catch {
      err = text || res.statusText;
    }
    throw new Error(`YTPTube GET /api/history/${id} failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as HistoryItem;
  logApiResponse('GET', `api/history/${id}`, data);
  return data;
}

/**
 * GET /api/history/live – current queue (and optionally history). Used to poll by id.
 */
export async function getHistoryLive(config: YTPTubeConfig): Promise<{
  queue?: Record<string, HistoryItem>;
  history?: unknown[];
  [key: string]: unknown;
}> {
  const base = ensureSlash(config.baseUrl);
  const res = await fetch(`${base}api/history/live`, {
    headers: getAuthHeaders(config.apiKey),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YTPTube GET /api/history/live failed (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as { queue?: Record<string, HistoryItem>; history?: unknown[]; [key: string]: unknown };
}

/**
 * Poll until the history item with the given id has status "finished" or "error".
 * Uses GET /api/history/{id} on each tick.
 */
export async function waitUntilFinished(
  config: YTPTubeConfig,
  id: string,
): Promise<HistoryItem> {
  const interval = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + (config.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);

  while (Date.now() < deadline) {
    const item = await getHistoryById(config, id);
    const status = (item.status ?? '').toLowerCase();
    if (status === 'finished') return item;
    if (status === 'error') {
      const msg = (item as { error?: string }).error ?? 'YTPTube job ended with status error';
      throw new Error(msg);
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(`YTPTube job ${id} did not finish within the configured timeout`);
}

/**
 * GET /api/file/browser/{path} – list files in a folder. Path is relative (e.g. "transcripts").
 */
export async function getFileBrowser(
  config: YTPTubeConfig,
  path: string,
): Promise<FileBrowserResponse> {
  const base = ensureSlash(config.baseUrl);
  const enc = encodeURIComponent(path || '.');
  const res = await fetch(`${base}api/file/browser/${enc}`, {
    headers: getAuthHeaders(config.apiKey),
  });

  if (!res.ok) {
    if (res.status === 404) return { path, contents: [] };
    const text = await res.text();
    throw new Error(`YTPTube GET /api/file/browser failed (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as FileBrowserResponse;
}

/**
 * Get a short identifier from item for matching filenames (e.g. "8exiepcm47hg1" for Reddit).
 * Uses video_id, or the second part of archive_id / extractor_key ("extractor id" → id).
 */
function getItemIdForFilename(item: HistoryItem): string | null {
  const videoId = typeof item.video_id === 'string' ? (item.video_id as string).trim() : null;
  if (videoId) return videoId;
  const archiveId = typeof (item as { archive_id?: string }).archive_id === 'string'
    ? (item as { archive_id: string }).archive_id.trim()
    : null;
  if (archiveId) {
    const parts = archiveId.split(/\s+/);
    if (parts.length >= 2) return parts[1]!.trim();
    if (parts[0]) return parts[0].trim();
  }
  const extractorKey = typeof (item as { extractor_key?: string }).extractor_key === 'string'
    ? (item as { extractor_key: string }).extractor_key.trim()
    : null;
  if (extractorKey) {
    const parts = extractorKey.split(/\s+/);
    if (parts.length >= 2) return parts[1]!.trim();
    if (parts[0]) return parts[0].trim();
  }
  return null;
}

/**
 * Pick relative path from candidates: single candidate → path; multiple → match by item title slug or video_id/archive_id, else null.
 * Used by resolveAudioPathFromBrowser, resolveVideoPathFromBrowser, resolveSubtitlePathFromBrowser.
 */
function pickPathFromCandidates(
  candidates: FileBrowserEntry[],
  item: HistoryItem,
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const p = candidates[0]!.path ?? candidates[0]!.name;
    return p ? String(p).replace(/^\//, '') : null;
  }
  const title = (item.title ?? '').trim();
  const slug = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ');
  for (const c of candidates) {
    const name = (c.name ?? '').toLowerCase();
    if (slug && name.includes(slug.toLowerCase().slice(0, 20))) {
      const p = c.path ?? c.name;
      return p ? String(p).replace(/^\//, '') : null;
    }
  }
  const itemId = getItemIdForFilename(item);
  if (itemId) {
    const idLower = itemId.toLowerCase();
    for (const c of candidates) {
      const name = (c.name ?? '').toLowerCase();
      const stem = name.replace(/\.[^.]+$/, '');
      if (stem === idLower || name.startsWith(idLower) || name.includes(idLower)) {
        const p = c.path ?? c.name;
        return p ? String(p).replace(/^\//, '') : null;
      }
    }
  }
  return null;
}

/**
 * Resolve the relative path of the audio file for a finished history item.
 * Plan: use folder "transcripts" and find file in GET /api/file/browser/transcripts
 * matching the item (e.g. by title + ".mp3" or newest .mp3).
 */
export function resolveAudioPathFromBrowser(
  contents: FileBrowserEntry[],
  item: HistoryItem,
): string | null {
  const candidates = (contents ?? []).filter((e) => {
    if (!e.is_file) return false;
    if (e.content_type === 'audio') return true;
    const name = (e.name ?? '').toLowerCase();
    return MEDIA_AUDIO_EXTENSIONS.some((ext) => name.endsWith(ext));
  });
  return pickPathFromCandidates(candidates, item);
}

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v', '.flv'];

/**
 * Resolve the relative path of the video file for a finished history item.
 * Uses folder from item (or root) and finds a file with video content_type or common video extension.
 */
export function resolveVideoPathFromBrowser(
  contents: FileBrowserEntry[],
  item: HistoryItem,
): string | null {
  const candidates = (contents ?? []).filter((e) => {
    if (!e.is_file) return false;
    if (e.content_type === 'video') return true;
    const name = (e.name ?? '').toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
  });
  return pickPathFromCandidates(candidates, item);
}

/**
 * Resolve the relative path of a subtitle file (.vtt) for a finished history item.
 * Uses content_type === 'subtitle' or .vtt extension; matches by item title when multiple candidates.
 */
export function resolveSubtitlePathFromBrowser(
  contents: FileBrowserEntry[],
  item: HistoryItem,
): string | null {
  const candidates = (contents ?? []).filter(
    (e) =>
      e.is_file &&
      (e.content_type === 'subtitle' || (e.name ?? '').toLowerCase().endsWith('.vtt')),
  );
  return pickPathFromCandidates(candidates, item);
}

/**
 * GET /api/download/{filename} – download file by relative path. Returns binary body.
 */
export async function downloadFile(
  config: YTPTubeConfig,
  relativePath: string,
): Promise<ArrayBuffer> {
  const base = ensureSlash(config.baseUrl);
  const enc = encodeURIComponent(relativePath.replace(/^\//, ''));
  const res = await fetch(`${base}api/download/${enc}`, {
    headers: getAuthHeaders(config.apiKey),
  });

  if (!res.ok) {
    if (res.status === 404) throw new Error(`YTPTube file not found: ${relativePath}`);
    const text = await res.text();
    throw new Error(`YTPTube GET /api/download failed (${res.status}): ${text || res.statusText}`);
  }

  return res.arrayBuffer();
}
