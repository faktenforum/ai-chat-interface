/**
 * Tool: get_transcript_status
 * Status of a video download/transcript by job_id and/or video_url. Returns progress %, STATUS, and "Tell the user" line.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { GetTranscriptStatusSchema, type GetTranscriptStatusInput } from '../schemas/get-transcript-status.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import {
  getHistoryById,
  getHistory,
  getHistoryQueue,
  getHistoryDone,
  findItemByUrlInAll,
  type HistoryItem,
} from '../clients/ytptube.ts';
import { VideoTranscriptsError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';
import { formatStatusResponse } from '../utils/response-format.ts';

export interface GetTranscriptStatusDeps {
  ytptube: YTPTubeConfig;
}

function formatProgress(item: HistoryItem): number {
  const p = item.progress;
  if (typeof p === 'number' && p >= 0 && p <= 100) return Math.round(p);
  return 0;
}

/**
 * get_transcript_status(job_id?, video_url?)
 * Resolve by job_id or video_url; return STATUS, progress %, and "Tell the user" line.
 */
export async function getTranscriptStatus(
  input: unknown,
  deps: GetTranscriptStatusDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = GetTranscriptStatusSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new VideoTranscriptsError(msg, 'VALIDATION_ERROR');
  }

  const { job_id, video_url } = parsed.data as GetTranscriptStatusInput;
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
                relay: 'No job. Request transcript with video URL to start.',
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
              relay: 'No job. Request transcript with video URL to start.',
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
            relay: 'Done. Request transcript for this URL to get text.',
          }),
        },
      ],
    };
  }

  if (status === 'error') {
    const reason = (item as { error?: string }).error ?? 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: formatStatusResponse({
            status: 'error',
            job_id: id,
            url,
            status_url: url,
            reason,
            relay: `Download failed (${reason}). Try another URL.`,
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
            relay: 'Queued. Ask again for status.',
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
          progress: pct,
          relay: `${pct}% done. Ask for status; when 100% request transcript.`,
        }),
      },
    ],
  };
}
