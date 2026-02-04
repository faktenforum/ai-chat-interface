/**
 * Tool: request_transcript
 * Get transcript for a media URL (video or audio-only), or start download / report in-progress. No blocking when downloading.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { RequestTranscriptSchema, type RequestTranscriptInput } from '../schemas/request-transcript.schema.ts';
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
  formatProgress,
  MCP_DOWNLOAD_FOLDER,
  type GetHistoryResponse,
  type HistoryItem,
} from '../clients/ytptube.ts';
import type { TranscriptionConfig } from '../clients/transcription.ts';
import { transcribe, filenameForTranscription } from '../clients/transcription.ts';
import {
  InvalidUrlError,
  InvalidCookiesError,
  YTPTubeError,
  TranscriptionError,
  TranscriptionNotConfiguredError,
  NotFoundError,
} from '../utils/errors.ts';
import { isValidNetscapeCookieFormat, INVALID_COOKIES_MESSAGE } from '../utils/netscape-cookies.ts';
import { logger } from '../utils/logger.ts';
import { formatTranscriptResponseAsBlocks, formatStatusResponse } from '../utils/response-format.ts';
import { vttToPlainText } from '../utils/vtt-to-text.ts';
import { getProxyUrl, jobAttemptContext, CLI_AUDIO, CLI_SUBS, PRESET_TRANSCRIPT } from '../utils/env.ts';
import { isBlockedLikeError } from '../utils/blocked-retry.ts';

const POST_TO_QUEUE_DELAY_MS = 500;

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v', '.flv'];
/** Audio extensions for path-from-item (yt-dlp may output m4a, webm, opus, etc.). */
const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.webm', '.opus', '.aac', '.ogg', '.wav'];

