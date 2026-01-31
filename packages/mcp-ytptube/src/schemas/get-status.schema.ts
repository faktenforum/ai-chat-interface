import { z } from 'zod';

export const GetStatusSchema = z
  .object({
    job_id: z.string().optional().describe('YTPTube item ID (UUID) to check'),
    video_url: z.string().url().optional().describe('Video URL to look up (any item)'),
  })
  .refine((x) => x.job_id ?? x.video_url, { message: 'At least one of job_id or video_url is required' });

export type GetStatusInput = z.infer<typeof GetStatusSchema>;
