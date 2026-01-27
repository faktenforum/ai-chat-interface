/**
 * Scaleway Transcriptions API client (OpenAI-compatible).
 * POST {baseUrl}/audio/transcriptions with multipart file + model (e.g. whisper-large-v3).
 */

export interface ScalewayConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = 'whisper-large-v3';

function normalizeBaseUrl(url: string): string {
  const u = url.replace(/\/+$/, '');
  return u.endsWith('/v1') ? u : `${u}/v1`;
}

/**
 * Transcribe audio via Scaleway OpenAI-compatible transcriptions endpoint.
 * @param audioBuffer - Raw audio bytes (e.g. mp3)
 * @param filename - Optional filename for the multipart part (e.g. "audio.mp3")
 * @returns Transcript text
 */
export async function transcribe(
  config: ScalewayConfig,
  audioBuffer: ArrayBuffer,
  filename: string = 'audio.mp3',
): Promise<string> {
  const base = normalizeBaseUrl(config.baseUrl);
  const url = `${base}/audio/transcriptions`;
  const model = config.model ?? DEFAULT_MODEL;

  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), filename);

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
    throw new Error(`Scaleway transcription failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { text?: string };
  return typeof data.text === 'string' ? data.text : '';
}
