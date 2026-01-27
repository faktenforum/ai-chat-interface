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
  findItemByUrl,
  getHistoryQueue,
  getHistoryDone,
  findItemByUrlInItems,
  type HistoryItem,
} from '../clients/ytptube.ts';
import { NotFoundError, VideoTranscriptsError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

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
        const out = `STATUS=not_found
Tell the user: No job found for that ID or URL. They can start a new download by asking to transcribe the video URL.`;
        return { content: [{ type: 'text', text: out }] };
      }
      logger.warn({ err, job_id }, 'YTPTube GET /api/history/{id} failed');
      throw new VideoTranscriptsError(`Failed to get status: ${err.message}`, 'YTPTUBE_ERROR');
    }
  } else if (video_url) {
    const data = await getHistory(ytp).catch((e) => {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn({ err, video_url }, 'YTPTube GET /api/history failed');
      throw new VideoTranscriptsError(`Failed to look up by URL: ${err.message}`, 'YTPTUBE_ERROR');
    });
    let found = findItemByUrl(data, video_url);
    if (!found) {
      const [queueItems, doneItems] = await Promise.all([
        getHistoryQueue(ytp).catch(() => []),
        getHistoryDone(ytp).catch(() => []),
      ]);
      found = findItemByUrlInItems(queueItems, video_url) ?? findItemByUrlInItems(doneItems, video_url);
    }
    if (!found) {
      const out = `STATUS=not_found
Tell the user: No job found for that ID or URL. They can start a new download by asking to transcribe the video URL.`;
      return { content: [{ type: 'text', text: out }] };
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
    const out = `STATUS=finished job_id=${id}${url ? ` url=${url}` : ''}
Tell the user: Download complete. They can now request the transcript (e.g. "transcribe this video" or "get the transcript for this URL").`;
    return { content: [{ type: 'text', text: out }] };
  }

  if (status === 'error') {
    const reason = (item as { error?: string }).error ?? 'Unknown error';
    const out = `STATUS=error job_id=${id}${url ? ` url=${url}` : ''} reason=${reason}
Tell the user: The download failed (${reason}). They may try another URL or a different video.`;
    return { content: [{ type: 'text', text: out }] };
  }

  if (status === 'queued' || status === 'pending' || pct === 0) {
    const out = `STATUS=queued job_id=${id}${url ? ` url=${url}` : ''}
Tell the user: The video is queued; download has not started yet. They can ask again for status.`;
    return { content: [{ type: 'text', text: out }] };
  }

  const out = `STATUS=downloading progress=${pct}% job_id=${id}${url ? ` url=${url}` : ''}
Tell the user: Download is ${pct}% complete. Ask again for updated progress; when 100% they can request the transcript.`;
  return { content: [{ type: 'text', text: out }] };
}
