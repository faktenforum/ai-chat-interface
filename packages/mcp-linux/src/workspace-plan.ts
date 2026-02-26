/**
 * Workspace plan and task types shared by schema (server) and worker.
 * Single source of truth for task status values and plan/task shape.
 */

import { TASK_STATUSES } from './shared-types/plan.ts';
import type { TaskStatus, PlanTask } from './shared-types/plan.ts';

// Re-export shared task types so existing imports from workspace-plan keep working.
export { TASK_STATUSES };
export type { TaskStatus, PlanTask };

export function isTaskStatus(s: unknown): s is TaskStatus {
  return typeof s === 'string' && (TASK_STATUSES as readonly string[]).includes(s);
}

/** Derive status from optional status/done (e.g. when reading from JSON or params). */
export function taskStatusFrom(status: unknown, done: boolean | undefined): TaskStatus {
  return isTaskStatus(status) ? status : done === true ? 'done' : 'pending';
}

export const PLAN_DIR = '.mcp-linux';
export const PLAN_MD_FILENAME = 'plan.md';
export const TASKS_FILENAME = 'tasks.json';
export const AGENTS_MD_FILENAME = 'AGENTS.md';
export const CONFIG_FILENAME = 'config.json';
export const SUBMODULES_STATUS_FILENAME = 'submodules_status.json';

/** Submodule update status (stored in .mcp-linux/submodules_status.json). */
export interface SubmodulesStatus {
  status: 'idle' | 'updating' | 'done' | 'error' | 'none';
  message?: string;
}

/** Per-workspace config (stored in .mcp-linux/config.json). Missing key = default (true for code_index_enabled). */
export interface WorkspaceConfig {
  code_index_enabled?: boolean;
}

/** Max length for plan excerpt in list_workspaces (one line, truncated). */
export const LIST_WORKSPACES_PLAN_PREVIEW_LEN = 160;
