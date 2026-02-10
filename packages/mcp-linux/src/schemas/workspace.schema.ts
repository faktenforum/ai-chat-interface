/**
 * Zod schemas for workspace tools
 */

import { z } from 'zod';

export const ListWorkspacesSchema = z.object({});

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(128).describe('Workspace name (used as directory name)'),
  git_url: z.string().optional().describe('Git repository URL to clone (optional; creates empty repo if omitted)'),
  branch: z.string().default('main').describe('Branch to checkout (default: main)'),
});

export const DeleteWorkspaceSchema = z.object({
  name: z.string().min(1).describe('Workspace name to delete'),
  confirm: z.boolean().describe('Must be true to confirm deletion'),
});

export const GetWorkspaceStatusSchema = z.object({
  workspace: z.string().default('default').describe('Workspace name (default: "default")'),
});
