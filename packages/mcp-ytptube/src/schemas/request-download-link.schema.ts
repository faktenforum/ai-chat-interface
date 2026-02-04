import { z } from 'zod';

export const RequestDownloadLinkSchema = z.object({
  media_url: z
    .string()
    .url()
    .describe('Media URL to request download for (video or audio-only; any yt-dlp-supported URL).'),
  type: z.enum(['audio', 'video']).optional().default('video').describe('Download type: video (default) or audio'),
  preset: z.string().optional().describe('YTPTube preset name'),
  cookies: z
    .string()
    .optional()
    .describe(
      'Optional. Netscape HTTP Cookie format; for age-restricted, login-required, or 403. User can export from browser (yt-dlp FAQ or extension) and paste in chat or upload file – if file uploaded, use its content here.',
    ),
});

export type RequestDownloadLinkInput = z.infer<typeof RequestDownloadLinkSchema>;
