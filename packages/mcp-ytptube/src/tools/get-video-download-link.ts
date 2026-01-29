/**
 * Tool: get_video_download_link
 * Returns a directly usable download link (audio or video) for a finished YTPTube item, with credentials embedded.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { GetVideoDownloadLinkSchema, type GetVideoDownloadLinkInput } from '../schemas/get-video-download-link.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import {
  getHistory,
  getHistoryById,
  getHistoryQueue,
  getHistoryDone,
  findItemByUrlWithArchiveIdFallback,
  findItemByUrlInAll,
  getFileBrowser,
  resolveAudioPathFromBrowser,
  resolveVideoPathFromBrowser,
  buildPublicDownloadUrl,
  type HistoryItem,
} from '../clients/ytptube.ts';
import { VideoTranscriptsError, NotFoundError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';
import { formatDownloadLinkResponse, formatErrorResponse } from '../utils/response-format.ts';

const AUDIO_FOLDER = 'transcripts';

export interface GetVideoDownloadLinkDeps {
  ytptube: YTPTubeConfig;
  publicDownloadBaseUrl: string | undefined;
}

/**
 * Resolve item by video_url or job_id. Same logic as request-video-transcript / get-transcript-status.
 */
async function resolveItem(
  ytp: YTPTubeConfig,
  videoUrl: string | undefined,
  jobId: string | undefined,
): Promise<{ item: HistoryItem; id: string } | null> {
  if (jobId) {
    try {
      const item = await getHistoryById(ytp, jobId);
      const id = item.id ?? (item as HistoryItem & { _id?: string })._id;
      if (id != null) return { item, id: String(id) };
    } catch (e) {
      logger.debug({ err: e, job_id: jobId }, 'getHistoryById failed for job_id');
      return null;
    }
  }
  if (videoUrl) {
    const data = await getHistory(ytp);
    const found = await findItemByUrlWithArchiveIdFallback(ytp, data, videoUrl);
    if (found) return found;
    const [queueItems, doneItems] = await Promise.all([
      getHistoryQueue(ytp).catch(() => [] as HistoryItem[]),
      getHistoryDone(ytp).catch(() => [] as HistoryItem[]),
    ]);
    const inAll = await findItemByUrlInAll(ytp, data, videoUrl, { queue: queueItems, done: doneItems });
    return inAll;
  }
  return null;
}

/**
 * get_video_download_link(video_url?, job_id?, type?)
 * Only for finished items. Returns download_url with apikey when public base URL and (if auth) apiKey are set.
 */
export async function getVideoDownloadLink(
  input: unknown,
  deps: GetVideoDownloadLinkDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = GetVideoDownloadLinkSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new VideoTranscriptsError(msg, 'VALIDATION_ERROR');
  }

  const { video_url, job_id, type } = parsed.data as GetVideoDownloadLinkInput;
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

  const resolved = await resolveItem(ytp, video_url, job_id);
  if (!resolved) {
    throw new NotFoundError(
      video_url ? `No YTPTube item found for URL. Add it via request_video_transcript first.` : `No YTPTube item found for job_id.`,
    );
  }

  const { item, id } = resolved;
  const status = (item.status ?? '').toLowerCase();
  if (status !== 'finished') {
    throw new VideoTranscriptsError(
      `Item is not finished (status=${status}). Request transcript or check status first; when finished, request download link again.`,
      'NOT_FINISHED',
    );
  }

  let relativePath: string | null;
  if (type === 'video') {
    const videoFolder = typeof item.folder === 'string' && item.folder.trim() ? item.folder.trim() : '.';
    const browser = await getFileBrowser(ytp, videoFolder);
    relativePath = resolveVideoPathFromBrowser(browser.contents ?? [], item);
    if (!relativePath) {
      throw new NotFoundError(
        `Could not find video file for finished item ${id} in folder ${videoFolder}. Check YTPTube file browser or use type=audio for transcript audio.`,
      );
    }
  } else {
    const browser = await getFileBrowser(ytp, AUDIO_FOLDER);
    relativePath = resolveAudioPathFromBrowser(browser.contents ?? [], item);
    if (!relativePath) {
      throw new NotFoundError(
        `Could not find audio file for finished item ${id} in folder ${AUDIO_FOLDER}. Check YTPTube file browser.`,
      );
    }
  }

  const downloadUrl = buildPublicDownloadUrl(relativePath, publicBaseUrl, ytp.apiKey);
  const relay = 'Use this link to download the file (e.g. in browser or wget).';
  return {
    content: [
      {
        type: 'text',
        text: formatDownloadLinkResponse({ download_url: downloadUrl, relay }),
      },
    ],
  };
}
