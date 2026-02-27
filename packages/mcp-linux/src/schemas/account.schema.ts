/**
 * Zod schemas for account tools
 */

import { z } from 'zod';

export const GetStatusSchema = z.object({});

export const ResetAccountSchema = z.object({
  confirm: z.boolean().describe('Must be true to confirm account reset (wipes all data!)'),
});
