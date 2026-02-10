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

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class UploadManager {
  private sessions = new Map<string, UploadSession>();
  private cleanupTimer: ReturnType<typeof setInterval>;
  private baseUrl: string;
  private defaultMaxFileSizeMb: number;
  private defaultSessionTimeoutMin: number;

  constructor(options: {
    baseUrl: string;
    defaultMaxFileSizeMb?: number;
    defaultSessionTimeoutMin?: number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, ''); // strip trailing slash
    this.defaultMaxFileSizeMb = options.defaultMaxFileSizeMb ?? 100;
    this.defaultSessionTimeoutMin = options.defaultSessionTimeoutMin ?? 15;

    // Periodic cleanup of expired sessions
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref(); // don't prevent process exit
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
   * Returns an active session for the given token, or null.
   * Automatically marks expired sessions.
   */
  getSession(token: string): UploadSession | null {
    const session = this.sessions.get(token);
    if (!session) return null;

    // Check expiry
    if (session.status === 'active' && new Date() > session.expiresAt) {
      session.status = 'expired';
      logger.info({ token }, 'Upload session expired');
    }

    return session;
  }

  /**
   * Returns an active (non-expired, non-closed, non-completed) session, or null.
   */
  getActiveSession(token: string): UploadSession | null {
    const session = this.getSession(token);
    return session?.status === 'active' ? session : null;
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

  /**
   * Manually closes / revokes a session.
   * Returns the final status description.
   */
  closeSession(token: string): 'closed' | 'not_found' | 'already_completed' {
    const session = this.sessions.get(token);
    if (!session) return 'not_found';
    if (session.status === 'completed') return 'already_completed';

    session.status = 'closed';
    logger.info({ token }, 'Upload session closed');
    return 'closed';
  }

  /**
   * Lists sessions for a given user email.
   */
  listSessions(email: string, activeOnly = true): SessionInfo[] {
    const results: SessionInfo[] = [];

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
  private toSessionInfo(session: UploadSession): SessionInfo {
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

  /**
   * Removes expired and completed sessions older than 1 hour.
   */
  private cleanup(): void {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    let removed = 0;

    for (const [token, session] of this.sessions.entries()) {
      // Expire active sessions past their deadline
      if (session.status === 'active' && new Date() > session.expiresAt) {
        session.status = 'expired';
      }

      // Remove non-active sessions older than cutoff
      if (session.status !== 'active' && session.createdAt < cutoff) {
        this.sessions.delete(token);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info({ removed, remaining: this.sessions.size }, 'Upload session cleanup');
    }
  }

  /**
   * Clears the periodic cleanup timer. Call on server shutdown.
   */
  dispose(): void {
    clearInterval(this.cleanupTimer);
  }
}
