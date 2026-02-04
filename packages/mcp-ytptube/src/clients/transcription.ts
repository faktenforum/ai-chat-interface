/**
 * OpenAI-compatible transcriptions API client.
 * POST {baseUrl}/audio/transcriptions with multipart file + model (e.g. whisper-1, whisper-large-v3).
 * Uses retry logic for transient failures (network, 5xx).
 */

import { withRetry } from '../utils/retry.ts';

export interface TranscriptionConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = 'whisper-1';

/** Supported audio extensions (OpenAI-compatible). Single source for MIME and filename checks. */
const MIME_BY_EXT: Record<string, string> = {
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

export const TRANSCRIPTION_SUPPORTED_EXTENSIONS = Object.keys(MIME_BY_EXT);

function normalizeBaseUrl(url: string): string {
  const u = url.replace(/\/+$/, '');
  return u.endsWith('/v1') ? u : `${u}/v1`;
}

function mimeForFilename(filename: string): string {
  const ext = filename.toLowerCase().replace(/^.*\./, '') || '';
  return MIME_BY_EXT[ext] ?? 'audio/mpeg';
}

/** Return a filename safe for transcription API: same stem, extension in supported list or `.ogg`. */
export function filenameForTranscription(relativePath: string, fallbackExt = 'ogg'): string {
  const name = relativePath.includes('/') ? relativePath.split('/').pop() ?? `audio.${fallbackExt}` : relativePath;
  const ext = name.toLowerCase().replace(/^.*\./, '') || '';
  if (TRANSCRIPTION_SUPPORTED_EXTENSIONS.includes(ext)) return name;
  const stem = name.replace(/\.[^.]+$/i, '') || 'audio';
  return `${stem}.${fallbackExt}`;
}

/**
 * Transcribe audio via OpenAI-compatible transcriptions endpoint.
 * Retries up to 3 times on transient errors (e.g. fetch failed, 5xx).
 * Supported formats: wav, mp3, flac, mpga, oga, ogg (filename extension used for MIME type).
 *
 * @param config - Transcription API config (baseUrl, apiKey, optional model)
 * @param audioBuffer - Raw audio bytes (format should match filename extension)
 * @param filename - Filename for the multipart part (e.g. "audio.ogg"); extension determines MIME type
 * @param language - Optional ISO-639-1 language code (e.g. "de", "en"); omit for auto-detect
 * @returns Transcript text
 */
export async function transcribe(
  config: TranscriptionConfig,
  audioBuffer: ArrayBuffer,
  filename: string = 'audio.mp3',
  language?: string,
): Promise<string> {
  return withRetry(
    async () => {
      const base = normalizeBaseUrl(config.baseUrl);
      const url = `${base}/audio/transcriptions`;
      const model = config.model ?? DEFAULT_MODEL;
      const mime = mimeForFilename(filename);

      const form = new FormData();
      form.append('model', model);
      form.append('file', new Blob([audioBuffer], { type: mime }), filename);
      if (language != null && language.trim() !== '') {
        form.append('language', language.trim().slice(0, 2));
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          // Do not set Content-Type; fetch sets multipart boundary
        },
        body: form,
      });

      if (!res.ok) {
        const text = await res.text();
        let err: string;
        try {
          const j = JSON.parse(text) as { error?: { message?: string }; message?: string };
          err = j.error?.message ?? j.message ?? text;
        } catch {
          err = text || res.statusText;
        }
        const error = new Error(`Transcription API failed (${res.status}): ${err}`) as Error & { retryable?: boolean };
        if (res.status >= 500) error.retryable = true;
        throw error;
      }

      const data = (await res.json()) as { text?: string };
      return typeof data.text === 'string' ? data.text : '';
    },
    { attempts: 3, delayMs: 1500 },
  );
}
