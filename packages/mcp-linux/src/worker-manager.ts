/**
 * Worker Manager
 *
 * Spawns and manages one worker process per user.
 * Workers run as the Linux user (via runuser) and communicate via Unix sockets.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, createConnection, type Server } from 'node:net';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './utils/logger.ts';
import { WorkerError } from './utils/errors.ts';
import type { UserManager, UserMapping } from './user-manager.ts';

/** Socket is in user's home so the unprivileged worker process can create it; server (root) connects to it. */
const SOCKET_RELATIVE_PATH = '.mcp-linux/socket';
const IDLE_TIMEOUT = parseInt(process.env.WORKER_IDLE_TIMEOUT || '1800000', 10); // 30 min default
/** Max time to wait for a single worker request (e.g. create_workspace git clone uses 120s in worker). */
const REQUEST_TIMEOUT_MS = Math.max(
  30000,
  parseInt(process.env.MCP_LINUX_WORKER_REQUEST_TIMEOUT_MS || '120000', 10),
);

export interface WorkerRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface WorkerResponse {
  id: string;
  result?: unknown;
  error?: string;
}

interface WorkerState {
  process: ChildProcess;
  username: string;
  email: string;
  socketPath: string;
  lastActivity: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export class WorkerManager {
  private workers = new Map<string, WorkerState>(); // keyed by email
  private userManager: UserManager;

  constructor(userManager: UserManager) {
    this.userManager = userManager;
  }

  /**
   * Gets or creates a worker for the given user email.
   */
  async getWorker(email: string): Promise<string> {
    const existing = this.workers.get(email);
    if (existing && existing.process.exitCode === null) {
      this.resetIdleTimer(email);
      return existing.socketPath;
    }

    // Ensure user exists
    const mapping = await this.userManager.ensureUser(email);
    return await this.startWorker(email, mapping);
  }

  /**
   * Starts a new worker process for a user.
   */
  private async startWorker(email: string, mapping: UserMapping): Promise<string> {
    const homeDir = `/home/${mapping.username}`;
    const socketPath = join(homeDir, SOCKET_RELATIVE_PATH);

    // Clean up stale socket
    try {
      await fs.unlink(socketPath);
    } catch {
      // Ignore (ENOENT or other)
    }

    const workerScript = join(process.cwd(), 'src', 'worker', 'index.ts');

    const child = spawn('runuser', [
      '-u', mapping.username, '--',
      'node',
      '--experimental-specifier-resolution=node',
      '--experimental-strip-types',
      '--experimental-transform-types',
      '--no-warnings',
      workerScript,
      '--socket', socketPath,
      '--home', `/home/${mapping.username}`,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        HOME: `/home/${mapping.username}`,
        USER: mapping.username,
        LOGNAME: mapping.username,
        SHELL: '/bin/bash',
        PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        LANG: 'en_US.UTF-8',
        NODE_ENV: process.env.NODE_ENV || 'production',
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        MCP_LINUX_STATUS_MAX_FILES: process.env.MCP_LINUX_STATUS_MAX_FILES ?? '',
        MCP_LINUX_STATUS_COLLAPSE_DIRS: process.env.MCP_LINUX_STATUS_COLLAPSE_DIRS ?? '',
        CODE_INDEX_ENABLED: process.env.CODE_INDEX_ENABLED ?? '',
        CODE_INDEX_EMBEDDING_PROVIDER: process.env.CODE_INDEX_EMBEDDING_PROVIDER ?? '',
        CODE_INDEX_EMBEDDING_MODEL: process.env.CODE_INDEX_EMBEDDING_MODEL ?? '',
        CODE_INDEX_EMBEDDING_API_KEY: process.env.CODE_INDEX_EMBEDDING_API_KEY ?? '',
        CODE_INDEX_EMBEDDING_BASE_URL: process.env.CODE_INDEX_EMBEDDING_BASE_URL ?? '',
        CODE_INDEX_EMBEDDING_DIMENSIONS: process.env.CODE_INDEX_EMBEDDING_DIMENSIONS ?? '',
        CODE_INDEX_EMBEDDING_BATCH_SIZE: process.env.CODE_INDEX_EMBEDDING_BATCH_SIZE ?? '',
        CODE_INDEX_SHARED_DIR: process.env.CODE_INDEX_SHARED_DIR ?? '',
      },
    });

    // Log worker output
    child.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) logger.info({ username: mapping.username, stream: 'stdout' }, msg);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) logger.error({ username: mapping.username, stream: 'stderr' }, msg);
    });

    child.on('exit', (code, signal) => {
      logger.info({ username: mapping.username, code, signal }, 'Worker exited');
      const state = this.workers.get(email);
      if (state?.idleTimer) {
        clearTimeout(state.idleTimer);
      }
      this.workers.delete(email);
    });

    child.on('error', (error) => {
      logger.error({ username: mapping.username, error: error.message }, 'Worker process error');
    });

    const state: WorkerState = {
      process: child,
      username: mapping.username,
      email,
      socketPath,
      lastActivity: Date.now(),
      idleTimer: null,
    };

    this.workers.set(email, state);
    this.resetIdleTimer(email);

    logger.info({ username: mapping.username, socketPath, pid: child.pid }, 'Worker started');
    return socketPath;
  }

  /**
   * Sends a request to a worker and returns the response.
   */
  async sendRequest(email: string, request: WorkerRequest): Promise<WorkerResponse> {
    const socketPath = await this.getWorker(email);

    // Wait for socket to be available (worker startup)
    await this.waitForSocket(socketPath, 10000);

    return new Promise<WorkerResponse>((resolve, reject) => {
      const client = createConnection(socketPath);
      let data = '';

      const timeout = setTimeout(() => {
        client.destroy();
        reject(new WorkerError(`Worker request timed out for ${email}`));
      }, REQUEST_TIMEOUT_MS);

      client.on('connect', () => {
        client.write(JSON.stringify(request) + '\n');
      });

      client.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        // Try to parse complete JSON response (newline-delimited)
        const lines = data.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line) as WorkerResponse;
              clearTimeout(timeout);
              client.end();
              this.resetIdleTimer(email);
              resolve(response);
              return;
            } catch {
              // Incomplete JSON, continue buffering
            }
          }
        }
      });

      client.on('error', (error) => {
        clearTimeout(timeout);
        reject(new WorkerError(`Worker communication error: ${error.message}`));
      });

      client.on('close', () => {
        clearTimeout(timeout);
        if (!data.trim()) {
          reject(new WorkerError('Worker connection closed without response'));
        }
      });
    });
  }

  /**
   * Waits for a Unix socket to become available.
   */
  private async waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await fs.access(socketPath);
        // Try to connect
        try {
          await new Promise<void>((resolve, reject) => {
            const client = createConnection(socketPath);
            client.on('connect', () => {
              client.end();
              resolve();
            });
            client.on('error', () => {
              reject();
            });
          });
          return;
        } catch {
          // Socket exists but not ready yet
        }
      } catch {
        // Socket file does not exist yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new WorkerError(`Worker socket not available at ${socketPath} after ${timeoutMs}ms`);
  }

  /**
   * Resets the idle timer for a worker.
   */
  private resetIdleTimer(email: string): void {
    const state = this.workers.get(email);
    if (!state) return;

    state.lastActivity = Date.now();

    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
    }

    state.idleTimer = setTimeout(() => {
      logger.info({ username: state.username }, 'Worker idle timeout, stopping');
      this.stopWorker(email);
    }, IDLE_TIMEOUT);
  }

  /**
   * Stops a worker process.
   */
  async stopWorker(email: string): Promise<void> {
    const state = this.workers.get(email);
    if (!state) return;

    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
    }

    if (state.process.exitCode === null) {
      state.process.kill('SIGTERM');

      // Give it 5 seconds to shut down gracefully
      await new Promise<void>((resolve) => {
        const forceTimer = setTimeout(() => {
          if (state.process.exitCode === null) {
            state.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        state.process.on('exit', () => {
          clearTimeout(forceTimer);
          resolve();
        });
      });
    }

    // Clean up socket
    try {
      await fs.unlink(state.socketPath);
    } catch {
      // Ignore
    }

    this.workers.delete(email);
    logger.info({ username: state.username }, 'Worker stopped');
  }

  /**
   * Shuts down all workers (used during server shutdown).
   */
  async shutdownAll(): Promise<void> {
    const emails = Array.from(this.workers.keys());
    await Promise.all(emails.map((email) => this.stopWorker(email)));
    logger.info('All workers shut down');
  }
}
