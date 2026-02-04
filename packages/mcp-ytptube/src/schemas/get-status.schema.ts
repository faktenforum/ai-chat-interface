import { z } from 'zod';

export const GetStatusSchema = z
  .object({
    job_id: z.string().optional().describe('YTPTube item ID (UUID) to check'),
    media_url: z.string().url().optional().describe('Media URL to look up (the URL you requested transcript/download for)'),
  })
  .refine((x) => x.job_id ?? x.media_url, { message: 'At least one of job_id or media_url is required' });

export type GetStatusInput = z.infer<typeof GetStatusSchema>;
