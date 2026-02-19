/**
 * Tool: transcribe_audio_url
 * Transcribe an audio file directly from a URL. Downloads the file in memory and transcribes it.
 * Used for transcribing audio chunks created by the file converter agent.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { TranscribeAudioUrlSchema, type TranscribeAudioUrlInput } from '../schemas/transcribe-audio-url.schema.ts';
import type { TranscriptionConfig } from '../clients/transcription.ts';
import { transcribe, filenameForTranscription } from '../clients/transcription.ts';
import { InvalidUrlError, TranscriptionError, TranscriptionNotConfiguredError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';
import { formatTranscriptResponseAsBlocks } from '../utils/response-format.ts';
import { TRANSCRIPTION_MAX_BYTES } from '../utils/env.ts';

export interface TranscribeAudioUrlDeps {
  transcription: TranscriptionConfig | null;
}

/**
 * Extract filename from URL for transcription API.
 * Falls back to 'audio.mp3' if no filename can be extracted.
 */
function extractFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop() || '';
    if (filename && filename.includes('.')) {
      return filenameForTranscription(filename);
    }
  } catch (e) {
    logger.debug({ err: e, url }, 'Failed to extract filename from URL');
  }
  return 'audio.mp3';
}

/**
 * transcribe_audio_url(audio_url, language_hint?)
 * Download audio file from URL and transcribe it. File must be ≤25MB.
 * Returns transcript text with metadata.
 */
export async function transcribeAudioUrl(
  input: unknown,
  deps: TranscribeAudioUrlDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = TranscribeAudioUrlSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new InvalidUrlError(msg);
  }

  const { audio_url: audioUrl, language_hint } = parsed.data as TranscribeAudioUrlInput;
  const lang = language_hint?.trim() ? language_hint.trim().slice(0, 2).toLowerCase() : undefined;

  if (!deps.transcription) {
    throw new TranscriptionNotConfiguredError(
      'Audio transcription is not configured. Set TRANSCRIPTION_BASE_URL and TRANSCRIPTION_API_KEY to enable it.',
    );
  }

  logger.debug({ audioUrl, language: lang }, 'Downloading audio file from URL for transcription');

  // Download audio file directly into memory
  let audioBuffer: ArrayBuffer;
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    audioBuffer = await response.arrayBuffer();
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, audioUrl }, 'Failed to download audio file from URL');
    throw new TranscriptionError(`Failed to download audio file: ${err.message}`);
  }

  const audioSizeBytes = audioBuffer.byteLength;
  logger.debug({ audioUrl, audioSizeBytes }, 'Audio file downloaded, checking size');

  // Check file size limit
  if (audioSizeBytes > TRANSCRIPTION_MAX_BYTES) {
    const sizeMB = (audioSizeBytes / (1024 * 1024)).toFixed(1);
    const limitMB = (TRANSCRIPTION_MAX_BYTES / (1024 * 1024)).toFixed(1);
    throw new TranscriptionError(
      `Audio file too large for transcription API (${sizeMB} MB > ${limitMB} MB limit). Use file converter agent to split into smaller chunks.`,
    );
  }

  // Extract filename from URL for transcription API
  const filename = extractFilenameFromUrl(audioUrl);

  // Transcribe directly from buffer (no temporary file needed)
  let text: string;
  try {
    text = await transcribe(deps.transcription, audioBuffer, filename, lang);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, audioUrl }, 'Transcription API failed');
    throw new TranscriptionError(`Transcription failed: ${err.message}`);
  }

  // Format response
  const langParams = {
    language_used: lang ?? 'unknown',
    language_instruction: lang == null ? 'If the transcript language is wrong, call transcribe_audio_url again with language_hint set to the correct language (e.g. language_hint: "de" for German).' : undefined,
  };

  const { metadata, transcript: transcriptText } = formatTranscriptResponseAsBlocks({
    url: audioUrl,
    job_id: 'direct_url_transcription',
    transcript: text ?? '',
    fromArchive: false,
    transcript_source: 'transcription',
    ...langParams,
  });

  return { content: [{ type: 'text', text: metadata }, { type: 'text', text: transcriptText }] };
}