function isVideoPath(path: string): boolean {
  const lower = (path ?? '').toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export interface RequestTranscriptDeps {
  ytptube: YTPTubeConfig;
  transcription: TranscriptionConfig | null;
}

const RELAY_QUEUED = 'Download started. Use get_status; when finished request transcript again.';
const RELAY_QUEUED_FALLBACK = 'Download queued. Use get_status with media_url to check; when finished request transcript again.';
const RELAY_VIDEO_ONLY_QUEUED = 'Item was video-only; started transcript job. Use get_status; when finished request transcript again.';
const RELAY_RETRY_WITH_PROXY = 'Previous attempt may have been blocked. Started new job (with proxy). Use get_status; when finished request transcript again.';

/** Shown when no language_hint: LLM should ask user for correct language and re-call with language_hint. */
const LANGUAGE_UNKNOWN_INSTRUCTION =
  'If the transcript language is wrong, ask the user for the correct language and call request_transcript again with language_hint set to that language (e.g. language_hint: "de" for German).';

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

/** Error message from a YTPTube history item (status=error). API may use error, reason, or message. */
function getItemErrorMessage(item: HistoryItem): string {
  const o = item as { error?: string; reason?: string; message?: string };
  return o.error ?? o.reason ?? o.message ?? 'YTPTube job ended with status error';
}

/** Build yt-dlp CLI for transcript job: subs-only if available, else audio; optional proxy. useProxy: true = retry with proxy. */
async function buildTranscriptCli(
  ytp: YTPTubeConfig,
  mediaUrl: string,
  opts?: { useProxy?: boolean },
): Promise<string> {
  let cliBase = CLI_AUDIO;
  try {
    const info = await getUrlInfo(ytp, mediaUrl);
    const hasSubs =
      (info.subtitles != null && Object.keys(info.subtitles).length > 0) ||
      (info.automatic_captions != null && Object.keys(info.automatic_captions).length > 0);
    if (hasSubs) {
      const subLangs = process.env.YTPTUBE_SUB_LANGS?.trim();
      cliBase = subLangs ? `${CLI_SUBS} --sub-langs "${subLangs}"` : CLI_SUBS;
    }
  } catch (e) {
    logger.debug({ err: e, mediaUrl }, 'getUrlInfo failed, using audio CLI');
  }
  const proxy = getProxyUrl(opts?.useProxy);
  if (proxy) {
    logger.info({ mediaUrl }, 'Transcript job will use proxy (Webshare/YTPTUBE_PROXY)');
  }
  return proxy ? `${cliBase} --proxy ${proxy}` : cliBase;
}

type FileBrowserContents = Awaited<ReturnType<typeof getFileBrowser>>['contents'];

/**
 * Build transcript content for a finished history item (subtitle VTT or audio → transcription API).
 * Returns content array, or null if item is video-only (caller should start transcript job).
 */
async function buildTranscriptForFinishedItem(
  deps: RequestTranscriptDeps,
  mediaUrl: string,
  item: HistoryItem,
  id: string,
  lang: string | undefined,
  options: { fromArchive?: boolean },
): Promise<{ content: TextContent[] } | null> {
  const { ytptube: ytp, transcription } = deps;
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
        const results = await getArchiveIdForUrls(ytp, [mediaUrl]);
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
        logger.debug({ err: e, mediaUrl }, 'getArchiveIdForUrls fallback failed');
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
    const subtitleText = (vttToPlainText(buffer) ?? '').trim();
    if (subtitleText.length > 0) {
      const { metadata, transcript: transcriptText } = formatTranscriptResponseAsBlocks({
        url: mediaUrl,
        job_id: id,
        transcript: subtitleText,
        fromArchive: options.fromArchive,
        status_url: storedUrl,
        transcript_source: 'platform_subtitles',
        canonical_key: canonicalKeyForDisplay(resolvedItem, mediaUrl),
        ...langParams,
      });
      return { content: [{ type: 'text', text: metadata }, { type: 'text', text: transcriptText }] };
    }
    const rawLength = new TextDecoder('utf-8').decode(buffer).length;
    const minContentForParsingError = 150;
    if (rawLength >= minContentForParsingError) {
      logger.warn(
        { id, subtitlePath, rawLength },
        'VTT had substantial content but parser returned no text; possible format mismatch (e.g. comma in timestamps). Falling back to audio.',
      );
    } else {
      logger.debug({ id, subtitlePath }, 'Subtitle VTT empty or no cues; falling back to audio transcription');
    }
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

  if (!transcription) {
    throw new TranscriptionNotConfiguredError(
      'No platform subtitles available; audio transcription is not configured. Set TRANSCRIPTION_BASE_URL and TRANSCRIPTION_API_KEY to enable it, or use media that provides subtitles.',
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
  const filename = filenameForTranscription(relativePath);
  let text: string;
  try {
    text = await transcribe(transcription, audioBuffer, filename, lang);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, id }, 'Transcription API failed');
    throw new TranscriptionError(`Transcription failed: ${err.message}`);
  }
  const { metadata, transcript: transcriptText } = formatTranscriptResponseAsBlocks({
    url: mediaUrl,
    job_id: id,
    transcript: text ?? '',
    fromArchive: options.fromArchive,
    status_url: storedUrl,
    transcript_source: 'transcription',
    canonical_key: canonicalKeyForDisplay(resolvedItem, mediaUrl),
    ...langParams,
  });
  return { content: [{ type: 'text', text: metadata }, { type: 'text', text: transcriptText }] };
}

/**
 * Build transcript CLI (subs or audio), POST to YTPTube, find the new item in the response, and return a queued status.
 * Used when URL is not in history and when a finished item is video-only (no audio/subtitle in folder).
 */
async function startTranscriptJobAndReturnQueued(
  deps: RequestTranscriptDeps,
  mediaUrl: string,
  preset: string | undefined,
  lang: string | undefined,
  options: { relay?: string; language?: string; language_instruction?: string; cookies?: string; useProxy?: boolean } = {},
): Promise<{ content: TextContent[] }> {
  const { ytptube: ytp } = deps;
  const relay = options.relay ?? RELAY_QUEUED;
  const language = options.language ?? (lang ?? 'unknown');
  const language_instruction = options.language_instruction ?? (lang == null ? LANGUAGE_UNKNOWN_INSTRUCTION : undefined);
  const attemptCtx = jobAttemptContext(options.useProxy);

  const cli = await buildTranscriptCli(ytp, mediaUrl, { useProxy: options.useProxy });
  const body = {
    url: mediaUrl,
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
    logger.warn({ err, mediaUrl }, 'YTPTube POST /api/history failed');
    throw new YTPTubeError(`Failed to add URL to YTPTube: ${err.message}`);
  }

  let postFound = findItemByUrlInItems(postResult, mediaUrl);
  if (!postFound) postFound = await findItemByUrlInItemsWithArchiveIdFallback(ytp, postResult, mediaUrl);
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
            url: mediaUrl,
            status_url: storedUrl,
            canonical_key: canonicalKeyForDisplay(postFound.item, mediaUrl),
            relay,
            language,
            language_instruction,
            proxy_used: attemptCtx.proxy_used,
            attempt: attemptCtx.attempt,
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
          url: mediaUrl,
          canonical_key: canonicalVideoKey(mediaUrl) ?? undefined,
          relay: RELAY_QUEUED_FALLBACK,
          language,
          language_instruction,
          proxy_used: attemptCtx.proxy_used,
          attempt: attemptCtx.attempt,
        }),
      },
    ],
  };
}

/**
 * request_transcript(media_url, preset?, language_hint?, cookies?)
 * Resolve by URL; if finished return transcript; if downloading/queued return status; if not found POST and return queued.
 */
