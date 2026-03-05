/**
 * Base Session Manager
 *
 * Shared logic for token-based, time-limited session management.
 * Used by both UploadManager and DownloadManager.
 */

import { logger } from '../utils/logger.ts';

export interface BaseSession {
  token: string;
  email: string;
  createdAt: Date;
  expiresAt: Date;
  status: string;
}

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export abstract class BaseSessionManager<
  TSession extends BaseSession,
  TSessionInfo,
> {
  protected sessions = new Map<string, TSession>();
  private cleanupTimer: ReturnType<typeof setInterval>;
  protected baseUrl: string;

  /** Label used in log messages (e.g. "Upload", "Download"). */
  protected abstract readonly logLabel: string;

  /** The status value that indicates the session completed its purpose. */
  protected abstract readonly completedStatus: string;

  /** The string returned by closeSession when session was already completed. */
  protected abstract readonly alreadyCompletedResult: string;

  constructor(options: { baseUrl: string }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');

    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  /**
   * Returns a session for the given token, or null.
   * Automatically marks expired sessions.
   */
  getSession(token: string): TSession | null {
    const session = this.sessions.get(token);
    if (!session) return null;

    if (session.status === 'active' && new Date() > session.expiresAt) {
      session.status = 'expired';
      logger.info({ token }, `${this.logLabel} session expired`);
    }

    return session;
  }

  /**
   * Returns an active (non-expired, non-closed, non-completed) session, or null.
   */
  getActiveSession(token: string): TSession | null {
    const session = this.getSession(token);
    return session?.status === 'active' ? session : null;
  }

  /**
   * Manually closes / revokes a session.
   */
  closeSession(token: string): 'closed' | 'not_found' | string {
    const session = this.sessions.get(token);
    if (!session) return 'not_found';
    if (session.status === this.completedStatus) return this.alreadyCompletedResult;

    session.status = 'closed';
    logger.info({ token }, `${this.logLabel} session closed`);
    return 'closed';
  }

  /**
   * Lists sessions for a given user email.
   */
  listSessions(email: string, activeOnly = true): TSessionInfo[] {
    const results: TSessionInfo[] = [];

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
   * Clears the periodic cleanup timer. Call on server shutdown.
   */
  dispose(): void {
    clearInterval(this.cleanupTimer);
  }

  /**
   * Converts an internal session to a serialisable info object.
   */
  protected abstract toSessionInfo(session: TSession): TSessionInfo;

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
      logger.info({ removed, remaining: this.sessions.size }, `${this.logLabel} session cleanup`);
    }
  }
}
