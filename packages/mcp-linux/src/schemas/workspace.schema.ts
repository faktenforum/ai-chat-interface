/**
 * Zod schemas for workspace tools
 */

import { z } from 'zod';

const WorkspaceNameSchema = z.string().regex(/^[a-z0-9._-]+$/i, "Invalid workspace name: alphanumeric, dot, underscore, hyphen only").max(128);

export const ListWorkspacesSchema = z.object({});

export const CreateWorkspaceSchema = z.object({
  name: WorkspaceNameSchema.describe('Workspace name (used as directory name)'),
  git_url: z.string().optional().describe('Git repository URL to clone (optional; creates empty repo if omitted)'),
  branch: z.string().default('main').describe('Branch to checkout (default: main)'),
});

export const DeleteWorkspaceSchema = z.object({
  name: WorkspaceNameSchema.describe('Workspace name to delete'),
  confirm: z.boolean().describe('Must be true to confirm deletion'),
});

export const GetWorkspaceStatusSchema = z.object({
  workspace: WorkspaceNameSchema.default('default').describe('Workspace name (default: "default")'),
});
