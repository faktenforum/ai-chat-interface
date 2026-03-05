/**
 * Status Routes
 *
 * Per-user status page API endpoints, extracted from server.ts.
 * Provides workspace overview, terminal management, upload/download session management,
 * code index operations, and plan/task editing via the status page UI.
 */

import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { logger } from './utils/logger.ts';
import { serveSpaIndex } from './utils/serve-spa.ts';
import type { UserContext } from './utils/http-server.ts';
import type { UserManager } from './user-manager.ts';
import type { WorkerManager } from './worker-manager.ts';
import { listWorkspaces } from './workspace-manager.ts';
import type { UploadManager } from './upload/upload-manager.ts';
import type { DownloadManager } from './download/download-manager.ts';

interface StatusRequest extends Request {
  userContext?: UserContext;
}

interface StatusDeps {
  userManager: UserManager;
  workerManager: WorkerManager;
  uploadManager: UploadManager;
  downloadManager: DownloadManager;
}

/**
 * Creates a route handler that validates userContext and delegates to a worker method.
 */
function workerProxy(
  deps: StatusDeps,
  method: string,
  getParams: (req: StatusRequest) => Record<string, unknown>,
  errorMsg: string,
  formatResult?: (result: unknown) => unknown,
): (req: StatusRequest, res: Response) => void {
  return (req, res) => {
    const userContext = req.userContext;
    if (!userContext) {
      res.status(401).json({ error: 'Missing user context' });
      return;
    }

    const params = getParams(req);

    deps.workerManager.sendRequest(userContext.email, {
      id: randomUUID(),
      method,
      params,
    }).then((response) => {
      if (response.error) {
        res.status(400).json({ error: response.error });
        return;
      }
      const result = formatResult ? formatResult(response.result) : response.result;
      res.json(result ?? {});
    }).catch((error) => {
      logger.error({ error }, errorMsg);
      res.status(500).json({ error: errorMsg });
    });
  };
}

