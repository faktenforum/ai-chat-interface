import { z } from 'zod';

export const GetVideoInfoSchema = z.object({
  video_url: z.string().url().describe('Video URL to fetch metadata for'),
});

export type GetVideoInfoInput = z.infer<typeof GetVideoInfoSchema>;
