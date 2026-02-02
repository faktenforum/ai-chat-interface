/**
 * Tool: get_status
 * Status of a YTPTube item (transcript or download) by job_id and/or video_url. Returns progress %, STATUS, and relay line.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { GetStatusSchema, type GetStatusInput } from '../schemas/get-status.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import {
  getHistoryById,
  getHistory,
  getHistoryQueue,
  getHistoryDone,
  findItemByUrlInAll,
  canonicalKeyForDisplay,
  type HistoryItem,
} from '../clients/ytptube.ts';
import { VideoTranscriptsError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';
import { formatStatusResponse } from '../utils/response-format.ts';

export interface GetStatusDeps {
  ytptube: YTPTubeConfig;
}

function formatProgress(item: HistoryItem): number {
  const p = item.progress;
  if (typeof p === 'number' && p >= 0 && p <= 100) return Math.round(p);
  return 0;
}

/**
 * get_status(job_id?, video_url?)
 * Resolve by job_id or video_url; return STATUS, progress %, and relay line.
 */
export async function getStatus(
  input: unknown,
  deps: GetStatusDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = GetStatusSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new VideoTranscriptsError(msg, 'VALIDATION_ERROR');
  }

  const { job_id, video_url } = parsed.data as GetStatusInput;
  const ytp = deps.ytptube;

  let item: HistoryItem;
  let id: string;

  if (job_id) {
    try {
      item = await getHistoryById(ytp, job_id);
      id = job_id;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (String(err.message).includes('not found')) {
        return {
          content: [
            {
              type: 'text',
              text: formatStatusResponse({
                status: 'not_found',
                relay: 'No job. Request transcript or download with video URL to start.',
              }),
            },
          ],
        };
      }
      logger.warn({ err, job_id }, 'YTPTube GET /api/history/{id} failed');
      throw new VideoTranscriptsError(`Failed to get status: ${err.message}`, 'YTPTUBE_ERROR');
    }
  } else if (video_url) {
    const [data, queueItems, doneItems] = await Promise.all([
      getHistory(ytp).catch((e) => {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.warn({ err, video_url }, 'YTPTube GET /api/history failed');
        throw new VideoTranscriptsError(`Failed to look up by URL: ${err.message}`, 'YTPTUBE_ERROR');
      }),
      getHistoryQueue(ytp).catch(() => [] as HistoryItem[]),
      getHistoryDone(ytp).catch(() => [] as HistoryItem[]),
    ]);
    const found = await findItemByUrlInAll(ytp, data, video_url, {
      queue: queueItems,
      done: doneItems,
    });
    if (!found) {
      return {
        content: [
          {
            type: 'text',
            text: formatStatusResponse({
              status: 'not_found',
              relay: 'No job. Request transcript or download with video URL to start.',
            }),
          },
        ],
      };
    }
    item = found.item;
    id = found.id;
  } else {
    throw new VideoTranscriptsError('At least one of job_id or video_url is required', 'VALIDATION_ERROR');
  }

  const status = (item.status ?? 'unknown').toLowerCase();
  const url = typeof item.url === 'string' ? item.url : undefined;
  const pct = formatProgress(item);
  const canonical_key = canonicalKeyForDisplay(item, url);

  if (status === 'finished') {
    return {
      content: [
        {
          type: 'text',
          text: formatStatusResponse({
            status: 'finished',
            job_id: id,
            url,
            status_url: url,
            canonical_key,
            relay: 'Done. Call request_video_transcript or request_download_link again for transcript or link.',
          }),
        },
      ],
    };
  }

  if (status === 'error') {
    const reason = (item as { error?: string }).error ?? 'Unknown error';
    const relay =
      typeof reason === 'string' && reason.includes('No formats')
        ? 'Download failed (No formats). The URL may be geo-restricted, private, or unsupported; try another source or URL.'
        : `Download failed (${reason}). Try another URL.`;
    return {
      content: [
        {
          type: 'text',
          text: formatStatusResponse({
            status: 'error',
            job_id: id,
            url,
            status_url: url,
            canonical_key,
            reason,
            relay,
          }),
        },
      ],
    };
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
            url,
            status_url: url,
            canonical_key,
            reason,
            relay:
              'Video was skipped (already in archive). If you need the transcript or download link, call request_video_transcript or request_download_link again with the same URL; the file may exist from a previous download.',
          }),
        },
      ],
    };
  }

  if (status === 'queued' || status === 'pending' || pct === 0) {
    return {
      content: [
        {
          type: 'text',
          text: formatStatusResponse({
            status: 'queued',
            job_id: id,
            url,
            status_url: url,
            canonical_key,
            relay: 'Queued. Use get_status to check; when finished call request_video_transcript or request_download_link again.',
          }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: formatStatusResponse({
          status: 'downloading',
          job_id: id,
          url,
          status_url: url,
          canonical_key,
          progress: pct,
          relay: `${pct}% done. Ask for status; when 100% call request_video_transcript or request_download_link again.`,
        }),
      },
    ],
  };
}
