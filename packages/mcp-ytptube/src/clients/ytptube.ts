/**
 * YTPTube API client for adding URLs, polling status, and downloading audio files.
 * Uses GET /api/download/{filename} for file retrieval (no shared volume).
 */

import { logger } from '../utils/logger.ts';
import { canonicalVideoKey } from './canonical-video-key.ts';

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

export { canonicalVideoKey } from './canonical-video-key.ts';

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

/** Response shape of GET /api/logs. API may use (timestamp, level, message) or (line, datetime). */
export interface LogEntry {
  timestamp?: string;
  level?: string;
  message?: string;
  line?: string;
  datetime?: string;
  [key: string]: unknown;
}

export interface GetLogsResponse {
  logs: LogEntry[];
  offset: number;
  limit: number;
  next_offset?: number;
  end_is_reached?: boolean;
}

/**
 * GET /api/logs – recent application logs (if file logging is enabled). Returns 404 when disabled.
 */
export async function getLogs(
  config: YTPTubeConfig,
  options: { offset?: number; limit?: number } = {},
): Promise<GetLogsResponse> {
  const base = ensureSlash(config.baseUrl);
  const offset = options.offset ?? 0;
  const limit = Math.min(options.limit ?? 100, 150);
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  const res = await fetch(`${base}api/logs?${params}`, {
    headers: getAuthHeaders(config.apiKey),
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('YTPTube file logging is not enabled; GET /api/logs returned 404.');
    }
    const text = await res.text();
    let err: string;
    try {
      const j = JSON.parse(text) as { error?: string };
      err = j.error ?? text;
    } catch {
      err = text || res.statusText;
    }
    throw new Error(`YTPTube GET /api/logs failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as GetLogsResponse;
  logApiResponse('GET', 'api/logs', data);
  return data;
}

/** Response shape of GET /api/system/configuration (app, presets, queue, etc.). */
export interface SystemConfigurationResponse {
  app?: { version?: string; download_path?: string; base_path?: string; [key: string]: unknown };
  presets?: unknown[];
  dl_fields?: unknown[];
  paused?: boolean;
  folders?: Array<{ name?: string; path?: string }>;
  history_count?: number;
  queue?: HistoryItem[];
  [key: string]: unknown;
}

/**
 * GET /api/system/configuration – app version, presets, queue, history_count, paused, folders.
 */
export async function getSystemConfiguration(config: YTPTubeConfig): Promise<SystemConfigurationResponse> {
  const base = ensureSlash(config.baseUrl);
  const res = await fetch(`${base}api/system/configuration`, {
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
    throw new Error(`YTPTube GET /api/system/configuration failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as SystemConfigurationResponse;
  logApiResponse('GET', 'api/system/configuration', data);
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
