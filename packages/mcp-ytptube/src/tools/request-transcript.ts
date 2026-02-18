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
  findItemByUrlInAll,
  findItemByUrlAndType,
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
  buildPublicDownloadUrl,
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
import { getProxyUrl, jobAttemptContext, PRESET_SUBS, PRESET_AUDIO, TRANSCRIPTION_MAX_BYTES } from '../utils/env.ts';
import { isBlockedLikeError, sleepBeforeProxyRetry } from '../utils/blocked-retry.ts';

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

/**
 * Best-effort detection of the preset used for a history item.
 * YTPTube items usually expose `preset`, but we also defensively check `template`
 * for known MCP presets in case of version differences.
 */
function detectPresetFromItem(item: HistoryItem): string | null {
  const rawPreset = (item as { preset?: unknown }).preset;
  if (typeof rawPreset === 'string') {
    const preset = rawPreset.trim();
    if (preset) return preset;
  }

  const rawTemplate = (item as { template?: unknown }).template;
  if (typeof rawTemplate === 'string') {
    const template = rawTemplate.trim();
    if (template === PRESET_SUBS || template === PRESET_AUDIO || template === 'mcp_subs' || template === 'mcp_audio') {
      return template;
    }
  }

  return null;
}

/**
 * Determine transcript mode: 'subs' (subtitles-first) or 'audio' (transcription fallback).
 * Returns 'subs' if:
 * - getUrlInfo reports subtitles/automatic_captions present, OR
 * - extractor === 'youtube' (even without subtitle fields), OR
 * - getUrlInfo fails but URL canonical key starts with 'youtube:'
 * Otherwise returns 'audio'.
 */
