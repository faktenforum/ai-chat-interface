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

function getAuthHeaders(apiKey?: string): Record<string, string> {
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

function ensureSlash(url: string): string {
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
 * - YouTube: "youtube:" + video ID (shorts/watch/youtu.be)
 * - Instagram: "instagram:" + media ID (reel/p path segment)
 * - Others: normalized URL (origin + pathname, no query, trailing slash stripped)
 */
export function canonicalVideoKey(url: string): string | null {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = parsed.pathname.replace(/\/$/, '') || '/';

    // YouTube: various forms → youtube:VIDEO_ID
    if (hostname === 'youtube.com' || hostname === 'youtu.be') {
      let videoId: string | null = null;
      if (hostname === 'youtu.be') {
        videoId = pathname.slice(1) || null;
      } else if (pathname.startsWith('/shorts/')) {
        videoId = pathname.slice(8) || null;
      } else if (pathname === '/watch') {
        videoId = parsed.searchParams.get('v');
      }
      if (videoId) return `youtube:${videoId}`;
    }

    // Instagram: /reel/ID, /p/ID, /tv/ID → instagram:ID (hostname already normalized, no www)
    if (hostname === 'instagram.com') {
      const m = pathname.match(/^\/(reel|p|tv)\/([^/]+)/);
      if (m) return `instagram:${m[2]}`;
    }

    // TikTok: /@user/video/ID or /video/ID → tiktok:ID
    if (hostname === 'tiktok.com' || hostname === 'vm.tiktok.com') {
      const m = pathname.match(/\/video\/(\d+)/);
      if (m) return `tiktok:${m[1]}`;
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

    // Generic: normalized origin (no www) + pathname for stable comparison
    const normalizedHost = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const origin = `${parsed.protocol}//${normalizedHost}`;
    return `${origin}${pathname}`.toLowerCase();
  } catch {
    return null;
  }
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
 * Pick relative path from candidates: single candidate → path; multiple → match by item title slug, else null.
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
  const candidates = (contents ?? []).filter(
    (e) => (e.is_file && e.name?.toLowerCase().endsWith('.mp3')) || e.content_type === 'audio',
  );
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
