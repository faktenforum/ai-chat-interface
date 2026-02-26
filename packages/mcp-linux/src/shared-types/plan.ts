/**
 * Shared plan/task types between backend (worker, schemas) and frontend.
 */

export const TASK_STATUSES = ['pending', 'in_progress', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface PlanTask {
  title: string;
  status: TaskStatus;
}

