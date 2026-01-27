/**
 * YTPTube API client for adding URLs, polling status, and downloading audio files.
 * Uses GET /api/download/{filename} for file retrieval (no shared volume).
 */

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_WAIT_MS = 60 * 60 * 1000; // 1 hour

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
  template?: string;
  progress?: number;
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

function ensureSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
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

  const data = (await res.json()) as HistoryItem[] | HistoryItem;
  const arr = Array.isArray(data) ? data : [data];
  return arr;
}

/** Response shape of GET /api/history (legacy type=all or no type, or paginated type=queue/done). */
export interface GetHistoryResponse {
  queue?: HistoryItem[];
  history?: HistoryItem[];
  items?: HistoryItem[];
  pagination?: unknown;
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

  return (await res.json()) as GetHistoryResponse;
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
  if (Array.isArray(data.items)) return data.items;
  const history = data.history ?? [];
  return history;
}

/** Find item by URL in queue, history, or items. Exact URL match only; no normalization. */
export function findItemByUrl(data: GetHistoryResponse, videoUrl: string): { item: HistoryItem; id: string } | null {
  const queue = data.queue ?? [];
  const history = data.history ?? [];
  const items = data.items ?? [];
  const all = items.length > 0 ? items : [...queue, ...history];
  const want = (videoUrl ?? '').trim();
  for (const it of all) {
    if ((it?.url ?? '').trim() === want) {
      const id = it.id ?? (it as HistoryItem & { _id?: string })._id;
      if (id != null) return { item: it, id: String(id) };
    }
  }
  return null;
}

/** Find item by URL in a list of items. Exact URL match only; no normalization. */
export function findItemByUrlInItems(items: HistoryItem[], videoUrl: string): { item: HistoryItem; id: string } | null {
  const want = (videoUrl ?? '').trim();
  for (const it of items) {
    if ((it?.url ?? '').trim() === want) {
      const id = it.id ?? (it as HistoryItem & { _id?: string })._id;
      if (id != null) return { item: it, id: String(id) };
    }
  }
  return null;
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

  return (await res.json()) as HistoryItem;
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
 * Resolve the relative path of the audio file for a finished history item.
 * Plan: use folder "transcripts" and find file in GET /api/file/browser/transcripts
 * matching the item (e.g. by title + ".mp3" or newest .mp3).
 */
export function resolveAudioPathFromBrowser(
  contents: FileBrowserEntry[],
  item: HistoryItem,
): string | null {
  const title = (item.title ?? '').trim();
  const candidates = (contents ?? []).filter(
    (e) => (e.is_file && e.name?.toLowerCase().endsWith('.mp3')) || e.content_type === 'audio',
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const p = candidates[0]!.path ?? candidates[0]!.name;
    return p ? String(p).replace(/^\//, '') : null;
  }
  const slug = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ');
  for (const c of candidates) {
    const name = (c.name ?? '').toLowerCase();
    if (slug && name.includes(slug.toLowerCase().slice(0, 20))) {
      const p = c.path ?? c.name;
      return p ? String(p).replace(/^\//, '') : null;
    }
  }
  const first = candidates[0]!;
  const p = first.path ?? first.name;
  return p ? String(p).replace(/^\//, '') : null;
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
