import { z } from 'zod';

export const ListRecentDownloadsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(10).describe('Max number of items to return (queue + done)'),
  status_filter: z.enum(['all', 'finished', 'queue']).optional().default('all').describe('Filter: all (default), finished, or queue only'),
});

export type ListRecentDownloadsInput = z.infer<typeof ListRecentDownloadsSchema>;
