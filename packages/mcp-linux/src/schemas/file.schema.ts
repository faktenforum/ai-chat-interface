/**
 * Zod schemas for workspace file tools
 */

import { z } from 'zod';

export const ReadWorkspaceFileSchema = z.object({
  workspace: z.string().default('default').describe('Workspace name (default: "default")'),
  file_path: z
    .string()
    .min(1)
    .describe('Path relative to workspace root (e.g. "src/main.py" or "data/output.csv")'),
  line_ranges: z
    .array(z.tuple([z.number().int().min(1), z.number().int().min(1)]))
    .optional()
    .describe('Optional line ranges to read, e.g. [[1,50],[100,150]]. 1-based inclusive.'),
});

export const ListWorkspaceFilesSchema = z.object({
  workspace: z.string().default('default').describe('Workspace name (default: "default")'),
  path: z.string().default('.').describe('Directory relative to workspace root'),
  recursive: z.boolean().default(false).describe('If true, list recursively'),
});
