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

export const DebugCodeIndexListChunksSchema = z.object({
  workspace: WorkspaceNameSchema.default('default').describe('Workspace name (default: "default")'),
  path: z
    .string()
    .min(1)
    .describe('File path (e.g. "src/foo.ts") or path prefix (e.g. "src/") relative to the workspace root'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Maximum number of chunks to return (default: 50)'),
});

export const DebugCodeIndexRechunkFileSchema = z.object({
  workspace: WorkspaceNameSchema.default('default').describe('Workspace name (default: "default")'),
  path: z
    .string()
    .min(1)
    .describe('Relative file path of a single file to rechunk (e.g. "src/foo.ts")'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Maximum number of chunks to return (default: 50)'),
});
