/**
 * Download Session Manager
 *
 * Manages short-lived download sessions in memory. Each session is identified
 * by a cryptographically random token that is embedded in a unique download URL.
 * Sessions are time-limited, single-use (auto-close after download), and scoped
 * to a specific user and workspace file.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { logger } from '../utils/logger.ts';
import { resolveSafePath, ensureFileExists } from '../utils/fs-helper.ts';
import { BaseSessionManager } from '../session/base-session-manager.ts';

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

export class DownloadManager extends BaseSessionManager<DownloadSession, DownloadSessionInfo> {
  protected readonly logLabel = 'Download';
  protected readonly completedStatus = 'downloaded';
  protected readonly alreadyCompletedResult = 'already_downloaded';

  private defaultSessionTimeoutMin: number;

  constructor(options: {
    baseUrl: string;
    defaultSessionTimeoutMin?: number;
  }) {
    super({ baseUrl: options.baseUrl });
    this.defaultSessionTimeoutMin = options.defaultSessionTimeoutMin ?? 60;
  }

  /**
   * Creates a new download session for a workspace file.
   * Validates the file exists and is within the workspace.
   */
  async createLink(
    email: string,
    username: string,
    workspace: string,
    filePath: string,
    expiresInMinutes?: number,
  ): Promise<{ token: string; url: string; session: DownloadSessionInfo }> {
    const absolutePath = await resolveSafePath(username, workspace, filePath);
    await ensureFileExists(absolutePath);

    const stat = await fs.stat(absolutePath);
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
   * Marks a session as downloaded after successful file delivery.
   */
  completeSession(token: string): boolean {
    const session = this.sessions.get(token);
    if (!session || session.status !== 'active') return false;

    session.status = 'downloaded';
    logger.info({ token, filename: session.filename }, 'Download session completed');
    return true;
  }

  protected toSessionInfo(session: DownloadSession): DownloadSessionInfo {
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
}
