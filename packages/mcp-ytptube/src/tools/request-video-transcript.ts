/**
 * Tool: request_video_transcript
 * Get transcript for a URL, or start download / report in-progress. No blocking when downloading.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { CreateVideoTranscriptSchema, type CreateVideoTranscriptInput } from '../schemas/create-video-transcript.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import {
  getHistory,
  findItemByUrl,
  getHistoryQueue,
  getHistoryDone,
  findItemByUrlInItems,
  getHistoryById,
  postHistory,
  getFileBrowser,
  resolveAudioPathFromBrowser,
  downloadFile,
  type GetHistoryResponse,
  type HistoryItem,
} from '../clients/ytptube.ts';
import type { ScalewayConfig } from '../clients/scaleway.ts';
import { transcribe } from '../clients/scaleway.ts';
import {
  InvalidUrlError,
  YTPTubeError,
  TranscriptionError,
  NotFoundError,
  VideoTranscriptsError,
} from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

const AUDIO_FOLDER = 'transcripts';
const AUDIO_CLI = '--extract-audio --audio-format mp3';
const POST_TO_QUEUE_DELAY_MS = 500;

export interface RequestVideoTranscriptDeps {
  ytptube: YTPTubeConfig;
  scaleway: ScalewayConfig;
}

function formatProgress(item: HistoryItem): number {
  const p = item.progress;
  if (typeof p === 'number' && p >= 0 && p <= 100) return Math.round(p);
  return 0;
}

/**
 * request_video_transcript(video_url, preset?, language_hint?)
 * Resolve by URL; if finished return transcript; if downloading/queued return status; if not found POST and return queued.
 */
export async function requestVideoTranscript(
  input: unknown,
  deps: RequestVideoTranscriptDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = CreateVideoTranscriptSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new InvalidUrlError(msg);
  }

  const { video_url, preset } = parsed.data as CreateVideoTranscriptInput;
  const ytp = deps.ytptube;
  const scw = deps.scaleway;

  let data: GetHistoryResponse;
  try {
    data = await getHistory(ytp);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, video_url }, 'YTPTube GET /api/history failed');
    throw new YTPTubeError(`Failed to check queue: ${err.message}`);
  }

  const found = findItemByUrl(data, video_url);

  if (found) {
    const { item, id } = found;
    const status = (item.status ?? '').toLowerCase();

    if (status === 'finished') {
      const browser = await getFileBrowser(ytp, AUDIO_FOLDER);
      const relativePath = resolveAudioPathFromBrowser(browser.contents ?? [], item);
      if (!relativePath) {
        throw new NotFoundError(
          `Could not find audio file for finished item ${id} in folder ${AUDIO_FOLDER}. Check YTPTube file browser.`,
        );
      }
      let audioBuffer: ArrayBuffer;
      try {
        audioBuffer = await downloadFile(ytp, relativePath);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.warn({ err, relativePath, id }, 'YTPTube GET /api/download failed');
        throw new YTPTubeError(`Failed to download audio: ${err.message}`);
      }
      const filename = relativePath.includes('/') ? relativePath.split('/').pop() ?? 'audio.mp3' : relativePath;
      let text: string;
      try {
        text = await transcribe(scw, audioBuffer, filename);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.warn({ err, id }, 'Scaleway transcription failed');
        throw new TranscriptionError(`Transcription failed: ${err.message}`);
      }
      const out = `TRANSCRIPT_READY url=${video_url} job_id=${id}
Tell the user: The transcript is below.

${text || '(Empty transcript)'}`;
      return { content: [{ type: 'text', text: out }] };
    }

    if (status === 'error') {
      const msg = (item as HistoryItem & { error?: string }).error ?? 'YTPTube job ended with status error';
      throw new YTPTubeError(msg, 'error');
    }

    const fresh = await getHistoryById(ytp, id).catch(() => item);
    const pct = formatProgress(fresh);
    const isQueued = status === 'queued' || status === 'pending' || pct === 0;
    if (isQueued) {
      const out = `DOWNLOAD_QUEUED job_id=${id} url=${video_url}
Tell the user: The download has started. They can ask for "status" or "progress" to see how much is downloaded; when complete they can ask for the transcript.`;
      return { content: [{ type: 'text', text: out }] };
    }
    const out = `DOWNLOAD_IN_PROGRESS job_id=${id} progress=${pct}% url=${video_url}
Tell the user: The video is being downloaded (${pct}% complete). They can ask for "status" or "progress" to see updates; when 100% they can ask for the transcript again.`;
    return { content: [{ type: 'text', text: out }] };
  }

  const body = {
    url: video_url,
    preset,
    folder: AUDIO_FOLDER,
    cli: AUDIO_CLI,
    auto_start: true as const,
  };
  try {
    await postHistory(ytp, body);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, video_url }, 'YTPTube POST /api/history failed');
    throw new YTPTubeError(`Failed to add URL to YTPTube: ${err.message}`);
  }

  await new Promise((r) => setTimeout(r, POST_TO_QUEUE_DELAY_MS));

  let queueItems: HistoryItem[];
  try {
    queueItems = await getHistoryQueue(ytp);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, video_url }, 'YTPTube GET /api/history?type=queue after POST failed');
    throw new YTPTubeError(`Download was queued but could not resolve job id: ${err.message}`);
  }

  let afterFound = findItemByUrlInItems(queueItems, video_url);
  if (!afterFound) {
    await new Promise((r) => setTimeout(r, POST_TO_QUEUE_DELAY_MS));
    try {
      queueItems = await getHistoryQueue(ytp);
      afterFound = findItemByUrlInItems(queueItems, video_url);
    } catch {
      /* ignore retry errors, continue to check done */
    }
  }
  if (afterFound) {
    const out = `DOWNLOAD_QUEUED job_id=${afterFound.id} url=${video_url}
Tell the user: The download has started. They can ask for "status" or "progress" to see how much is downloaded; when complete they can ask for the transcript.`;
    return { content: [{ type: 'text', text: out }] };
  }

  const doneItems = await getHistoryDone(ytp).catch(() => [] as HistoryItem[]);
  const doneFound = findItemByUrlInItems(doneItems, video_url);
  if (doneFound && (doneFound.item.status ?? '').toLowerCase() === 'finished') {
    const { item, id } = doneFound;
    const browser = await getFileBrowser(ytp, AUDIO_FOLDER);
    const relativePath = resolveAudioPathFromBrowser(browser.contents ?? [], item);
    if (!relativePath) {
      throw new NotFoundError(
        `Could not find audio file for finished item ${id} in folder ${AUDIO_FOLDER}. Check YTPTube file browser.`,
      );
    }
    let audioBuffer: ArrayBuffer;
    try {
      audioBuffer = await downloadFile(ytp, relativePath);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn({ err, relativePath, id }, 'YTPTube GET /api/download failed');
      throw new YTPTubeError(`Failed to download audio: ${err.message}`);
    }
    const filename = relativePath.includes('/') ? relativePath.split('/').pop() ?? 'audio.mp3' : relativePath;
    let text: string;
    try {
      text = await transcribe(scw, audioBuffer, filename);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn({ err, id }, 'Scaleway transcription failed');
      throw new TranscriptionError(`Transcription failed: ${err.message}`);
    }
    const out = `TRANSCRIPT_READY url=${video_url} job_id=${id}
Tell the user: The transcript is below (video was already in YTPTube archive).

${text || '(Empty transcript)'}`;
    return { content: [{ type: 'text', text: out }] };
  }

  throw new YTPTubeError(
    'YTPTube did not return the new item in the queue. The user can ask for status by video URL once the download appears.',
  );
}
