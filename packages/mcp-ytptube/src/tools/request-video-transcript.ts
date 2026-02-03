/**
 * Tool: request_video_transcript
 * Get transcript for a URL, or start download / report in-progress. No blocking when downloading.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { CreateVideoTranscriptSchema, type CreateVideoTranscriptInput } from '../schemas/create-video-transcript.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import {
  getHistory,
  getHistoryQueue,
  getHistoryDone,
  findItemByUrlInItems,
  findItemByUrlWithArchiveIdFallback,
  findItemByUrlInItemsWithArchiveIdFallback,
  getHistoryById,
  postHistory,
  getFileBrowser,
  getUrlInfo,
  getArchiveIdForUrls,
  resolveAudioPathFromBrowser,
  resolveSubtitlePathFromBrowser,
  resolveVideoPathFromBrowser,
  relativePathFromItem,
  downloadFile,
  canonicalKeyForDisplay,
  canonicalVideoKey,
  MCP_DOWNLOAD_FOLDER,
  type GetHistoryResponse,
  type HistoryItem,
} from '../clients/ytptube.ts';
import type { ScalewayConfig } from '../clients/scaleway.ts';
import { transcribe, filenameForScaleway } from '../clients/scaleway.ts';
import {
  InvalidUrlError,
  InvalidCookiesError,
  YTPTubeError,
  TranscriptionError,
  NotFoundError,
  VideoTranscriptsError,
} from '../utils/errors.ts';
import { isValidNetscapeCookieFormat, INVALID_COOKIES_MESSAGE } from '../utils/netscape-cookies.ts';
import { logger } from '../utils/logger.ts';
import { formatTranscriptResponseAsBlocks, formatStatusResponse } from '../utils/response-format.ts';
import { vttToPlainText } from '../utils/vtt-to-text.ts';
import { getProxyUrl, CLI_AUDIO, CLI_SUBS, PRESET_TRANSCRIPT } from '../utils/env.ts';

const POST_TO_QUEUE_DELAY_MS = 500;

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v', '.flv'];
/** Audio extensions for path-from-item (yt-dlp may output m4a, webm, opus, etc.). */
const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.webm', '.opus', '.aac', '.ogg', '.wav'];

