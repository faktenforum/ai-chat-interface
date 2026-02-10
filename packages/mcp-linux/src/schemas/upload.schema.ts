/**
 * Zod schemas for upload tools
 */

import { z } from 'zod';

export const CreateUploadSessionSchema = z.object({
  workspace: z.string().default('default').describe('Workspace name (default: "default")'),
  expires_in_minutes: z
    .number()
    .min(1)
    .max(60)
    .default(15)
    .describe('Session expiry in minutes (default: 15, max: 60)'),
  max_file_size_mb: z
    .number()
    .min(1)
    .max(500)
    .default(100)
    .describe('Maximum file size in MB (default: 100, max: 500)'),
  allowed_extensions: z
    .array(z.string())
    .optional()
    .describe('Optional list of allowed file extensions (e.g. [".pdf", ".csv"])'),
});

export const ListUploadSessionsSchema = z.object({
  active_only: z.boolean().default(true).describe('Only show active sessions (default: true)'),
});

export const CloseUploadSessionSchema = z.object({
  token: z.string().min(1).describe('Upload session token to close'),
});
