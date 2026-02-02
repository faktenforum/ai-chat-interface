/**
 * Tool: request_download_link
 * Request a download link (video or audio) for a YTPTube item. Starts download if needed; returns link when finished or status.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { RequestDownloadLinkSchema, type RequestDownloadLinkInput } from '../schemas/request-download-link.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import {
  getHistory,
  getHistoryById,
  getHistoryQueue,
  getHistoryDone,
  findItemByUrlWithArchiveIdFallback,
  findItemByUrlInItems,
  findItemByUrlInItemsWithArchiveIdFallback,
  findItemByUrlInAll,
  getFileBrowser,
  resolveAudioPathFromBrowser,
  resolveVideoPathFromBrowser,
  buildPublicDownloadUrl,
  relativePathFromItem,
  postHistory,
  canonicalKeyForDisplay,
  canonicalVideoKey,
  MCP_DOWNLOAD_FOLDER,
  type HistoryItem,
} from '../clients/ytptube.ts';
import { VideoTranscriptsError, NotFoundError, InvalidCookiesError } from '../utils/errors.ts';
import { isValidNetscapeCookieFormat, INVALID_COOKIES_MESSAGE } from '../utils/netscape-cookies.ts';
import { logger } from '../utils/logger.ts';
import { formatDownloadLinkResponse, formatStatusResponse, formatErrorResponse } from '../utils/response-format.ts';
import { getProxyUrl } from '../utils/env.ts';

const POST_TO_QUEUE_DELAY_MS = 500;

const AUDIO_EXTENSIONS = ['.mp3'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v', '.flv'];

function isAudioExtension(path: string): boolean {
  const lower = (path ?? '').toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Derive media type from file path (extension). Returns 'audio', 'video', or null. */
