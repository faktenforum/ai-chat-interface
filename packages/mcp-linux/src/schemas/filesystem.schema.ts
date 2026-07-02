/**
 * Zod schemas for the first-class filesystem tools (write, edit, grep, glob).
 * Naming follows common coding-agent conventions so models use them reliably.
 */

import { z } from 'zod';

export const WriteFileSchema = z.object({
  workspace: z.string().default('default').describe('Workspace name (default: "default")'),
  file_path: z
    .string()
    .min(1)
    .describe('Path relative to the workspace root, e.g. "src/main.py". Parent directories are created if missing.'),
  content: z.string().describe('Full content to write to the file. Overwrites the file if it already exists.'),
});

export const EditFileSchema = z.object({
  workspace: z.string().default('default').describe('Workspace name (default: "default")'),
  file_path: z.string().min(1).describe('Path relative to the workspace root of the file to edit.'),
  old_string: z
    .string()
    .min(1)
    .describe('Exact text to replace. Must be unique in the file unless replace_all is true.'),
  new_string: z.string().describe('Replacement text. Must differ from old_string.'),
  replace_all: z.boolean().default(false).describe('Replace all exact occurrences of old_string (default false).'),
});

export const GrepSchema = z.object({
  workspace: z.string().default('default').describe('Workspace name (default: "default")'),
  pattern: z.string().min(1).describe('Regular expression to search for in file contents (ripgrep syntax).'),
  path: z
    .string()
    .default('.')
    .describe('Directory relative to the workspace root to search in (default: the whole workspace).'),
  glob: z
    .string()
    .optional()
    .describe('Optional file glob to filter which files are searched, e.g. "*.ts" or "*.{ts,tsx}".'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe('Maximum number of matching lines to return (default 100).'),
});

export const GlobSchema = z.object({
  workspace: z.string().default('default').describe('Workspace name (default: "default")'),
  pattern: z
    .string()
    .min(1)
    .describe('Glob pattern to match file paths against, e.g. "**/*.py" or "src/**/*.ts".'),
  path: z
    .string()
    .default('.')
    .describe('Directory relative to the workspace root to search in (default: the whole workspace).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe('Maximum number of file paths to return (default 100).'),
});
