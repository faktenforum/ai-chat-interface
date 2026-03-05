/**
 * Upload Session Manager
 *
 * Manages short-lived upload sessions in memory. Each session is identified by
 * a cryptographically random token that is embedded in a unique upload URL.
 * Sessions are time-limited, single-use (auto-close after upload), and scoped
 * to a specific user and workspace.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.ts';
import { validateWorkspaceName } from '../utils/security.ts';
import { BaseSessionManager } from '../session/base-session-manager.ts';

/** Information about a successfully uploaded file */
export interface UploadedFileInfo {
  originalName: string;
  size: number;
  path: string;
}

/** Upload session state */
export type UploadSessionStatus = 'active' | 'completed' | 'expired' | 'closed';

/** A single upload session */
export interface UploadSession {
  token: string;
  email: string;
  workspace: string;
  createdAt: Date;
  expiresAt: Date;
  maxFileSize: number;
  allowedExtensions?: string[];
  status: UploadSessionStatus;
  uploadedFile?: UploadedFileInfo;
}

/** Options for creating a new upload session */
export interface CreateSessionOptions {
  workspace?: string;
  expiresInMinutes?: number;
  maxFileSizeMb?: number;
  allowedExtensions?: string[];
}

/** Serialised session representation returned to MCP tools */
export interface SessionInfo {
  token: string;
  upload_url: string;
  workspace: string;
  status: UploadSessionStatus;
  created_at: string;
  expires_at: string;
  max_file_size_mb: number;
  allowed_extensions?: string[];
  uploaded_file?: { name: string; size: number; path: string };
}

export class UploadManager extends BaseSessionManager<UploadSession, SessionInfo> {
  protected readonly logLabel = 'Upload';
  protected readonly completedStatus = 'completed';
  protected readonly alreadyCompletedResult = 'already_completed';

  private defaultMaxFileSizeMb: number;
  private defaultSessionTimeoutMin: number;

  constructor(options: {
    baseUrl: string;
    defaultMaxFileSizeMb?: number;
    defaultSessionTimeoutMin?: number;
  }) {
    super({ baseUrl: options.baseUrl });
    this.defaultMaxFileSizeMb = options.defaultMaxFileSizeMb ?? 100;
    this.defaultSessionTimeoutMin = options.defaultSessionTimeoutMin ?? 15;
  }

  /**
   * Creates a new upload session and returns the token + URL.
   */
  createSession(
    email: string,
    options: CreateSessionOptions = {},
  ): { token: string; url: string; session: SessionInfo } {
    const token = randomUUID();
    const now = new Date();
    const expiresInMinutes = options.expiresInMinutes ?? this.defaultSessionTimeoutMin;
    const maxFileSizeMb = options.maxFileSizeMb ?? this.defaultMaxFileSizeMb;

    if (options.workspace) {
      const wsError = validateWorkspaceName(options.workspace);
      if (wsError) throw new Error(wsError);
    }

    const session: UploadSession = {
      token,
      email,
      workspace: options.workspace ?? 'default',
      createdAt: now,
      expiresAt: new Date(now.getTime() + expiresInMinutes * 60 * 1000),
      maxFileSize: maxFileSizeMb * 1024 * 1024, // convert to bytes
      allowedExtensions: options.allowedExtensions,
      status: 'active',
    };

    this.sessions.set(token, session);

    const url = `${this.baseUrl}/upload/${token}`;
    logger.info(
      { token, email, workspace: session.workspace, expiresAt: session.expiresAt.toISOString() },
      'Upload session created',
    );

    return { token, url, session: this.toSessionInfo(session) };
  }

  /**
   * Marks a session as completed after a successful upload.
   */
  completeSession(token: string, fileInfo: UploadedFileInfo): boolean {
    const session = this.sessions.get(token);
    if (!session || session.status !== 'active') return false;

    session.status = 'completed';
    session.uploadedFile = fileInfo;
    logger.info({ token, file: fileInfo.originalName, size: fileInfo.size }, 'Upload session completed');
    return true;
  }

  protected toSessionInfo(session: UploadSession): SessionInfo {
    const info: SessionInfo = {
      token: session.token,
      upload_url: `${this.baseUrl}/upload/${session.token}`,
      workspace: session.workspace,
      status: session.status,
      created_at: session.createdAt.toISOString(),
      expires_at: session.expiresAt.toISOString(),
      max_file_size_mb: Math.round(session.maxFileSize / (1024 * 1024)),
      ...(session.allowedExtensions ? { allowed_extensions: session.allowedExtensions } : {}),
      ...(session.uploadedFile
        ? {
            uploaded_file: {
              name: session.uploadedFile.originalName,
              size: session.uploadedFile.size,
              path: session.uploadedFile.path,
            },
          }
        : {}),
    };
    return info;
  }
}
