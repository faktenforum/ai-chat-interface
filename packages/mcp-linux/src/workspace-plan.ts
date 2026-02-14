/**
 * Workspace plan and task types shared by schema (server) and worker.
 * Single source of truth for task status values and plan/task shape.
 */

export const TASK_STATUSES = ['pending', 'in_progress', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(s: unknown): s is TaskStatus {
  return typeof s === 'string' && (TASK_STATUSES as readonly string[]).includes(s);
}

/** Task as stored in plan.json and returned by get_workspace_status. Status only; done is removed. */
export interface PlanTask {
  title: string;
  status: TaskStatus;
}

/** Derive status from optional status/done (e.g. when reading from JSON or params). */
export function taskStatusFrom(status: unknown, done: boolean | undefined): TaskStatus {
  return isTaskStatus(status) ? status : done === true ? 'done' : 'pending';
}

export const PLAN_DIR = '.mcp-linux';
export const PLAN_FILENAME = 'plan.json';

/** Max length for plan excerpt in list_workspaces (one line, truncated). */
export const LIST_WORKSPACES_PLAN_PREVIEW_LEN = 160;
