import { z } from 'zod';

export const GetThumbnailUrlSchema = z.object({
  media_url: z.string().url().describe('Media URL to get thumbnail for (may be empty for audio-only).'),
});

export type GetThumbnailUrlInput = z.infer<typeof GetThumbnailUrlSchema>;
