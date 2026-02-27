export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

export interface PlanTask {
  title: string;
  status: TaskStatus;
}

export interface CodeIndexState {
  status: string;
  message?: string;
  files_processed?: number;
  files_total?: number;
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

/** Raw workspace status from API (flat shape from worker); normalize to WorkspaceStatusResponse for UI. */
export interface WorkspaceStatusRaw {
  workspace?: string;
  branch?: string | null;
  path?: string;
  dirty?: boolean;
  remote_url?: string | null;
  ahead?: number;
  behind?: number;
  config?: { code_index_enabled?: boolean };
  submodules?: { status: string; message?: string };
  code_index?: CodeIndexState;
  plan?: string | null;
  tasks?: PlanTask[];
  [key: string]: unknown;
}

export function normalizeWorkspaceStatus(
  raw: WorkspaceStatusRaw | WorkspaceStatusResponse | null,
): WorkspaceStatusResponse | null {
  if (!raw) return null;
  if ('meta' in raw && raw.meta && 'git' in raw && raw.git) {
    return raw as WorkspaceStatusResponse;
  }
  const r = raw as WorkspaceStatusRaw;
  return {
    meta: {
      workspace: r.workspace ?? '',
      branch: r.branch ?? null,
      path: r.path,
    },
    git: {
      remote_url: r.remote_url ?? null,
      dirty: r.dirty ?? false,
      ahead: r.ahead ?? 0,
      behind: r.behind ?? 0,
    },
    config: r.config,
    submodules: r.submodules,
    code_index: r.code_index,
    plan: r.plan ?? null,
    tasks: r.tasks ?? [],
  };
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

export interface UploadSession {
  workspace: string;
  status: string;
  token: string;
  expires_at: string;
  uploaded_file?: { name: string; size: number };
}

export interface DownloadSession {
  filename: string;
  status: string;
  token: string;
  workspace: string;
  file_size: number;
  file_path: string;
}

export interface TerminalInfo {
  terminal_id?: string;
  id?: string;
  workspace?: string;
  cwd?: string;
}

export interface StatusOverview {
  user: OverviewUser | null;
  workspaces: string[];
  upload_sessions: UploadSession[];
  download_sessions: DownloadSession[];
  terminals: TerminalInfo[];
}

export interface CodeSearchResult {
  file_path?: string;
  start_line?: number;
  end_line?: number;
  score?: number;
  code_chunk?: string;
}

export interface UploadConfig {
  token: string;
  maxSizeMb: number;
  allowedExtensions: string[];
  expiresAt: string;
  workspace: string;
  status: string;
}
