import { z } from 'zod';

export const GetHistoryItemSchema = z.object({
  job_id: z.string().min(1).describe('YTPTube item ID (UUID from get_status or list_recent_downloads)'),
});

export type GetHistoryItemInput = z.infer<typeof GetHistoryItemSchema>;
