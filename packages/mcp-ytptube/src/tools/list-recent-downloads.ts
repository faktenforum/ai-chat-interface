/**
 * Tool: list_recent_downloads
 * Last N history items (queue/done) with title, status, optional download link when finished.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { ListRecentDownloadsSchema, type ListRecentDownloadsInput } from '../schemas/list-recent-downloads.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import {
  getHistoryQueue,
  getHistoryDone,
  getFileBrowser,
  resolveAudioPathFromBrowser,
  resolveVideoPathFromBrowser,
  buildPublicDownloadUrl,
  relativePathFromItem,
  canonicalKeyForDisplay,
  MCP_DOWNLOAD_FOLDER,
  type HistoryItem,
} from '../clients/ytptube.ts';
import { VideoTranscriptsError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';
import { formatListRecentDownloadsItem } from '../utils/response-format.ts';

export interface ListRecentDownloadsDeps {
  ytptube: YTPTubeConfig;
  publicDownloadBaseUrl: string | undefined;
}

/** Normalise YTPTube status to a stable set: queued, downloading, finished, error, unknown. */
function normaliseStatus(raw: string | undefined): string {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'finished' || s === 'error' || s === 'downloading') return s;
  if (s === 'pending' || s === 'queued') return 'queued';
  return s || 'unknown';
}

async function getDownloadUrlForItem(
  ytp: YTPTubeConfig,
  item: HistoryItem,
  publicBaseUrl: string | undefined,
): Promise<string | undefined> {
  if (!publicBaseUrl?.trim() || (item.status ?? '').toLowerCase() !== 'finished') return undefined;
  try {
    const pathFromItem = relativePathFromItem(item);
    if (pathFromItem) {
      return buildPublicDownloadUrl(pathFromItem, publicBaseUrl, ytp.apiKey);
    }
    const folder = (item.folder ?? '').trim() || MCP_DOWNLOAD_FOLDER;
    const browser = await getFileBrowser(ytp, folder);
    const contents = browser.contents ?? [];
    let relativePath = resolveVideoPathFromBrowser(contents, item);
    if (!relativePath) relativePath = resolveAudioPathFromBrowser(contents, item);
    if (!relativePath) return undefined;
    return buildPublicDownloadUrl(relativePath, publicBaseUrl, ytp.apiKey);
  } catch {
    return undefined;
  }
}

/**
 * list_recent_downloads(limit?, status_filter?)
 * Returns last N items from queue and/or done; for finished items optionally includes download_url when YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL is set.
 */
export async function listRecentDownloads(
  input: unknown,
  deps: ListRecentDownloadsDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = ListRecentDownloadsSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new VideoTranscriptsError(msg, 'VALIDATION_ERROR');
  }

  const { limit, status_filter } = parsed.data as ListRecentDownloadsInput;
  const ytp = deps.ytptube;
  const publicBaseUrl = deps.publicDownloadBaseUrl;

  let queue: HistoryItem[] = [];
  let done: HistoryItem[] = [];

  if (status_filter === 'all' || status_filter === 'queue') {
    try {
      queue = await getHistoryQueue(ytp);
    } catch (e) {
      logger.warn({ err: e }, 'YTPTube GET /api/history?type=queue failed');
    }
  }
  if (status_filter === 'all' || status_filter === 'finished') {
    try {
      done = await getHistoryDone(ytp);
    } catch (e) {
      logger.warn({ err: e }, 'YTPTube GET /api/history?type=done failed');
    }
  }

  const items: HistoryItem[] =
    status_filter === 'queue' ? queue : status_filter === 'finished' ? done : [...queue, ...done];
  const slice = items.slice(0, limit);

  const lines: string[] = [];
  for (let i = 0; i < slice.length; i++) {
    const item = slice[i]!;
    const id = (item as HistoryItem & { _id?: string })._id ?? item.id;
    const title = (item.title ?? 'Untitled').trim();
    const status = normaliseStatus(item.status);
    const url = typeof item.url === 'string' ? item.url : undefined;
    let download_url: string | undefined;
    if (status === 'finished' && publicBaseUrl) {
      download_url = await getDownloadUrlForItem(ytp, item, publicBaseUrl);
    }
    const canonical_key = canonicalKeyForDisplay(item, url);
    lines.push(formatListRecentDownloadsItem({ title, status, url, job_id: id != null ? String(id) : undefined, download_url, canonical_key }));
  }

  const relay = `Listed ${lines.length} item(s). Use request_download_link for a direct link when status=finished.`;
  const text = lines.length > 0 ? lines.join('\n') + `\nrelay=${relay}` : `relay=No items. Request transcript or download with a video URL to start.`;
  return {
    content: [{ type: 'text', text }],
  };
}