function derivedTypeFromPath(path: string): 'audio' | 'video' | null {
  const lower = (path ?? '').toLowerCase();
  if (AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'audio';
  if (VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'video';
  return null;
}

const NO_VIDEO_USE_AUDIO_MSG =
  'No video file for this item; only audio from transcript. Use type=audio for download link.';

const DOWNLOAD_RELAY = 'Use this link to download the file (e.g. in browser or wget).';

export interface RequestDownloadLinkDeps {
  ytptube: YTPTubeConfig;
  publicDownloadBaseUrl: string | undefined;
}

function formatProgress(item: HistoryItem): number {
  const p = item.progress;
  if (typeof p === 'number' && p >= 0 && p <= 100) return Math.round(p);
  return 0;
}

type ResolveDownloadResult =
  | { ok: true; downloadUrl: string }
  | { ok: false; error: 'no_video' }
  | { ok: false; error: 'not_found'; message: string };

/**
 * Resolve download URL for a finished item (item.filename or file-browser fallback).
 * Returns download URL, no-video error, or not-found error.
 */
async function resolveDownloadUrl(
  ytp: YTPTubeConfig,
  publicBaseUrl: string,
  item: HistoryItem,
  id: string,
  type: 'audio' | 'video',
): Promise<ResolveDownloadResult> {
  const folder = (item.folder ?? '').trim() || MCP_DOWNLOAD_FOLDER;
  let relativePath: string | null = relativePathFromItem(item);
  if (relativePath) {
    const derived = derivedTypeFromPath(relativePath);
    if (type === 'video' && (derived === 'audio' || isAudioExtension(relativePath))) {
      return { ok: false, error: 'no_video' };
    }
    if ((type === 'video' && derived === 'video') || (type === 'audio' && derived === 'audio')) {
      return { ok: true, downloadUrl: buildPublicDownloadUrl(relativePath, publicBaseUrl, ytp.apiKey) };
    }
    relativePath = null;
  }
  if (!relativePath) {
    const browser = await getFileBrowser(ytp, folder);
    const contents = browser.contents ?? [];
    relativePath =
      type === 'video'
        ? resolveVideoPathFromBrowser(contents, item)
        : resolveAudioPathFromBrowser(contents, item);
    if (!relativePath) {
      if (type === 'video') return { ok: false, error: 'no_video' };
      return {
        ok: false,
        error: 'not_found',
        message: `Could not find ${type} file for finished item ${id} in folder ${folder}. Check YTPTube file browser.`,
      };
    }
    if (type === 'video' && isAudioExtension(relativePath)) return { ok: false, error: 'no_video' };
    return { ok: true, downloadUrl: buildPublicDownloadUrl(relativePath, publicBaseUrl, ytp.apiKey) };
  }
  // Defensive fallback for type safety (unreachable in normal flow).
  return {
    ok: false,
    error: 'not_found',
    message: `Could not find ${type} file for finished item ${id} in folder ${folder}. Check YTPTube file browser.`,
  };
}

/** Resolve item by video_url only (no job_id). Same logic as get_status. */
async function resolveItem(
  ytp: YTPTubeConfig,
  videoUrl: string,
): Promise<{ item: HistoryItem; id: string } | null> {
  const data = await getHistory(ytp);
  const found = await findItemByUrlWithArchiveIdFallback(ytp, data, videoUrl);
  if (found) return found;
  const [queueItems, doneItems] = await Promise.all([
    getHistoryQueue(ytp).catch(() => [] as HistoryItem[]),
    getHistoryDone(ytp).catch(() => [] as HistoryItem[]),
  ]);
  return findItemByUrlInAll(ytp, data, videoUrl, { queue: queueItems, done: doneItems });
}

export async function requestDownloadLink(
  input: unknown,
  deps: RequestDownloadLinkDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = RequestDownloadLinkSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new VideoTranscriptsError(msg, 'VALIDATION_ERROR');
  }

  const { video_url, type, preset, cookies } = parsed.data as RequestDownloadLinkInput;
  if (cookies?.trim() && !isValidNetscapeCookieFormat(cookies)) {
    throw new InvalidCookiesError(INVALID_COOKIES_MESSAGE);
  }
  const ytp = deps.ytptube;
  const publicBaseUrl = deps.publicDownloadBaseUrl;

  if (!publicBaseUrl?.trim()) {
    return {
      content: [
        {
          type: 'text',
          text: formatErrorResponse('Download links not configured. Set YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL.'),
        },
      ],
    };
  }

  const resolved = await resolveItem(ytp, video_url);

  if (resolved) {
    const { item, id } = resolved;
    const status = (item.status ?? '').toLowerCase();
    const storedUrl = typeof item.url === 'string' ? item.url : undefined;

    if (status === 'finished') {
      const result = await resolveDownloadUrl(ytp, publicBaseUrl, item, id, type);
      if (result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: formatDownloadLinkResponse({
                download_url: result.downloadUrl,
                url: storedUrl ?? video_url,
                canonical_key: canonicalKeyForDisplay(item, video_url),
                relay: DOWNLOAD_RELAY,
              }),
            },
          ],
        };
      }
      if (result.error === 'no_video') {
        return { content: [{ type: 'text', text: formatErrorResponse(NO_VIDEO_USE_AUDIO_MSG) }] };
      }
      throw new NotFoundError(result.message);
    }

    if (status === 'error') {
      const msg = (item as HistoryItem & { error?: string }).error ?? 'YTPTube job ended with status error';
      throw new VideoTranscriptsError(msg, 'error');
    }

    if (status === 'skip' || status === 'cancelled') {
      const reason = (item as { msg?: string }).msg ?? 'URL already in download archive; job was skipped.';
      return {
        content: [
          {
            type: 'text',
            text: formatStatusResponse({
              status: 'skipped',
              job_id: id,
              url: video_url,
              status_url: storedUrl,
              canonical_key: canonicalKeyForDisplay(item, video_url),
              reason,
              relay:
                'Video was skipped (already in archive). Call request_download_link again with the same URL to try getting the link from the existing download.',
            }),
          },
        ],
      };
    }

    const fresh = await getHistoryById(ytp, id).catch(() => item);
    const pct = formatProgress(fresh);
    const isQueued = status === 'queued' || status === 'pending' || pct === 0;
    const relay = 'Use get_status to check; when finished, call request_download_link again for link.';
    return {
      content: [
        {
          type: 'text',
          text: formatStatusResponse({
            status: isQueued ? 'queued' : 'downloading',
            job_id: id,
            url: video_url,
            status_url: storedUrl,
            canonical_key: canonicalKeyForDisplay(item, video_url),
            progress: isQueued ? undefined : pct,
            relay,
          }),
        },
      ],
    };
  }

  // Not found: trigger POST
  const proxy = getProxyUrl();
  const cliBase = type === 'audio' ? '--extract-audio --audio-format mp3' : '';
  const cli = proxy ? (cliBase ? `${cliBase} --proxy ${proxy}` : `--proxy ${proxy}`) : cliBase;
  const body = {
    url: video_url,
    preset,
    folder: MCP_DOWNLOAD_FOLDER,
    cli: cli || undefined,
    auto_start: true as const,
    ...(cookies?.trim() && { cookies: cookies.trim() }),
  };

  let postResult: HistoryItem[];
  try {
    postResult = await postHistory(ytp, body);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, video_url }, 'YTPTube POST /api/history failed');
    throw new VideoTranscriptsError(`Failed to add URL to YTPTube: ${err.message}`, 'YTPTUBE_ERROR');
  }

  let postFound = findItemByUrlInItems(postResult, video_url);
  if (!postFound) postFound = await findItemByUrlInItemsWithArchiveIdFallback(ytp, postResult, video_url);
  if (!postFound && postResult.length === 1) {
    const single = postResult[0]!;
    const sid = single.id ?? (single as { _id?: string })._id;
    if (sid != null) postFound = { item: single, id: String(sid) };
  }

  if (postFound) {
    const { item, id } = postFound;
    const status = (item.status ?? '').toLowerCase();
    const storedUrl = typeof item.url === 'string' ? item.url : undefined;
    logger.debug({ video_url, ytptubeUrl: storedUrl, status, id }, 'Matched video from POST response');

    if (status === 'finished') {
      const result = await resolveDownloadUrl(ytp, publicBaseUrl, item, id, type);
      if (result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: formatDownloadLinkResponse({
                download_url: result.downloadUrl,
                url: storedUrl ?? video_url,
                canonical_key: canonicalKeyForDisplay(item, video_url),
                relay: DOWNLOAD_RELAY,
              }),
            },
          ],
        };
      }
      if (result.error === 'no_video') {
        return { content: [{ type: 'text', text: formatErrorResponse(NO_VIDEO_USE_AUDIO_MSG) }] };
      }
      throw new NotFoundError(result.message);
    }

    if (status === 'error') {
      const msg = (item as HistoryItem & { error?: string }).error ?? 'YTPTube job ended with status error';
      throw new VideoTranscriptsError(msg, 'error');
    }

    const pct = formatProgress(await getHistoryById(ytp, id).catch(() => item));
    const isQueued = status === 'queued' || status === 'pending' || pct === 0;
    return {
      content: [
        {
          type: 'text',
          text: formatStatusResponse({
            status: isQueued ? 'queued' : 'downloading',
            job_id: id,
            url: video_url,
            status_url: storedUrl,
            canonical_key: canonicalKeyForDisplay(item, video_url),
            progress: isQueued ? undefined : pct,
            relay: 'Use get_status to check; when finished, call request_download_link again for link.',
          }),
        },
      ],
    };
  }

  await new Promise((r) => setTimeout(r, POST_TO_QUEUE_DELAY_MS));

  let queueItems: HistoryItem[];
  try {
    queueItems = await getHistoryQueue(ytp);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, video_url }, 'YTPTube GET /api/history?type=queue after POST failed');
    throw new VideoTranscriptsError(`Download was queued but could not resolve job id: ${err.message}`, 'YTPTUBE_ERROR');
  }

  let afterFound = findItemByUrlInItems(queueItems, video_url) ?? (await findItemByUrlInItemsWithArchiveIdFallback(ytp, queueItems, video_url));
  if (!afterFound) {
    await new Promise((r) => setTimeout(r, POST_TO_QUEUE_DELAY_MS));
    try {
      queueItems = await getHistoryQueue(ytp);
      afterFound = findItemByUrlInItems(queueItems, video_url) ?? (await findItemByUrlInItemsWithArchiveIdFallback(ytp, queueItems, video_url));
    } catch {
      /* ignore retry, continue to check done */
    }
  }
  if (afterFound) {
    const storedUrl = typeof afterFound.item.url === 'string' ? afterFound.item.url : undefined;
    return {
      content: [
        {
          type: 'text',
          text: formatStatusResponse({
            status: 'queued',
            job_id: afterFound.id,
            url: video_url,
            status_url: storedUrl,
            canonical_key: canonicalKeyForDisplay(afterFound.item, video_url),
            relay: 'Use get_status to check; when finished, call request_download_link again for link.',
          }),
        },
      ],
    };
  }

  const doneItems = await getHistoryDone(ytp).catch(() => [] as HistoryItem[]);
  const doneFound =
    findItemByUrlInItems(doneItems, video_url) ?? (await findItemByUrlInItemsWithArchiveIdFallback(ytp, doneItems, video_url));
  if (doneFound) {
    const doneStatus = (doneFound.item.status ?? '').toLowerCase();
    if (doneStatus === 'finished') {
      const { item, id } = doneFound;
      const result = await resolveDownloadUrl(ytp, publicBaseUrl, item, id, type);
      const storedUrl = typeof item.url === 'string' ? item.url : undefined;
      if (result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: formatDownloadLinkResponse({
                download_url: result.downloadUrl,
                url: storedUrl ?? video_url,
                canonical_key: canonicalKeyForDisplay(item, video_url),
                relay: DOWNLOAD_RELAY,
              }),
            },
          ],
        };
      }
      if (result.error === 'no_video') {
        return { content: [{ type: 'text', text: formatErrorResponse(NO_VIDEO_USE_AUDIO_MSG) }] };
      }
      throw new NotFoundError(result.message);
    }
    if (doneStatus === 'skip' || doneStatus === 'cancelled') {
      const { item, id } = doneFound;
      const reason = (item as { msg?: string }).msg ?? 'URL already in download archive; job was skipped.';
      return {
        content: [
          {
            type: 'text',
            text: formatStatusResponse({
              status: 'skipped',
              job_id: id,
              url: video_url,
              status_url: typeof item.url === 'string' ? item.url : undefined,
              canonical_key: canonicalKeyForDisplay(item, video_url),
              reason,
              relay:
                'Video was skipped (already in archive). Call request_download_link again with the same URL to try getting the link from the existing download.',
            }),
          },
        ],
      };
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: formatStatusResponse({
          status: 'queued',
          url: video_url,
          canonical_key: canonicalVideoKey(video_url) ?? undefined,
          relay: 'Download queued. Use get_status with video_url to check; when finished call request_download_link again for link.',
        }),
      },
    ],
  };
}
