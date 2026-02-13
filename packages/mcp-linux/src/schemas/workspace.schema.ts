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

export const SetWorkspacePlanSchema = z.object({
  workspace: WorkspaceNameSchema.default('default').describe('Workspace name (default: "default")'),
  plan: z.string().optional().describe('Goal or context for this workspace (replaces existing plan when provided)'),
  tasks: z.array(z.object({
    title: z.string().describe('Task title'),
    done: z.boolean().optional().describe('Whether the task is done (default: false)'),
  })).optional().describe('Task list (replaces existing tasks when provided)'),
});
