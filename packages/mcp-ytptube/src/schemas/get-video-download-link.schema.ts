import { z } from 'zod';

export const GetVideoDownloadLinkSchema = z.object({
  video_url: z.string().url().optional().describe('Video URL to look up'),
  job_id: z.string().optional().describe('YTPTube history item ID'),
  type: z.enum(['audio', 'video']).optional().default('audio').describe('Download type: audio (default) or video'),
}).refine((data) => data.video_url != null || data.job_id != null, {
  message: 'At least one of video_url or job_id is required',
});

export type GetVideoDownloadLinkInput = z.infer<typeof GetVideoDownloadLinkSchema>;
