import { z } from 'zod';

export const CreateVideoTranscriptSchema = z.object({
  video_url: z.string().url().describe('URL of the video to transcribe (e.g. YouTube, Vimeo)'),
  preset: z.string().optional().describe('YTPTube preset name (e.g. for audio-only). Omit to use default or inline cli.'),
  language_hint: z.string().optional().describe('Optional hint for spoken language (e.g. "de", "en") for the transcription model'),
});

export type CreateVideoTranscriptInput = z.infer<typeof CreateVideoTranscriptSchema>;
