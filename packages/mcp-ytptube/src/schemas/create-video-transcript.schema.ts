import { z } from 'zod';

export const CreateVideoTranscriptSchema = z.object({
  video_url: z.string().url().describe('URL of the video to transcribe (e.g. YouTube, Vimeo)'),
  preset: z.string().optional().describe('YTPTube preset name (e.g. for audio-only). Omit to use default or inline cli.'),
  language_hint: z
    .string()
    .optional()
    .describe(
      'Force/override transcription language (ISO-639-1, e.g. "de", "en"). Omit → language=unknown; if wrong, ask user and re-call with language_hint.',
    ),
  cookies: z
    .string()
    .optional()
    .describe(
      'Optional. Netscape HTTP Cookie format; for age-restricted, login-required, or 403. User can export from browser (yt-dlp FAQ or extension) and paste in chat or upload file – if file uploaded, use its content here.',
    ),
});

export type CreateVideoTranscriptInput = z.infer<typeof CreateVideoTranscriptSchema>;
