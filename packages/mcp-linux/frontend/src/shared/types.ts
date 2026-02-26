import type { TaskStatus as SharedTaskStatus, PlanTask as SharedPlanTask } from '../../../src/shared-types/plan';

export type TaskStatus = SharedTaskStatus;
export type PlanTask = SharedPlanTask;

export interface CodeIndexState {
  status: string;
  message: string;
  files_processed: number;
  files_total: number;
  has_index?: boolean;
  enabled?: boolean;
}

export interface WorkspaceMeta {
  workspace: string;
  branch: string | null;
  path?: string;
}

export interface WorkspaceGitMeta {
  remote_url: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
}

export interface WorkspaceStatusResponse {
  meta: WorkspaceMeta;
  git: WorkspaceGitMeta;
  config?: { code_index_enabled?: boolean };
  submodules?: { status: string; message?: string };
  code_index?: CodeIndexState;
  plan?: string | null;
  tasks?: PlanTask[];
}

export interface OverviewUser {
  email: string;
  username?: string;
  diskUsage?: string;
  home?: string;
  uid?: number;
  createdAt?: string;
  runtimes?: Record<string, string>;
}

export interface OverviewResponse {
  user: OverviewUser | null;
  workspaces: string[];
  upload_sessions: unknown[];
  download_sessions: unknown[];
  terminals: unknown[];
}

