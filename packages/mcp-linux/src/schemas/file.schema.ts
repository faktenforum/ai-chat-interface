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
});
