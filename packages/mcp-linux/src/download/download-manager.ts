/**
 * Download Session Manager
 *
 * Manages short-lived download sessions in memory. Each session is identified
 * by a cryptographically random token that is embedded in a unique download URL.
 * Sessions are time-limited, single-use (auto-close after download), and scoped
 * to a specific user and workspace file.
 */

import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { logger } from '../utils/logger.ts';

/** Download session state */
export type DownloadSessionStatus = 'active' | 'downloaded' | 'expired' | 'closed';

/** A single download session */
export interface DownloadSession {
  token: string;
  email: string;
  workspace: string;
  /** Path relative to workspace root */
  relativePath: string;
  /** Absolute path to the file on disk */
  absolutePath: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  createdAt: Date;
  expiresAt: Date;
  status: DownloadSessionStatus;
}

/** Serialised session representation returned to MCP tools */
export interface DownloadSessionInfo {
  token: string;
  download_url: string;
  workspace: string;
  file_path: string;
  filename: string;
  file_size: number;
  mime_type: string;
  status: DownloadSessionStatus;
  created_at: string;
  expires_at: string;
}

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** MIME type lookup by extension */
const MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.py': 'text/x-python',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.sh': 'text/x-shellscript',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.ini': 'text/plain',
  '.log': 'text/plain',
  '.sql': 'text/x-sql',
  '.rs': 'text/x-rust',
  '.go': 'text/x-go',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.rb': 'text/x-ruby',
  '.php': 'text/x-php',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function guessMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export class DownloadManager {
  private sessions = new Map<string, DownloadSession>();
  private cleanupTimer: ReturnType<typeof setInterval>;
  private baseUrl: string;
  private defaultSessionTimeoutMin: number;

  constructor(options: {
    baseUrl: string;
    defaultSessionTimeoutMin?: number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.defaultSessionTimeoutMin = options.defaultSessionTimeoutMin ?? 60;

    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  /**
   * Creates a new download session for a workspace file.
   * Validates the file exists and is within the workspace.
   */
  createLink(
    email: string,
    username: string,
    workspace: string,
    filePath: string,
    expiresInMinutes?: number,
  ): { token: string; url: string; session: DownloadSessionInfo } {
    // Resolve and validate the file path
    const workspaceRoot = join('/home', username, 'workspaces', workspace);
    const absolutePath = resolve(workspaceRoot, filePath);

    // Security: ensure the resolved path is within the workspace
    if (!absolutePath.startsWith(workspaceRoot + '/') && absolutePath !== workspaceRoot) {
      throw new Error(`Path traversal denied: file_path must be within the workspace`);
    }

    // Check file exists and get size
    let stat;
    try {
      stat = statSync(absolutePath);
    } catch {
      throw new Error(`File not found: ${filePath} in workspace "${workspace}"`);
    }

    if (!stat.isFile()) {
      throw new Error(`Not a file: ${filePath} (is it a directory?)`);
    }

    const token = randomUUID();
    const now = new Date();
    const timeout = expiresInMinutes ?? this.defaultSessionTimeoutMin;
    const filename = basename(absolutePath);

    const session: DownloadSession = {
      token,
      email,
      workspace,
      relativePath: filePath,
      absolutePath,
      filename,
      fileSize: stat.size,
      mimeType: guessMimeType(filename),
      createdAt: now,
      expiresAt: new Date(now.getTime() + timeout * 60 * 1000),
      status: 'active',
    };

    this.sessions.set(token, session);

    const url = `${this.baseUrl}/download/${token}`;
    logger.info(
      { token, email, workspace, filePath, fileSize: stat.size, expiresAt: session.expiresAt.toISOString() },
      'Download session created',
    );

    return { token, url, session: this.toSessionInfo(session) };
  }

  /**
   * Returns a session for the given token, or null.
   * Automatically marks expired sessions.
   */
  getSession(token: string): DownloadSession | null {
    const session = this.sessions.get(token);
    if (!session) return null;

    if (session.status === 'active' && new Date() > session.expiresAt) {
      session.status = 'expired';
      logger.info({ token }, 'Download session expired');
    }

    return session;
  }

  /**
   * Returns an active (non-expired, non-closed, non-downloaded) session, or null.
   */
  getActiveSession(token: string): DownloadSession | null {
    const session = this.getSession(token);
    return session?.status === 'active' ? session : null;
  }

  /**
   * Marks a session as downloaded after successful file delivery.
   */
  completeSession(token: string): boolean {
    const session = this.sessions.get(token);
    if (!session || session.status !== 'active') return false;

    session.status = 'downloaded';
    logger.info({ token, filename: session.filename }, 'Download session completed');
    return true;
  }

  /**
   * Manually closes / revokes a download session.
   */
  closeSession(token: string): 'closed' | 'not_found' | 'already_downloaded' {
    const session = this.sessions.get(token);
    if (!session) return 'not_found';
    if (session.status === 'downloaded') return 'already_downloaded';

    session.status = 'closed';
    logger.info({ token }, 'Download session closed');
    return 'closed';
  }

  /**
   * Lists sessions for a given user email.
   */
  listSessions(email: string, activeOnly = true): DownloadSessionInfo[] {
    const results: DownloadSessionInfo[] = [];

    for (const session of this.sessions.values()) {
      if (session.email !== email) continue;

      // Refresh expiry status
      if (session.status === 'active' && new Date() > session.expiresAt) {
        session.status = 'expired';
      }

      if (activeOnly && session.status !== 'active') continue;

      results.push(this.toSessionInfo(session));
    }

    return results;
  }

  /**
   * Converts an internal session to a serialisable info object.
   */
  private toSessionInfo(session: DownloadSession): DownloadSessionInfo {
    return {
      token: session.token,
      download_url: `${this.baseUrl}/download/${session.token}`,
      workspace: session.workspace,
      file_path: session.relativePath,
      filename: session.filename,
      file_size: session.fileSize,
      mime_type: session.mimeType,
      status: session.status,
      created_at: session.createdAt.toISOString(),
      expires_at: session.expiresAt.toISOString(),
    };
  }

  /**
   * Removes expired and completed sessions older than 1 hour.
   */
  private cleanup(): void {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    let removed = 0;

    for (const [token, session] of this.sessions.entries()) {
      if (session.status === 'active' && new Date() > session.expiresAt) {
        session.status = 'expired';
      }

      if (session.status !== 'active' && session.createdAt < cutoff) {
        this.sessions.delete(token);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info({ removed, remaining: this.sessions.size }, 'Download session cleanup');
    }
  }

  /**
   * Clears the periodic cleanup timer. Call on server shutdown.
   */
  dispose(): void {
    clearInterval(this.cleanupTimer);
  }
}
