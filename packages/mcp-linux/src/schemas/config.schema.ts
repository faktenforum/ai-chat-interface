/**
 * Zod schemas for server-wide config (config.yaml)
 */

import { z } from 'zod';

export const WorkspaceTemplateSchema = z.object({
  git_url: z.string(),
  branch: z.string().optional(),
  code_index_enabled: z.boolean().optional(),
});

export const ConfigSchema = z.object({
  administrators: z.array(z.string()).optional().default([]),
  workspace_templates: z.record(z.string(), WorkspaceTemplateSchema).optional().default({}),
});

export type WorkspaceTemplate = z.infer<typeof WorkspaceTemplateSchema>;
export type Config = z.infer<typeof ConfigSchema>;
