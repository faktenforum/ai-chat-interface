/**
 * Zod schemas for code index MCP tools
 */

import { z } from 'zod';

const WorkspaceNameSchema = z
  .string()
  .regex(/^[a-z0-9._-]+$/i, 'Invalid workspace name: alphanumeric, dot, underscore, hyphen only')
  .max(128);

export const CodebaseSearchSchema = z.object({
  workspace: WorkspaceNameSchema.default('default').describe('Workspace name (default: "default")'),
  query: z.string().min(1).describe('Natural language search query (semantic search). Use English for best results.'),
  path: z.string().optional().describe('Optional subdirectory to limit search (relative to workspace root, e.g. "src")'),
  limit: z.number().int().min(1).max(100).optional().describe('Maximum number of results (default: 20)'),
});

export const GetCodeIndexStatusSchema = z.object({
  workspace: WorkspaceNameSchema.default('default').describe('Workspace name (default: "default")'),
});
