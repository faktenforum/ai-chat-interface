import { z } from 'zod';

export const GetThumbnailUrlSchema = z.object({
  video_url: z.string().url().describe('Video URL to get thumbnail for'),
});

export type GetThumbnailUrlInput = z.infer<typeof GetThumbnailUrlSchema>;
