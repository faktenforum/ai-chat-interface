import { z } from 'zod';

export const RequestDownloadLinkSchema = z.object({
  video_url: z.string().url().describe('Video URL to request download for'),
  type: z.enum(['audio', 'video']).optional().default('video').describe('Download type: video (default) or audio'),
  preset: z.string().optional().describe('YTPTube preset name'),
});

export type RequestDownloadLinkInput = z.infer<typeof RequestDownloadLinkSchema>;
