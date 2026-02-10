/**
 * Zod schemas for download tools
 */

import { z } from 'zod';

export const CreateDownloadLinkSchema = z.object({
  workspace: z.string().default('default').describe('Workspace name (default: "default")'),
  file_path: z
    .string()
    .min(1)
    .describe('Path to the file relative to the workspace root (e.g. "output/result.csv")'),
  expires_in_minutes: z
    .number()
    .min(1)
    .max(1440)
    .default(60)
    .describe('Link expiry in minutes (default: 60, max: 1440 = 24h)'),
});

export const ListDownloadLinksSchema = z.object({
  active_only: z.boolean().default(true).describe('Only show active sessions (default: true)'),
});

export const CloseDownloadLinkSchema = z.object({
  token: z.string().min(1).describe('Download session token to close'),
});
