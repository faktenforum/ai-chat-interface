import { z } from 'zod';

export const GetMediaInfoSchema = z.object({
  media_url: z
    .string()
    .url()
    .describe('Media URL to fetch metadata for (video or audio-only; any yt-dlp-supported URL).'),
});

export type GetMediaInfoInput = z.infer<typeof GetMediaInfoSchema>;
