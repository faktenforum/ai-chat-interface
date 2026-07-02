/**
 * Status Overview
 *
 * Aggregates a user's full account state (account info, runtimes, workspaces,
 * upload/download sessions, terminals) from the managers and the per-user worker.
 * Shared by the get_status tool: rendered as an interactive UI resource and
 * summarised as JSON for the model.
 */

import { randomUUID } from 'node:crypto';
import type { UserManager } from './user-manager.ts';
import type { WorkerManager } from './worker-manager.ts';
import type { UploadManager, SessionInfo } from './upload/upload-manager.ts';
import type { DownloadManager, DownloadSessionInfo } from './download/download-manager.ts';
import { listWorkspaces } from './workspace-manager.ts';

export interface TerminalSummary {
  terminal_id: string;
  workspace: string;
  created_at: number;
  output_length: number;
}

export interface StatusUser {
  email: string;
  username?: string;
  uid?: number;
  home?: string;
  diskUsage?: string;
  createdAt?: string;
  runtimes?: Record<string, string>;
}

export interface StatusOverview {
  user: StatusUser;
  workspaces: string[];
  upload_sessions: SessionInfo[];
  download_sessions: DownloadSessionInfo[];
  terminals: TerminalSummary[];
  generated_at: string;
}

export interface StatusDeps {
  userManager: UserManager;
  workerManager: WorkerManager;
  uploadManager: UploadManager;
  downloadManager: DownloadManager;
}

/**
 * Builds the full account overview for a user. Worker calls (runtimes, terminals)
 * are best-effort: a missing worker yields empty values rather than failing.
 */
export async function buildStatusOverview(deps: StatusDeps, email: string): Promise<StatusOverview> {
  await deps.userManager.ensureUser(email);
  const userInfo = await deps.userManager.getUserInfo(email);

  let runtimes: Record<string, string> | undefined;
  try {
    const response = await deps.workerManager.sendRequest(email, {
      id: randomUUID(),
      method: 'get_system_runtimes',
      params: {},
    });
    if (!response.error && response.result) {
      runtimes = (response.result as { runtimes?: Record<string, string> }).runtimes;
    }
  } catch {
    runtimes = undefined;
  }

  let workspaces: string[] = [];
  if (userInfo) {
    workspaces = await listWorkspaces(userInfo.home);
  }

  const uploadSessions = deps.uploadManager.listSessions(email, false);
  const downloadSessions = deps.downloadManager.listSessions(email, false);

  let terminals: TerminalSummary[] = [];
  try {
    const response = await deps.workerManager.sendRequest(email, {
      id: randomUUID(),
      method: 'list_terminals',
      params: {},
    });
    if (!response.error && response.result) {
      terminals = (response.result as { terminals?: TerminalSummary[] }).terminals ?? [];
    }
  } catch {
    terminals = [];
  }

  const user: StatusUser = userInfo
    ? {
        email,
        username: userInfo.username,
        uid: userInfo.uid,
        home: userInfo.home,
        diskUsage: userInfo.diskUsage,
        createdAt: userInfo.createdAt,
        runtimes,
      }
    : { email, runtimes };

  return {
    user,
    workspaces,
    upload_sessions: uploadSessions,
    download_sessions: downloadSessions,
    terminals,
    generated_at: new Date().toISOString(),
  };
}