export async function requestTranscript(
  input: unknown,
  deps: RequestTranscriptDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = RequestTranscriptSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new InvalidUrlError(msg);
  }

  const { media_url: mediaUrl, preset, language_hint, cookies } = parsed.data as RequestTranscriptInput;
  if (cookies?.trim() && !isValidNetscapeCookieFormat(cookies)) {
    throw new InvalidCookiesError(INVALID_COOKIES_MESSAGE);
  }
  const lang = language_hint?.trim() ? language_hint.trim().slice(0, 2).toLowerCase() : undefined;
  const ytp = deps.ytptube;

  let data: GetHistoryResponse;
  try {
    data = await getHistory(ytp);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, mediaUrl }, 'YTPTube GET /api/history failed');
    throw new YTPTubeError(`Failed to check queue: ${err.message}`);
  }

  const found = await findItemByUrlWithArchiveIdFallback(ytp, data, mediaUrl);

  if (found) {
    const { item, id } = found;
    const status = (item.status ?? '').toLowerCase();

    if (status === 'finished') {
      const result = await buildTranscriptForFinishedItem(deps, mediaUrl, item, id, lang, { fromArchive: false });
      if (result) return result;
      return startTranscriptJobAndReturnQueued(deps, mediaUrl, preset, lang, {
        relay: RELAY_VIDEO_ONLY_QUEUED,
        ...(cookies?.trim() && { cookies: cookies.trim() }),
      });
    }

    if (status === 'error') {
      const msg = getItemErrorMessage(item);
      if (isBlockedLikeError(msg) && getProxyUrl(true)) {
        logger.info({ mediaUrl }, 'Blocked-like error, retrying with new job (with proxy)');
        return startTranscriptJobAndReturnQueued(deps, mediaUrl, preset, lang, {
          relay: RELAY_RETRY_WITH_PROXY,
          useProxy: true,
          ...(cookies?.trim() && { cookies: cookies.trim() }),
        });
      }
      throw new YTPTubeError(msg, 'error');
    }

    if (status === 'skip' || status === 'cancelled') {
      const result = await buildTranscriptForFinishedItem(deps, mediaUrl, item, id, lang, { fromArchive: true }).catch((e) => {
        logger.warn({ err: e, mediaUrl, id }, 'buildTranscriptForFinishedItem failed (skip path), returning skipped');
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
              url: mediaUrl,
              status_url: typeof item.url === 'string' ? item.url : undefined,
              canonical_key: canonicalKeyForDisplay(item, mediaUrl),
              reason,
              relay:
                'Media was skipped (already in archive). Call request_transcript again with the same URL to try getting transcript from the existing download.',
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
              url: mediaUrl,
              status_url: storedUrl,
              canonical_key: canonicalKeyForDisplay(item, mediaUrl),
              relay: RELAY_QUEUED,
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
            url: mediaUrl,
            status_url: storedUrl,
            canonical_key: canonicalKeyForDisplay(item, mediaUrl),
            progress: pct,
            relay: `Downloading (${pct}%). Use get_status; when 100% request transcript again.`,
            ...statusLanguageParams(lang),
          }),
        },
      ],
    };
  }

  const attemptCtxFirst = jobAttemptContext();
  const cli = await buildTranscriptCli(ytp, mediaUrl);
  const body = {
    url: mediaUrl,
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
    logger.warn({ err, mediaUrl }, 'YTPTube POST /api/history failed');
    throw new YTPTubeError(`Failed to add URL to YTPTube: ${err.message}`);
  }

  let postFound = findItemByUrlInItems(postResult, mediaUrl);
  if (!postFound) postFound = await findItemByUrlInItemsWithArchiveIdFallback(ytp, postResult, mediaUrl);
  if (!postFound && postResult.length === 1) {
    const single = postResult[0];
    const id = single?.id ?? (single as { _id?: string })?._id;
    if (id != null) postFound = { item: single, id: String(id) };
  }
  if (postFound) {
    const { item, id } = postFound;
    const status = (item.status ?? '').toLowerCase();
    const storedUrl = typeof item.url === 'string' ? item.url : undefined;
    logger.debug({ mediaUrl, ytptubeUrl: storedUrl, status, id }, 'Matched media from POST response (already in YTPTube)');

    if (status === 'finished') {
      const result = await buildTranscriptForFinishedItem(deps, mediaUrl, item, id, lang, { fromArchive: true });
      if (result) return result;
      return startTranscriptJobAndReturnQueued(deps, mediaUrl, preset, lang, { relay: RELAY_VIDEO_ONLY_QUEUED });
    }

    if (status === 'error') {
      const msg = getItemErrorMessage(item);
      if (isBlockedLikeError(msg) && getProxyUrl(true)) {
        logger.info({ mediaUrl }, 'Blocked-like error, retrying with new job (with proxy)');
        return startTranscriptJobAndReturnQueued(deps, mediaUrl, preset, lang, {
          relay: RELAY_RETRY_WITH_PROXY,
          useProxy: true,
          ...(cookies?.trim() && { cookies: cookies.trim() }),
        });
      }
      throw new YTPTubeError(msg, 'error');
    }

    if (status === 'skip' || status === 'cancelled') {
      const result = await buildTranscriptForFinishedItem(deps, mediaUrl, item, id, lang, { fromArchive: true }).catch((e) => {
        logger.warn({ err: e, mediaUrl, id }, 'buildTranscriptForFinishedItem failed (postFound skip path), returning skipped');
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
              url: mediaUrl,
              status_url: storedUrl,
              canonical_key: canonicalKeyForDisplay(item, mediaUrl),
              reason,
              relay:
                'Media was skipped (already in archive). Call request_transcript again with the same URL to try getting transcript from the existing download.',
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
              url: mediaUrl,
              status_url: storedUrl,
              canonical_key: canonicalKeyForDisplay(item, mediaUrl),
              relay: RELAY_QUEUED,
              proxy_used: attemptCtxFirst.proxy_used,
              attempt: attemptCtxFirst.attempt,
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
            url: mediaUrl,
            status_url: storedUrl,
            canonical_key: canonicalKeyForDisplay(item, mediaUrl),
            progress: pct,
            relay: `Downloading (${pct}%). Use get_status; when 100% request transcript again.`,
            proxy_used: attemptCtxFirst.proxy_used,
            attempt: attemptCtxFirst.attempt,
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
    logger.warn({ err, mediaUrl }, 'YTPTube GET /api/history?type=queue after POST failed');
    throw new YTPTubeError(`Download was queued but could not resolve job id: ${err.message}`);
  }

  let afterFound = findItemByUrlInItems(queueItems, mediaUrl) ?? (await findItemByUrlInItemsWithArchiveIdFallback(ytp, queueItems, mediaUrl));
  if (!afterFound) {
    await new Promise((r) => setTimeout(r, POST_TO_QUEUE_DELAY_MS));
    try {
      queueItems = await getHistoryQueue(ytp);
      afterFound = findItemByUrlInItems(queueItems, mediaUrl) ?? (await findItemByUrlInItemsWithArchiveIdFallback(ytp, queueItems, mediaUrl));
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
            url: mediaUrl,
            status_url: storedUrl,
            canonical_key: canonicalKeyForDisplay(afterFound.item, mediaUrl),
            relay: RELAY_QUEUED,
            proxy_used: attemptCtxFirst.proxy_used,
            attempt: attemptCtxFirst.attempt,
            ...statusLanguageParams(lang),
          }),
        },
      ],
    };
  }

  const doneItems = await getHistoryDone(ytp).catch(() => [] as HistoryItem[]);
  const doneFound =
    findItemByUrlInItems(doneItems, mediaUrl) ?? (await findItemByUrlInItemsWithArchiveIdFallback(ytp, doneItems, mediaUrl));
  if (doneFound) {
    const doneStatus = (doneFound.item.status ?? '').toLowerCase();
    if (doneStatus === 'finished') {
      const { item, id } = doneFound;
      const result = await buildTranscriptForFinishedItem(deps, mediaUrl, item, id, lang, { fromArchive: true });
      if (result) return result;
      return startTranscriptJobAndReturnQueued(deps, mediaUrl, preset, lang, { relay: RELAY_VIDEO_ONLY_QUEUED });
    }
    if (doneStatus === 'skip' || doneStatus === 'cancelled') {
      const { item, id } = doneFound;
      const result = await buildTranscriptForFinishedItem(deps, mediaUrl, item, id, lang, { fromArchive: true }).catch((e) => {
        logger.warn({ err: e, mediaUrl, id }, 'buildTranscriptForFinishedItem failed (doneFound skip path), returning skipped');
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
              url: mediaUrl,
              status_url: typeof item.url === 'string' ? item.url : undefined,
              canonical_key: canonicalKeyForDisplay(item, mediaUrl),
              reason,
              relay:
                'Media was skipped (already in archive). Call request_transcript again with the same URL to try getting transcript from the existing download.',
              ...statusLanguageParams(lang),
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
          url: mediaUrl,
          canonical_key: canonicalVideoKey(mediaUrl) ?? undefined,
          relay: RELAY_QUEUED_FALLBACK,
          proxy_used: attemptCtxFirst.proxy_used,
          attempt: attemptCtxFirst.attempt,
          ...statusLanguageParams(lang),
        }),
      },
    ],
  };
}
