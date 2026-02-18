import { z } from 'zod';

/** Input for transcribe_audio_url tool. */
export const TranscribeAudioUrlSchema = z.object({
  audio_url: z
    .string()
    .url()
    .describe(
      'URL of the audio file to transcribe. Can be a direct download link (e.g. from request_download_link or create_download_link). File must be ≤25MB.',
    ),
  language_hint: z
    .string()
    .optional()
    .describe(
      'Optional. ISO-639-1 language code (e.g. "de", "en") to improve transcription accuracy. Omit for auto-detect.',
    ),
});

export type TranscribeAudioUrlInput = z.infer<typeof TranscribeAudioUrlSchema>;