function isVideoPath(path: string): boolean {
  const lower = (path ?? '').toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export interface RequestVideoTranscriptDeps {
  ytptube: YTPTubeConfig;
  scaleway: ScalewayConfig;
}

function formatProgress(item: HistoryItem): number {
  const p = item.progress;
  if (typeof p === 'number' && p >= 0 && p <= 100) return Math.round(p);
  return 0;
}

const DEFAULT_QUEUED_RELAY = 'Download started. Use get_status; when finished request transcript again.';
const VIDEO_ONLY_QUEUED_RELAY =
  'Item was video-only; started transcript job. Use get_status; when finished request transcript again.';

/** Shown when no language_hint: LLM should ask user for correct language and re-call with language_hint. */
const LANGUAGE_UNKNOWN_INSTRUCTION =
  'If the transcript language is wrong, ask the user for the correct language and call request_video_transcript again with language_hint set to that language (e.g. language_hint: "de" for German).';

function transcriptLanguageParams(lang: string | undefined): { language_used: string; language_instruction?: string } {
  return {
    language_used: lang ?? 'unknown',
    language_instruction: lang == null ? LANGUAGE_UNKNOWN_INSTRUCTION : undefined,
  };
}

function statusLanguageParams(lang: string | undefined): { language: string; language_instruction?: string } {
  return {
    language: lang ?? 'unknown',
    language_instruction: lang == null ? LANGUAGE_UNKNOWN_INSTRUCTION : undefined,
  };
}

type FileBrowserContents = Awaited<ReturnType<typeof getFileBrowser>>['contents'];

/**
 * Build transcript content for a finished history item (subtitle VTT or audio → Scaleway).
 * Returns content array, or null if item is video-only (caller should start transcript job).
 */
async function buildTranscriptForFinishedItem(
  deps: RequestVideoTranscriptDeps,
  videoUrl: string,
  item: HistoryItem,
  id: string,
  lang: string | undefined,
  options: { fromArchive?: boolean },
): Promise<{ content: TextContent[] } | null> {
  const { ytptube: ytp, scaleway: scw } = deps;
  let resolvedItem = item;
  const pathFromResolved = relativePathFromItem(item);
  if (!pathFromResolved) {
    const fresh = await getHistoryById(ytp, id).catch(() => null);
    if (fresh && relativePathFromItem(fresh)) resolvedItem = fresh;
  }
  const folder = (resolvedItem.folder ?? '').trim() || MCP_DOWNLOAD_FOLDER;
  let subtitlePath: string | null = null;
  let relativePath: string | null = null;
  let contents: FileBrowserContents = [];
  const pathFromItem = relativePathFromItem(resolvedItem);
  if (pathFromItem) {
    const lower = pathFromItem.toLowerCase();
    if (lower.endsWith('.vtt')) subtitlePath = pathFromItem;
    else if (AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) relativePath = pathFromItem;
  }
  if (!subtitlePath || !relativePath) {
    const browser = await getFileBrowser(ytp, folder);
    contents = browser.contents ?? [];
    if (!subtitlePath) subtitlePath = resolveSubtitlePathFromBrowser(contents, resolvedItem);
    if (!relativePath) relativePath = resolveAudioPathFromBrowser(contents, resolvedItem);
    if (!relativePath) {
      try {
        const results = await getArchiveIdForUrls(ytp, [videoUrl]);
        const archiveId = results[0]?.archive_id?.trim();
        const idFromUrl = archiveId ? archiveId.split(/\s+/).pop() ?? null : null;
        if (idFromUrl) {
          const idLower = idFromUrl.toLowerCase();
          const audioExts = ['.mp3', '.m4a', '.webm', '.opus', '.aac', '.ogg', '.wav'];
          for (const e of contents) {
            if (!e.is_file || !e.name) continue;
            const name = (e.name ?? '').toLowerCase();
            const stem = name.replace(/\.[^.]+$/, '');
            if (stem === idLower && audioExts.some((ext) => name.endsWith(ext))) {
              const p = (e.path ?? e.name) as string;
              relativePath = p ? String(p).replace(/^\//, '') : null;
              break;
            }
          }
        }
      } catch (e) {
        logger.debug({ err: e, videoUrl }, 'getArchiveIdForUrls fallback failed');
      }
    }
  }

  const storedUrl = typeof resolvedItem.url === 'string' ? resolvedItem.url : undefined;
  const langParams = transcriptLanguageParams(lang);

  if (subtitlePath) {
    let buffer: ArrayBuffer;
    try {
      buffer = await downloadFile(ytp, subtitlePath);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn({ err, subtitlePath, id }, 'YTPTube GET /api/download failed for subtitle');
      throw new YTPTubeError(`Failed to download subtitle: ${err.message}`);
    }
    const text = vttToPlainText(buffer);
    const { metadata, transcript: transcriptText } = formatTranscriptResponseAsBlocks({
      url: videoUrl,
      job_id: id,
      transcript: text ?? '',
      fromArchive: options.fromArchive,
      status_url: storedUrl,
      transcript_source: 'platform_subtitles',
      canonical_key: canonicalKeyForDisplay(resolvedItem, videoUrl),
      ...langParams,
    });
    return { content: [{ type: 'text', text: metadata }, { type: 'text', text: transcriptText }] };
  }

  if (!relativePath) {
    if (pathFromItem && isVideoPath(pathFromItem)) return null;
    const videoPath = resolveVideoPathFromBrowser(contents, resolvedItem);
    if (videoPath) return null;
    logger.warn(
      {
        id,
        folder,
        itemMeta: {
          filename: resolvedItem.filename ?? null,
          video_id: resolvedItem.video_id ?? null,
          archive_id: resolvedItem.archive_id ?? null,
          title: typeof resolvedItem.title === 'string' ? resolvedItem.title.slice(0, 60) : null,
        },
        fileCount: contents.length,
        fileNames: contents.filter((e) => e.is_file && e.name).map((e) => e.name),
      },
      'No audio/subtitle path for finished item (check file browser)',
    );
    throw new NotFoundError(
      `Could not find audio or subtitle for finished item ${id} in folder ${folder}. Check YTPTube file browser.`,
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
  const filename = filenameForScaleway(relativePath);
  let text: string;
  try {
    text = await transcribe(scw, audioBuffer, filename, lang);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, id }, 'Scaleway transcription failed');
    throw new TranscriptionError(`Transcription failed: ${err.message}`);
  }
  const { metadata, transcript: transcriptText } = formatTranscriptResponseAsBlocks({
    url: videoUrl,
    job_id: id,
    transcript: text ?? '',
    fromArchive: options.fromArchive,
    status_url: storedUrl,
    transcript_source: 'transcription',
    canonical_key: canonicalKeyForDisplay(resolvedItem, videoUrl),
    ...langParams,
  });
  return { content: [{ type: 'text', text: metadata }, { type: 'text', text: transcriptText }] };
}

/**
 * Build transcript CLI (subs or audio), POST to YTPTube, find the new item in the response, and return a queued status.
 * Used when URL is not in history and when a finished item is video-only (no audio/subtitle in folder).
 */
async function startTranscriptJobAndReturnQueued(
  deps: RequestVideoTranscriptDeps,
  video_url: string,
  preset: string | undefined,
  lang: string | undefined,
  options: { relay?: string; language?: string; language_instruction?: string; cookies?: string } = {},
): Promise<{ content: TextContent[] }> {
  const { ytptube: ytp } = deps;
  const relay = options.relay ?? DEFAULT_QUEUED_RELAY;
  const language = options.language ?? (lang ?? 'unknown');
  const language_instruction = options.language_instruction ?? (lang == null ? LANGUAGE_UNKNOWN_INSTRUCTION : undefined);

  let cliBase = CLI_AUDIO;
  try {
    const info = await getUrlInfo(ytp, video_url);
    const hasSubs =
      (info.subtitles != null && Object.keys(info.subtitles).length > 0) ||
      (info.automatic_captions != null && Object.keys(info.automatic_captions).length > 0);
    if (hasSubs) {
      const subLangs = process.env.YTPTUBE_SUB_LANGS?.trim();
      cliBase = subLangs ? `${CLI_SUBS} --sub-langs "${subLangs}"` : CLI_SUBS;
    }
  } catch (e) {
    logger.debug({ err: e, video_url }, 'getUrlInfo failed, using audio CLI');
  }
  const proxy = getProxyUrl();
  const cli = proxy ? `${cliBase} --proxy ${proxy}` : cliBase;
  const body = {
    url: video_url,
    preset: preset ?? PRESET_TRANSCRIPT,
    folder: MCP_DOWNLOAD_FOLDER,
    cli,
    auto_start: true as const,
    ...(options.cookies?.trim() && { cookies: options.cookies.trim() }),
  };

  let postResult: HistoryItem[];
  try {
    postResult = await postHistory(ytp, body);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, video_url }, 'YTPTube POST /api/history failed');
    throw new YTPTubeError(`Failed to add URL to YTPTube: ${err.message}`);
  }

  let postFound = findItemByUrlInItems(postResult, video_url);
  if (!postFound) postFound = await findItemByUrlInItemsWithArchiveIdFallback(ytp, postResult, video_url);
  if (!postFound && postResult.length === 1) {
    const single = postResult[0];
    const id = single?.id ?? (single as { _id?: string })?._id;
    if (id != null) postFound = { item: single, id: String(id) };
  }

  if (postFound) {
    const storedUrl = typeof postFound.item.url === 'string' ? postFound.item.url : undefined;
    return {
      content: [
        {
          type: 'text',
          text: formatStatusResponse({
            status: 'queued',
            job_id: postFound.id,
            url: video_url,
            status_url: storedUrl,
            canonical_key: canonicalKeyForDisplay(postFound.item, video_url),
            relay,
            language,
            language_instruction,
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
          status: 'queued',
          url: video_url,
          canonical_key: canonicalVideoKey(video_url) ?? undefined,
          relay: 'Download queued. Use get_status with video_url to check; when finished request transcript again.',
          language,
          language_instruction,
        }),
      },
    ],
  };
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

  const { video_url, preset, language_hint, cookies } = parsed.data as CreateVideoTranscriptInput;
  if (cookies?.trim() && !isValidNetscapeCookieFormat(cookies)) {
    throw new InvalidCookiesError(INVALID_COOKIES_MESSAGE);
  }
  const lang = language_hint?.trim() ? language_hint.trim().slice(0, 2).toLowerCase() : undefined;
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

  const found = await findItemByUrlWithArchiveIdFallback(ytp, data, video_url);

  if (found) {
    const { item, id } = found;
    const status = (item.status ?? '').toLowerCase();

    if (status === 'finished') {
      const result = await buildTranscriptForFinishedItem(deps, video_url, item, id, lang, { fromArchive: false });
      if (result) return result;
      return startTranscriptJobAndReturnQueued(deps, video_url, preset, lang, {
        relay: VIDEO_ONLY_QUEUED_RELAY,
        ...(cookies?.trim() && { cookies: cookies.trim() }),
      });
    }

    if (status === 'error') {
      const msg = (item as HistoryItem & { error?: string }).error ?? 'YTPTube job ended with status error';
      throw new YTPTubeError(msg, 'error');
    }

    if (status === 'skip' || status === 'cancelled') {
      const result = await buildTranscriptForFinishedItem(deps, video_url, item, id, lang, { fromArchive: true }).catch((e) => {
        logger.warn({ err: e, video_url, id }, 'buildTranscriptForFinishedItem failed (skip path), returning skipped');
        return null;
      });
      if (result) return result;
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
                'Video was skipped (already in archive). Call request_video_transcript again with the same URL to try getting transcript from the existing download.',
              ...statusLanguageParams(lang),
            }),
          },
        ],
      };
    }

    const storedUrl = typeof item.url === 'string' ? item.url : undefined;
    const fresh = await getHistoryById(ytp, id).catch(() => item);
    const pct = formatProgress(fresh);
    const isQueued = status === 'queued' || status === 'pending' || pct === 0;
    if (isQueued) {
      return {
        content: [
          {
            type: 'text',
            text: formatStatusResponse({
              status: 'queued',
              job_id: id,
              url: video_url,
              status_url: storedUrl,
              canonical_key: canonicalKeyForDisplay(item, video_url),
              relay: 'Download started. Use get_status; when finished request transcript again.',
              ...statusLanguageParams(lang),
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
            url: video_url,
            status_url: storedUrl,
            canonical_key: canonicalKeyForDisplay(item, video_url),
            progress: pct,
            relay: `Downloading (${pct}%). Use get_status; when 100% request transcript again.`,
            ...statusLanguageParams(lang),
          }),
        },
      ],
    };
  }

  let cliBase = CLI_AUDIO;
  try {
    const info = await getUrlInfo(ytp, video_url);
    const hasSubs =
      (info.subtitles != null && Object.keys(info.subtitles).length > 0) ||
      (info.automatic_captions != null && Object.keys(info.automatic_captions).length > 0);
    if (hasSubs) {
      const subLangs = process.env.YTPTUBE_SUB_LANGS?.trim();
      cliBase = subLangs ? `${CLI_SUBS} --sub-langs "${subLangs}"` : CLI_SUBS;
    }
  } catch (e) {
    logger.debug({ err: e, video_url }, 'getUrlInfo failed, using audio CLI');
  }
  const proxy = getProxyUrl();
  const cli = proxy ? `${cliBase} --proxy ${proxy}` : cliBase;
  const body = {
    url: video_url,
    preset: preset ?? PRESET_TRANSCRIPT,
    folder: MCP_DOWNLOAD_FOLDER,
    cli,
    auto_start: true as const,
    ...(cookies?.trim() && { cookies: cookies.trim() }),
  };
  let postResult: HistoryItem[];
  try {
    postResult = await postHistory(ytp, body);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, video_url }, 'YTPTube POST /api/history failed');
    throw new YTPTubeError(`Failed to add URL to YTPTube: ${err.message}`);
  }

  // YTPTube may return the existing item when video is already downloaded (same URL in another form).
  // If POST returns exactly one item, treat it as the one we just added (handles different URL normalization by YTPTube).
  let postFound = findItemByUrlInItems(postResult, video_url);
  if (!postFound) postFound = await findItemByUrlInItemsWithArchiveIdFallback(ytp, postResult, video_url);
  if (!postFound && postResult.length === 1) {
    const single = postResult[0];
    const id = single?.id ?? (single as { _id?: string })?._id;
    if (id != null) postFound = { item: single, id: String(id) };
  }
  if (postFound) {
    const { item, id } = postFound;
    const status = (item.status ?? '').toLowerCase();
    const storedUrl = typeof item.url === 'string' ? item.url : undefined;
    logger.debug({ video_url, ytptubeUrl: storedUrl, status, id }, 'Matched video from POST response (already in YTPTube)');

    if (status === 'finished') {
      const result = await buildTranscriptForFinishedItem(deps, video_url, item, id, lang, { fromArchive: true });
      if (result) return result;
      return startTranscriptJobAndReturnQueued(deps, video_url, preset, lang, { relay: VIDEO_ONLY_QUEUED_RELAY });
    }

    if (status === 'error') {
      const msg = (item as HistoryItem & { error?: string }).error ?? 'YTPTube job ended with status error';
      throw new YTPTubeError(msg, 'error');
    }

    if (status === 'skip' || status === 'cancelled') {
      const result = await buildTranscriptForFinishedItem(deps, video_url, item, id, lang, { fromArchive: true }).catch((e) => {
        logger.warn({ err: e, video_url, id }, 'buildTranscriptForFinishedItem failed (postFound skip path), returning skipped');
        return null;
      });
      if (result) return result;
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
                'Video was skipped (already in archive). Call request_video_transcript again with the same URL to try getting transcript from the existing download.',
              ...statusLanguageParams(lang),
            }),
          },
        ],
      };
    }

    const pct = formatProgress(await getHistoryById(ytp, id).catch(() => item));
    const isQueued = status === 'queued' || status === 'pending' || pct === 0;
    if (isQueued) {
      return {
        content: [
          {
            type: 'text',
            text: formatStatusResponse({
              status: 'queued',
              job_id: id,
              url: video_url,
              status_url: storedUrl,
              canonical_key: canonicalKeyForDisplay(item, video_url),
              relay: 'Download started. Use get_status; when finished request transcript again.',
              ...statusLanguageParams(lang),
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
            url: video_url,
            status_url: storedUrl,
            canonical_key: canonicalKeyForDisplay(item, video_url),
            progress: pct,
            relay: `Downloading (${pct}%). Use get_status; when 100% request transcript again.`,
            ...statusLanguageParams(lang),
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
    throw new YTPTubeError(`Download was queued but could not resolve job id: ${err.message}`);
  }

  let afterFound = findItemByUrlInItems(queueItems, video_url) ?? (await findItemByUrlInItemsWithArchiveIdFallback(ytp, queueItems, video_url));
  if (!afterFound) {
    await new Promise((r) => setTimeout(r, POST_TO_QUEUE_DELAY_MS));
    try {
      queueItems = await getHistoryQueue(ytp);
      afterFound = findItemByUrlInItems(queueItems, video_url) ?? (await findItemByUrlInItemsWithArchiveIdFallback(ytp, queueItems, video_url));
    } catch {
      /* ignore retry errors, continue to check done */
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
            relay: 'Download started. Use get_status; when finished request transcript again.',
            ...statusLanguageParams(lang),
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
      const result = await buildTranscriptForFinishedItem(deps, video_url, item, id, lang, { fromArchive: true });
      if (result) return result;
      return startTranscriptJobAndReturnQueued(deps, video_url, preset, lang, { relay: VIDEO_ONLY_QUEUED_RELAY });
    }
    if (doneStatus === 'skip' || doneStatus === 'cancelled') {
      const { item, id } = doneFound;
      const result = await buildTranscriptForFinishedItem(deps, video_url, item, id, lang, { fromArchive: true }).catch((e) => {
        logger.warn({ err: e, video_url, id }, 'buildTranscriptForFinishedItem failed (doneFound skip path), returning skipped');
        return null;
      });
      if (result) return result;
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
                'Video was skipped (already in archive). Call request_video_transcript again with the same URL to try getting transcript from the existing download.',
              ...statusLanguageParams(lang),
            }),
          },
        ],
      };
    }
  }

  // POST succeeded but item not found in queue yet (may appear later).
  // Return status with video_url so user can check status later.
  return {
    content: [
      {
        type: 'text',
        text: formatStatusResponse({
          status: 'queued',
          url: video_url,
          canonical_key: canonicalVideoKey(video_url) ?? undefined,
          relay: 'Download queued. Use get_status with video_url to check; when finished request transcript again.',
          ...statusLanguageParams(lang),
        }),
      },
    ],
  };
}