async function determineTranscriptMode(
  ytp: YTPTubeConfig,
  mediaUrl: string,
): Promise<'subs' | 'audio'> {
  try {
    const info = await getUrlInfo(ytp, mediaUrl);
    const hasSubs =
      (info.subtitles != null && Object.keys(info.subtitles).length > 0) ||
      (info.automatic_captions != null && Object.keys(info.automatic_captions).length > 0);
    const extractor = info.extractor?.toLowerCase();
    const isYouTube = extractor === 'youtube';

    logger.debug(
      { mediaUrl, extractor, hasSubs, hasAutoCaptions: info.automatic_captions != null },
      'Transcript mode determination',
    );

    if (hasSubs || isYouTube) {
      logger.debug({ mediaUrl, mode: 'subs' }, 'Using subtitles-first mode');
      return 'subs';
    }

    logger.debug({ mediaUrl, mode: 'audio' }, 'Using audio transcription mode');
    return 'audio';
  } catch (e) {
    // Fallback: check canonical key for YouTube heuristic
    const canonicalKey = canonicalVideoKey(mediaUrl);
    if (canonicalKey?.startsWith('youtube:')) {
      logger.debug({ mediaUrl, mode: 'subs', reason: 'youtube_canonical_key' }, 'Using subtitles-first mode (YouTube heuristic)');
      return 'subs';
    }
    logger.debug({ err: e, mediaUrl, mode: 'audio' }, 'getUrlInfo failed, using audio mode');
    return 'audio';
  }
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
    if (lower.endsWith('.vtt') || lower.endsWith('.srt')) subtitlePath = pathFromItem;
    else if (AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) relativePath = pathFromItem;
  }
  if (!subtitlePath || !relativePath) {
    const browser = await getFileBrowser(ytp, folder);
    contents = browser.contents ?? [];
    if (!subtitlePath) subtitlePath = resolveSubtitlePathFromBrowser(contents, resolvedItem, lang);
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
      logger.debug({ id, subtitlePath, subtitleTextLength: subtitleText.length }, 'Subtitle parsed successfully');
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
    const reason = rawLength >= minContentForParsingError ? 'parse_failed' : 'empty_vtt';
    logger.warn(
      { id, mediaUrl, subtitlePath, rawLength, reason },
      'Subtitle file empty or unparseable; falling back to audio transcription',
    );
    // Phase 1 (subs) failed -> proceed to Phase 2 (audio)
  }

  if (!relativePath) {
    // Check sidecar for audio files (yt-dlp may extract audio to sidecar)
    try {
      const sidecar = resolvedItem.sidecar as { video?: Array<{ file?: string }>; audio?: Array<{ file?: string }> } | undefined;
      if (sidecar) {
        const audioFiles = [...(sidecar.video ?? []), ...(sidecar.audio ?? [])]
          .map((e) => e.file)
          .filter((f): f is string => typeof f === 'string' && f.length > 0);
        for (const audioFile of audioFiles) {
          const audioExts = ['.mp3', '.m4a', '.webm', '.opus', '.aac', '.ogg', '.wav'];
          const lower = audioFile.toLowerCase();
          if (audioExts.some((ext) => lower.endsWith(ext))) {
            // Extract relative path from absolute path
            const relative = audioFile.replace(/^\/+/, '').replace(/^downloads\//, '');
            relativePath = relative;
            logger.debug({ id, audioFile, relativePath }, 'Found audio file in sidecar');
            break;
          }
        }
      }
    } catch (e) {
      logger.debug({ err: e, id }, 'Failed to check sidecar for audio files');
    }

    // If we only see a video file but no audio/subtitle, check if this was a mcp_subs job
    // If it was mcp_subs, don't return null - let caller handle Phase 2 fallback
    if (!relativePath) {
      const itemPreset = detectPresetFromItem(resolvedItem);
      const wasSubsJob = itemPreset === PRESET_SUBS || itemPreset === 'mcp_subs';
      
      const hasVideoPath = pathFromItem && isVideoPath(pathFromItem);
      const videoPath = hasVideoPath ? pathFromItem : resolveVideoPathFromBrowser(contents, resolvedItem);
      
      if (videoPath) {
        if (wasSubsJob) {
          logger.debug({ id, itemPreset, videoPath }, 'mcp_subs job has video but no subtitle/audio; will trigger Phase 2');
          // Don't return null - let caller handle Phase 2 by throwing NotFoundError
          // This will be caught and trigger Phase 2 in requestTranscript
        } else {
          return null; // Video-only, not a subs job - caller will start new job
        }
      }
    }
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

  const audioSizeBytes = audioBuffer.byteLength;
  logger.debug({ id, audioPath: relativePath, audioSizeBytes }, 'Audio file downloaded for transcription');

  if (audioSizeBytes > TRANSCRIPTION_MAX_BYTES) {
    const sizeMB = (audioSizeBytes / (1024 * 1024)).toFixed(1);
    const limitMB = (TRANSCRIPTION_MAX_BYTES / (1024 * 1024)).toFixed(1);
    throw new TranscriptionError(
      `Audio file too large for transcription API (${sizeMB} MB > ${limitMB} MB limit). Try a shorter video, or use media with platform subtitles.`,
    );
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
 * Start a transcript job (subs or audio mode) and return queued status.
 * Used when URL is not in history and when a finished item is video-only (no audio/subtitle in folder).
 * Mode determines which preset to use; cli field is proxy-only (no audio/subtitle flags).
 */
async function startTranscriptJobAndReturnQueued(
  deps: RequestTranscriptDeps,
  mediaUrl: string,
  mode: 'subs' | 'audio',
  preset: string | undefined,
  lang: string | undefined,
  options: { relay?: string; language?: string; language_instruction?: string; cookies?: string; useProxy?: boolean } = {},
): Promise<{ content: TextContent[] }> {
  const { ytptube: ytp } = deps;
  const relay = options.relay ?? RELAY_QUEUED;
  const language = options.language ?? (lang ?? 'unknown');
  const language_instruction = options.language_instruction ?? (lang == null ? LANGUAGE_UNKNOWN_INSTRUCTION : undefined);
  const attemptCtx = jobAttemptContext(options.useProxy);

  const presetName = preset ?? (mode === 'subs' ? PRESET_SUBS : PRESET_AUDIO);
  const proxy = getProxyUrl(options.useProxy);
  // cli field is proxy-only; per-request language_hint can override --sub-langs via cli if needed
  let cli: string | undefined = proxy ? `--proxy ${proxy}` : undefined;
  if (mode === 'subs' && lang) {
    // Override preset's --sub-langs with language_hint
    const subLangs = `"${lang},-live_chat"`;
    cli = proxy ? `--sub-langs ${subLangs} --proxy ${proxy}` : `--sub-langs ${subLangs}`;
  }

  logger.debug({ mediaUrl, preset: presetName, mode, cliEffective: cli || '(preset only)' }, 'Starting transcript job');

  const body = {
    url: mediaUrl,
    preset: presetName,
    folder: MCP_DOWNLOAD_FOLDER,
    cli: cli || undefined,
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

  // Get history, queue, and done items (same as get_status does)
  const [data, queueItems, doneItems] = await Promise.all([
    getHistory(ytp).catch((e) => {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn({ err, mediaUrl }, 'YTPTube GET /api/history failed');
      throw new YTPTubeError(`Failed to check queue: ${err.message}`);
    }),
    getHistoryQueue(ytp).catch(() => [] as HistoryItem[]),
    getHistoryDone(ytp).catch(() => [] as HistoryItem[]),
  ]);

  // Find item using same logic as get_status (checks history, queue, and done)
  // Prefer finished audio items (Phase 2 results) over video items when multiple exist
  let found = await findItemByUrlInAll(ytp, data, mediaUrl, {
    queue: queueItems,
    done: doneItems,
  });
  
  // If multiple items exist, prefer finished audio items (Phase 2 transcripts)
  if (found) {
    try {
      const audioItem = await findItemByUrlAndType(ytp, data, mediaUrl, 'audio', {
        queue: queueItems,
        done: doneItems,
      });
      if (audioItem && (audioItem.item.status ?? '').toLowerCase() === 'finished') {
        found = audioItem;
        logger.debug({ mediaUrl, id: audioItem.id }, 'Preferring finished audio item (Phase 2)');
      }
    } catch (e) {
      logger.debug({ err: e, mediaUrl }, 'Failed to check for audio item, using first match');
    }
  }

  if (found) {
    const { item, id } = found;
    const status = (item.status ?? '').toLowerCase();

    if (status === 'finished') {
      logger.debug({ mediaUrl, id, status: 'finished' }, 'Found finished item, attempting to build transcript');
      let result: { content: TextContent[] } | null = null;
      try {
        result = await buildTranscriptForFinishedItem(deps, mediaUrl, item, id, lang, { fromArchive: false });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        // If TranscriptionError from a subs job (e.g. file too large), re-throw it
        // Phase 1 already attempted audio transcription and failed - don't retry Phase 2
        if (err instanceof TranscriptionError) {
          const itemPreset = detectPresetFromItem(item);
          const wasSubsJob = itemPreset === PRESET_SUBS || itemPreset === 'mcp_subs';
          if (wasSubsJob) {
            logger.debug({ err, mediaUrl, id }, 'TranscriptionError from subs job, re-throwing');
            throw err;
          }
        }
        // For other errors (e.g. NotFoundError for video-only items), continue to Phase 2
        logger.debug({ err, mediaUrl, id, errorType: err.name }, 'buildTranscriptForFinishedItem failed, continuing to Phase 2');
      }
      if (result) {
        logger.debug({ mediaUrl, id }, 'Successfully built transcript from finished item');
        return result;
      }
      logger.debug({ mediaUrl, id }, 'No transcript found in finished item, determining next phase');
      
      // Detect preset and determine if Phase 1 (subs) failed
      let itemPreset = detectPresetFromItem(item);
      let wasSubsJob = itemPreset === PRESET_SUBS || itemPreset === 'mcp_subs';
      
      // Heuristic: if preset missing but YouTube video with no subtitle file, assume failed subs job
      if (!wasSubsJob && !itemPreset) {
        const canonicalKey = canonicalVideoKey(mediaUrl);
        const isYouTube = canonicalKey?.startsWith('youtube:') ?? false;
        if (isYouTube) {
          try {
            const folder = (item.folder ?? '').trim() || MCP_DOWNLOAD_FOLDER;
            const browser = await getFileBrowser(ytp, folder);
            const contents = browser.contents ?? [];
            const hasVideo = resolveVideoPathFromBrowser(contents, item) != null;
            const hasSubtitle = resolveSubtitlePathFromBrowser(contents, item, lang) != null;
            const hasAudio = resolveAudioPathFromBrowser(contents, item) != null;
            
            // Also check sidecar for audio files
            let hasSidecarAudio = false;
            try {
              const sidecar = item.sidecar as { video?: Array<{ file?: string }>; audio?: Array<{ file?: string }> } | undefined;
              if (sidecar) {
                const audioFiles = [...(sidecar.video ?? []), ...(sidecar.audio ?? [])]
                  .map((e) => e.file)
                  .filter((f): f is string => typeof f === 'string' && f.length > 0);
                hasSidecarAudio = audioFiles.length > 0;
              }
            } catch (e) {
              logger.debug({ err: e, mediaUrl }, 'Failed to check sidecar in heuristic');
            }
            
            if (hasVideo && !hasSubtitle && !hasAudio && !hasSidecarAudio) {
              wasSubsJob = true;
              itemPreset = 'mcp_subs';
              logger.debug({ mediaUrl, id, canonicalKey }, 'Inferred failed subs job from file layout (video only, no subtitle/audio)');
            }
          } catch (e) {
            logger.debug({ err: e, mediaUrl }, 'Preset detection heuristic failed');
          }
        }
      }

      // Determine mode: if Phase 1 failed or YouTube finished item without transcript → Phase 2 (audio)
      const canonicalKey = canonicalVideoKey(mediaUrl);
      const isYouTube = canonicalKey?.startsWith('youtube:') ?? false;
      const mode: 'subs' | 'audio' =
        wasSubsJob || (isYouTube && status === 'finished')
          ? 'audio' // Phase 1 failed → Phase 2
          : await determineTranscriptMode(ytp, mediaUrl);
      
      // If Phase 1 (mcp_subs) failed and we have a video file, throw error to trigger handoff to file converter
      // The mcp_audio preset uses archive_audio.log, but if video is in main archive, yt-dlp will skip it
      // Solution: Use existing video file and handoff to file converter agent to extract audio
      if (wasSubsJob && mode === 'audio') {
        try {
          const folder = (item.folder ?? '').trim() || MCP_DOWNLOAD_FOLDER;
          const browser = await getFileBrowser(ytp, folder);
          const contents = browser.contents ?? [];
          const videoPath = resolveVideoPathFromBrowser(contents, item);
          
          if (videoPath) {
            logger.info(
              { mediaUrl, id, videoPath, itemPreset },
              'Phase 1 (mcp_subs) failed but video was downloaded. Getting download URL for handoff to file converter.',
            );
            // Get download URL for the video file
            const publicBaseUrl = process.env.YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL?.trim() || undefined;
            const videoDownloadUrl = buildPublicDownloadUrl(videoPath, publicBaseUrl || ytp.baseUrl, ytp.apiKey);
            
            // Throw error with download URL to trigger handoff
            throw new TranscriptionError(
              `Phase 1 (subtitle extraction) failed but video file is available. Get download URL via request_download_link(media_url="${mediaUrl}", type="video"), then handoff to file converter agent to extract audio and create transcript chunks. Video download URL: ${videoDownloadUrl}`,
            );
          }
        } catch (e) {
          // If error is already TranscriptionError, re-throw it
          if (e instanceof TranscriptionError) throw e;
          logger.debug({ err: e, mediaUrl }, 'Failed to check for existing video, starting Phase 2 job');
        }
      }
      
      logger.debug({ mediaUrl, id, itemPreset, wasSubsJob, mode }, 'Starting transcript job (Phase 1 failed or video-only)');
      return startTranscriptJobAndReturnQueued(deps, mediaUrl, mode, preset, lang, {
        relay: RELAY_VIDEO_ONLY_QUEUED,
        ...(cookies?.trim() && { cookies: cookies.trim() }),
      });
    }

    if (status === 'error') {
      const msg = getItemErrorMessage(item);
      if (isBlockedLikeError(msg) && getProxyUrl(true)) {
        logger.info({ mediaUrl }, 'Blocked-like error, retrying with new job (with proxy)');
        await sleepBeforeProxyRetry();
        const mode = await determineTranscriptMode(ytp, mediaUrl);
        return startTranscriptJobAndReturnQueued(deps, mediaUrl, mode, preset, lang, {
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

  // Not found: start Phase 1 (subs) or Phase 2 (audio) based on mode determination
  const mode = await determineTranscriptMode(ytp, mediaUrl);
  return startTranscriptJobAndReturnQueued(deps, mediaUrl, mode, preset, lang, {
    ...(cookies?.trim() && { cookies: cookies.trim() }),
  });
}
