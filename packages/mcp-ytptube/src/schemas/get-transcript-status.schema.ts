import { z } from 'zod';

export const GetTranscriptStatusSchema = z
  .object({
    job_id: z.string().optional().describe('YTPTube history item ID to check'),
    video_url: z.string().url().optional().describe('Video URL to look up by URL'),
  })
  .refine((x) => x.job_id ?? x.video_url, { message: 'At least one of job_id or video_url is required' });

export type GetTranscriptStatusInput = z.infer<typeof GetTranscriptStatusSchema>;
