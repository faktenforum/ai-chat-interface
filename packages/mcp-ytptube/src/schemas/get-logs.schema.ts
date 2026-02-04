import { z } from 'zod';

export const GetLogsSchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0).describe('Log entries to skip'),
  limit: z.coerce.number().int().min(1).max(150).optional().default(100).describe('Log entries to return (max 150)'),
});

export type GetLogsInput = z.infer<typeof GetLogsSchema>;
