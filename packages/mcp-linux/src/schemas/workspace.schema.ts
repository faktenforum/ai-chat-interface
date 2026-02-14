/**
 * Zod schemas for workspace tools
 */

import { z } from 'zod';
import { TASK_STATUSES, type PlanTask } from '../workspace-plan.ts';

export { TASK_STATUSES, type TaskStatus } from '../workspace-plan.ts';

const WorkspaceNameSchema = z
  .string()
  .regex(/^[a-z0-9._-]+$/i, 'Invalid workspace name: alphanumeric, dot, underscore, hyphen only')
  .max(128);

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

export const CleanWorkspaceUploadsSchema = z.object({
  workspace: WorkspaceNameSchema.default('default').describe('Workspace name (default: "default")'),
  olderThanDays: z.number().int().min(0).optional().describe('Delete files in uploads/ older than this many days (default: 7). Use 0 to delete all.'),
});

const TaskStatusSchema = z.enum(TASK_STATUSES).describe('pending | in_progress | done | cancelled');

const TaskItemSchema = z.object({
  title: z.string().describe('Task title'),
  status: TaskStatusSchema.optional().describe('Default: pending.'),
});

/** Normalized task from set_workspace_plan input (re-export for callers). */
export type NormalizedTask = PlanTask;

export const SetWorkspacePlanSchema = z.object({
  workspace: WorkspaceNameSchema.default('default').describe('Workspace name (default: "default")'),
  plan: z.string().optional().describe('Goal or context for this workspace (replaces existing when provided)'),
  tasks: z
    .array(z.union([z.string(), TaskItemSchema]))
    .optional()
    .transform((arr): PlanTask[] | undefined => {
      if (arr == null || arr.length === 0) return arr as undefined;
      return arr.map((item): PlanTask => {
        if (typeof item === 'string') {
          return { title: item, status: 'pending' };
        }
        return { title: item.title, status: item.status ?? 'pending' };
      });
    })
    .describe('Task list: [{ title, status? }] or string[]. status: pending | in_progress | done | cancelled.'),
});