export function createStatusRouter(deps: StatusDeps, spaDir: string): express.Router {
  const statusRouter = express.Router();

  async function handleSpaIndex(_req: Request, res: Response): Promise<void> {
    await serveSpaIndex(spaDir, res, 'SPA index');
  }

  statusRouter.get('/', handleSpaIndex);

  statusRouter.get('/workspace/:name', handleSpaIndex);

  // ── Workspace detail ─────────────────────────────────────────────────────
  statusRouter.get('/api/workspace/:name', async (req: StatusRequest, res: Response) => {
    try {
      const userContext = req.userContext;
      if (!userContext) {
        res.status(401).json({ error: 'Missing user context' });
        return;
      }
      const name = req.params.name || '';
      if (!name) {
        res.status(400).json({ error: 'workspace name is required' });
        return;
      }

      await deps.userManager.ensureUser(userContext.email);

      const response = await deps.workerManager.sendRequest(userContext.email, {
        id: randomUUID(),
        method: 'get_workspaces',
        params: { workspace: name },
      });

      if (response.error) {
        res.status(400).json({ error: response.error });
        return;
      }

      res.json(response.result ?? {});
    } catch (error) {
      logger.error({ error }, 'Failed to build workspace status overview');
      res.status(500).json({ error: 'Failed to build workspace status overview' });
    }
  });

  // ── Reindex workspace ────────────────────────────────────────────────────
  statusRouter.post('/api/reindex-workspace', (req: StatusRequest, res: Response) => {
    const userContext = req.userContext;
    if (!userContext) {
      res.status(401).json({ error: 'Missing user context' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const force = req.body?.force === true;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    workerProxy(deps, 'index_workspace_code',
      () => ({ workspace: name, force }),
      'Failed to start code index rebuild',
      (result) => ({ success: true, result }),
    )(req, res);
  });

  // ── Workspace search ─────────────────────────────────────────────────────
  statusRouter.post('/api/workspace-search', (req: StatusRequest, res: Response) => {
    const userContext = req.userContext;
    if (!userContext) {
      res.status(401).json({ error: 'Missing user context' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const query = typeof req.body?.query === 'string' ? req.body.query : '';
    const path = typeof req.body?.path === 'string' ? req.body.path : undefined;
    const limit =
      typeof req.body?.limit === 'number' && req.body.limit > 0 && req.body.limit <= 100
        ? req.body.limit
        : 10;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!query.trim()) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    workerProxy(deps, 'codebase_search',
      () => ({ workspace: name, query, path, limit }),
      'Failed to search code',
    )(req, res);
  });

  // ── Update plan/tasks ────────────────────────────────────────────────────
  statusRouter.post('/api/update-plan', (req: StatusRequest, res: Response) => {
    const userContext = req.userContext;
    if (!userContext) {
      res.status(401).json({ error: 'Missing user context' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const params: Record<string, unknown> = { workspace: name };
    if (typeof req.body?.plan === 'string') params.plan = req.body.plan;
    if (Array.isArray(req.body?.tasks)) params.tasks = req.body.tasks;
    if (Array.isArray(req.body?.task_updates)) params.task_updates = req.body.task_updates;

    workerProxy(deps, 'update_workspace',
      () => params,
      'Failed to update workspace plan',
    )(req, res);
  });

  // ── Overview (status page main data) ─────────────────────────────────────
  statusRouter.get('/api/overview', async (req: StatusRequest, res: Response) => {
    try {
      const userContext = req.userContext;
      if (!userContext) {
        res.status(401).json({ error: 'Missing user context' });
        return;
      }

      const email = userContext.email;

      await deps.userManager.ensureUser(email);
      const userInfo = await deps.userManager.getUserInfo(email);

      // Installed runtimes (Node, Python, Git, etc.)
      let runtimes: Record<string, string> | undefined;
      try {
        const response = await deps.workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'get_system_runtimes',
          params: {},
        });
        if (!response.error && response.result) {
          const result = response.result as { runtimes?: Record<string, string> };
          runtimes = result.runtimes;
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

      let terminals: unknown[] = [];
      try {
        const response = await deps.workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'list_terminals',
          params: {},
        });
        if (!response.error && response.result) {
          const result = response.result as { terminals?: unknown[] };
          terminals = result.terminals ?? [];
        }
      } catch {
        terminals = [];
      }

      const user = userInfo
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

      res.json({
        user,
        workspaces,
        upload_sessions: uploadSessions,
        download_sessions: downloadSessions,
        terminals,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to build status overview');
      res.status(500).json({ error: 'Failed to build status overview' });
    }
  });

  // ── Create upload session ────────────────────────────────────────────────
  statusRouter.post('/api/create-upload-session', (req: StatusRequest, res: Response) => {
    const userContext = req.userContext;
    if (!userContext) {
      res.status(401).json({ error: 'Missing user context' });
      return;
    }

    const workspace =
      typeof req.body?.workspace === 'string' && req.body.workspace.trim()
        ? req.body.workspace.trim()
        : 'default';
    const expiresInMinutes =
      typeof req.body?.expires_in_minutes === 'number' &&
      req.body.expires_in_minutes >= 1 &&
      req.body.expires_in_minutes <= 60
        ? req.body.expires_in_minutes
        : 15;
    const maxFileSizeMb =
      typeof req.body?.max_file_size_mb === 'number' &&
      req.body.max_file_size_mb >= 1 &&
      req.body.max_file_size_mb <= 500
        ? req.body.max_file_size_mb
        : 100;
    const allowedExtensions = Array.isArray(req.body?.allowed_extensions)
      ? (req.body.allowed_extensions as string[]).filter((x) => typeof x === 'string')
      : undefined;

    try {
      const { session } = deps.uploadManager.createSession(userContext.email, {
        workspace,
        expiresInMinutes,
        maxFileSizeMb,
        allowedExtensions: allowedExtensions?.length ? allowedExtensions : undefined,
      });
      res.json(session);
    } catch (error) {
      logger.error({ error }, 'Failed to create upload session from status page');
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create upload session' });
    }
  });

  // ── Create download link ─────────────────────────────────────────────────
  statusRouter.post('/api/create-download-link', async (req: StatusRequest, res: Response) => {
    const userContext = req.userContext;
    if (!userContext) {
      res.status(401).json({ error: 'Missing user context' });
      return;
    }

    const workspace =
      typeof req.body?.workspace === 'string' && req.body.workspace.trim()
        ? req.body.workspace.trim()
        : 'default';
    const filePath = typeof req.body?.file_path === 'string' ? req.body.file_path.trim() : '';
    if (!filePath) {
      res.status(400).json({ error: 'file_path is required' });
      return;
    }
    const expiresInMinutes =
      typeof req.body?.expires_in_minutes === 'number' &&
      req.body.expires_in_minutes >= 1 &&
      req.body.expires_in_minutes <= 1440
        ? req.body.expires_in_minutes
        : 60;

    try {
      await deps.userManager.ensureUser(userContext.email);
      const mapping = await deps.userManager.getUserInfo(userContext.email);
      const username = mapping?.username ?? '';
      if (!username) {
        res.status(500).json({ error: 'User account not ready' });
        return;
      }
      const { session } = await deps.downloadManager.createLink(
        userContext.email,
        username,
        workspace,
        filePath,
        expiresInMinutes,
      );
      res.json(session);
    } catch (error) {
      logger.error({ error }, 'Failed to create download link from status page');
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create download link' });
    }
  });

  // ── Execute command ──────────────────────────────────────────────────────
  statusRouter.post('/api/execute-command', (req: StatusRequest, res: Response) => {
    const userContext = req.userContext;
    if (!userContext) {
      res.status(401).json({ error: 'Missing user context' });
      return;
    }

    const command = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
    if (!command) {
      res.status(400).json({ error: 'command is required' });
      return;
    }
    const workspace =
      typeof req.body?.workspace === 'string' && req.body.workspace.trim()
        ? req.body.workspace.trim()
        : 'default';
    const timeoutMs =
      typeof req.body?.timeout_ms === 'number' && req.body.timeout_ms > 0 ? req.body.timeout_ms : 60000;
    const terminalId =
      typeof req.body?.terminal_id === 'string' && req.body.terminal_id.trim()
        ? req.body.terminal_id.trim()
        : undefined;

    workerProxy(deps, 'execute_command',
      () => ({ command, workspace, timeout_ms: timeoutMs, terminal_id: terminalId }),
      'Failed to execute command',
    )(req, res);
  });

  // ── Read terminal output ─────────────────────────────────────────────────
  statusRouter.post('/api/read-terminal-output', (req: StatusRequest, res: Response) => {
    const userContext = req.userContext;
    if (!userContext) {
      res.status(401).json({ error: 'Missing user context' });
      return;
    }

    const terminalId = typeof req.body?.terminal_id === 'string' ? req.body.terminal_id.trim() : '';
    if (!terminalId) {
      res.status(400).json({ error: 'terminal_id is required' });
      return;
    }
    const offset = typeof req.body?.offset === 'number' && req.body.offset >= 0 ? req.body.offset : 0;
    const length = typeof req.body?.length === 'number' && req.body.length > 0 ? req.body.length : undefined;

    workerProxy(deps, 'read_terminal_output',
      () => ({ terminal_id: terminalId, offset, length }),
      'Failed to read terminal output',
    )(req, res);
  });

  // ── Close upload session ─────────────────────────────────────────────────
  statusRouter.post('/api/close-upload-session', (req: StatusRequest, res: Response) => {
    const userContext = req.userContext;
    if (!userContext) {
      res.status(401).json({ error: 'Missing user context' });
      return;
    }

    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) {
      res.status(400).json({ error: 'token is required' });
      return;
    }

    const session = deps.uploadManager.getSession(token);
    if (!session) {
      res.status(404).json({ error: 'Upload session not found' });
      return;
    }
    if (session.email !== userContext.email) {
      res.status(403).json({ error: 'Not allowed to modify this session' });
      return;
    }

    const status = deps.uploadManager.closeSession(token);
    res.json({ status });
  });

  // ── Close download link ──────────────────────────────────────────────────
  statusRouter.post('/api/close-download-link', (req: StatusRequest, res: Response) => {
    const userContext = req.userContext;
    if (!userContext) {
      res.status(401).json({ error: 'Missing user context' });
      return;
    }

    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) {
      res.status(400).json({ error: 'token is required' });
      return;
    }

    const session = deps.downloadManager.getSession(token);
    if (!session) {
      res.status(404).json({ error: 'Download link not found' });
      return;
    }
    if (session.email !== userContext.email) {
      res.status(403).json({ error: 'Not allowed to modify this link' });
      return;
    }

    const status = deps.downloadManager.closeSession(token);
    res.json({ status });
  });

  // ── Kill terminal ────────────────────────────────────────────────────────
  statusRouter.post('/api/kill-terminal',
    workerProxy(deps, 'kill_terminal',
      (req) => ({ terminal_id: typeof req.body?.terminal_id === 'string' ? req.body.terminal_id : '' }),
      'Failed to kill terminal',
      (result) => ({ success: true, result }),
    ),
  );

  // ── Delete workspace ─────────────────────────────────────────────────────
  statusRouter.post('/api/delete-workspace', (req: StatusRequest, res: Response) => {
    const userContext = req.userContext;
    if (!userContext) {
      res.status(401).json({ error: 'Missing user context' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    workerProxy(deps, 'delete_workspace',
      () => ({ name, confirm: true }),
      'Failed to delete workspace',
      (result) => ({ success: true, result }),
    )(req, res);
  });

  return statusRouter;
}
