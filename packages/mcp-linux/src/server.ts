#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * MCP Linux Server
 *
 * Provides each LibreChat user with an isolated Linux terminal environment:
 * - Per-user Linux accounts with own home directory and bash history
 * - Git-backed workspaces (default + cloned repos)
 * - Persistent terminal sessions via node-pty
 * - Streamable HTTP transport for LibreChat integration
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from './utils/logger.ts';
import {
  setupMcpEndpoints,
  setupGracefulShutdown,
  extractUserContext,
  type UserContext,
} from './utils/http-server.ts';
import { verifyToken } from './utils/status-token.ts';
import { UserManager } from './user-manager.ts';
import { WorkerManager } from './worker-manager.ts';
import { createStatusRouter } from './status-routes.ts';
import { registerWorkspaceTools, sessionEmailMap } from './tools/workspace.ts';
import { registerTerminalTools } from './tools/terminal.ts';
import { registerAccountTools } from './tools/account.ts';
import { registerUploadTools } from './tools/upload.ts';
import { registerDownloadTools } from './tools/download.ts';
import { registerFileTools } from './tools/file.ts';
import { registerFilesystemTools } from './tools/filesystem.ts';
import { registerTodoTools } from './tools/todo.ts';
import { registerPrompts } from './prompts/index.ts';
import { registerWorkspaceResources } from './resources/workspace-resources.ts';
import { UploadManager } from './upload/upload-manager.ts';
import { setupUploadRoutes } from './upload/upload-routes.ts';
import { DownloadManager } from './download/download-manager.ts';
import { setupDownloadRoutes } from './download/download-routes.ts';

const PORT = parseInt(process.env.PORT || '3015', 10);
const SERVER_NAME = 'mcp-linux-server';
const SERVER_VERSION = '1.0.0';

// Session management
const transports = new Map<string, StreamableHTTPServerTransport>();
/** Last activity timestamp per session (for idle timeout and leak prevention) */
const sessionLastActivity = new Map<string, number>();

// Shared managers (singleton per container)
const userManager = new UserManager();
const workerManager = new WorkerManager(userManager);
const uploadManager = new UploadManager({
  baseUrl: process.env.MCP_LINUX_UPLOAD_BASE_URL || `http://localhost:${PORT}`,
  defaultMaxFileSizeMb: parseInt(process.env.MCP_LINUX_UPLOAD_MAX_FILE_SIZE_MB || '100', 10),
  defaultSessionTimeoutMin: parseInt(process.env.MCP_LINUX_UPLOAD_SESSION_TIMEOUT_MIN || '15', 10),
});
const downloadManager = new DownloadManager({
  baseUrl: process.env.MCP_LINUX_DOWNLOAD_BASE_URL || process.env.MCP_LINUX_UPLOAD_BASE_URL || `http://localhost:${PORT}`,
  defaultSessionTimeoutMin: parseInt(process.env.MCP_LINUX_DOWNLOAD_SESSION_TIMEOUT_MIN || '60', 10),
});

interface StatusRequest extends Request {
  userContext?: UserContext;
}

function requireUserContext(req: StatusRequest, res: Response, next: NextFunction): void {
  const userContext = extractUserContext(req.headers);
  if (!userContext) {
    res.status(401).json({ error: 'Missing user context' });
    return;
  }
  req.userContext = userContext;
  next();
}

/** Resolves user from status token (query or body) or from X-User-* headers. Allows GET /status without auth so the page can load and show "open link from agent". */
function requireUserContextOrStatusToken(req: StatusRequest, res: Response, next: NextFunction): void {
  const tokenRaw =
    (typeof req.query.token === 'string' ? req.query.token : null) ||
    (typeof req.body?.auth_token === 'string' ? req.body.auth_token : null);
  if (tokenRaw) {
    const payload = verifyToken(tokenRaw);
    if (payload) {
      req.userContext = { userId: '', email: payload.email, username: '' };
      next();
      return;
    }
  }
  const userContext = extractUserContext(req.headers);
  if (userContext) {
    req.userContext = userContext;
    next();
    return;
  }
  const isIndexGet = req.method === 'GET' && (req.path === '' || req.path === '/');
  if (isIndexGet) {
    next();
    return;
  }
  res.status(401).json({ error: 'Missing user context or invalid/expired token' });
}

/**
 * Creates and configures the MCP server with all tool and prompt registrations
 */
function createMcpServer() {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      instructions: `You have access to a Linux terminal environment via the MCP Linux server.

TOOL USE
- You have access to tools executed in a Linux workspace context. Use one tool at a time; each step should be informed by the previous result.
- Assess what information you need, then choose the most appropriate tool. For example: list_workspace_files is more effective than running ls in the terminal for exploring directory structure.

Tool Use Guidelines
1. Assess what information you already have and what you need to proceed.
2. Choose the most appropriate tool (e.g. list_workspace_files over ls when exploring a directory structure).
3. After each tool use, use the result (output, errors, git status) to decide the next step. Do not assume success without seeing the result.

====

OBJECTIVE
- Accomplish the user's task iteratively. Break it into clear steps; use one tool at a time; let each step be informed by the previous tool result. Do not assume a tool succeeded without seeing its result.

====

CAPABILITIES
- Each user has their own isolated Linux account: personal home directory with persistent bash history, Git-backed workspaces (a "default" workspace exists automatically), pre-installed runtimes (Node.js, Python 3, Git, Bash, ripgrep, and more), SSH access to GitHub via a shared machine user key. Users can install additional tools in their home (nvm, pip --user, etc.); see runtime_management prompt for details.
- Use terminal tools (execute_command, write_terminal) to run any command. All commands run in the context of a workspace (default: "default"). Each terminal response includes workspace git metadata (branch, dirty status).
- Prefer the first-class file tools over the terminal for routine file work: read_workspace_file to read, write to create/overwrite, edit for targeted string replacements, grep to search file contents (ripgrep), glob to find files by pattern. Use the terminal for git, builds, and everything else.
- For multi-step tasks, track your plan with todowrite (statuses: pending, in_progress, completed); keep exactly one item in_progress.
- list_workspaces = overview (all workspaces, branch, dirty). get_workspaces(workspace) = full detail (git status, optional workspace-root AGENTS.md). Use the latter after handoffs or when you need workspace context; use the former to choose or create a workspace. get_workspaces returns capped file lists (staged_count, truncated); prefer read_workspace_file, list_workspace_files, or glob with explicit paths for specific files.
- list_workspace_files: Use to explore directory structure; more effective than ls for getting a structured file list.

File Upload:
- create_upload_session to generate a unique upload URL for the user. Uploaded files are saved to ~/workspaces/{workspace}/uploads/. Uploads are ephemeral (may be purged); use clean_workspace_uploads to free space or move/download important outputs. Sessions auto-close after upload and expire after 15 minutes by default. User uploaded → list_upload_sessions, find completed session with uploaded_file, then read_workspace_file(workspace, e.g. uploads/filename). Never read_workspace_file without path from list_upload_sessions when user just uploaded. Close unnecessary active sessions with close_upload_session when appropriate.

File Download:
- create_download_link for a temporary download URL for any workspace file; share the URL with the user. Links are single-use, expire after 60 minutes by default. Cleanup: list_download_links, close_download_link to limit exposure.

Reading Files:
- read_workspace_file returns content with line numbers for diffing. Use optional line_ranges for specific sections. Text files are returned inline; images and audio as base64; large or binary files get a download link instead.

Status page: Users can view and manage their account (workspaces, upload/download sessions, terminals). Use get_status and give the user the status_page_url from the result (it includes a time-limited token). When the user wants to close sessions, revoke download links, kill terminals, or delete workspaces themselves, direct them to open that URL in a new tab. See the account_status prompt for when to refer users.`,
    },
  );

  // Register all tools
  registerWorkspaceTools(server, userManager, workerManager);
  registerTerminalTools(server, userManager, workerManager);
  registerAccountTools(server, userManager, workerManager);
  registerUploadTools(server, userManager, uploadManager);
  registerDownloadTools(server, userManager, downloadManager);
  registerFileTools(server, userManager, downloadManager);
  registerFilesystemTools(server, userManager, workerManager);
  registerTodoTools(server);

  // Register resources
  registerWorkspaceResources(server, userManager);

  // Register prompts
  registerPrompts(server);

  return server;
}

/**
 * Creates a new session for an initialize request
 */
function createSession(): { server: McpServer; transport: StreamableHTTPServerTransport } {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId: string) => {
      logger.info({ sessionId, totalSessions: transports.size + 1 }, 'Session initialized');
      transports.set(sessionId, transport);
      sessionLastActivity.set(sessionId, Date.now());
    },
  });

  server.server.onclose = async () => {
    const sid = transport.sessionId;
    if (sid && transports.has(sid)) {
      logger.info({ sessionId: sid, totalSessions: transports.size - 1 }, 'Session closed');
      transports.delete(sid);
      sessionEmailMap.delete(sid);
      sessionLastActivity.delete(sid);
    }
  };

  return { server, transport };
}

/**
 * Creates and configures the Express application
 */
async function createApp(): Promise<express.Application> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.disable('x-powered-by');

  const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const spaDirCwd = join(process.cwd(), 'frontend/.output/public');
  const spaDirFromModule = join(appRoot, 'frontend/.output/public');
  let spaDir = spaDirFromModule;
  try {
    await fs.access(join(spaDirFromModule, 'index.html'));
  } catch {
    try {
      await fs.access(join(spaDirCwd, 'index.html'));
      spaDir = spaDirCwd;
    } catch {
      // fallback to spaDirFromModule
    }
  }

  // Restore path when proxy (e.g. Traefik) strips prefix and sets X-Forwarded-Prefix
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const prefix = req.get('x-forwarded-prefix');
    if (prefix && typeof prefix === 'string' && req.path && !req.path.startsWith(prefix)) {
      const path = req.path === '/' ? '' : req.path;
      req.url = (prefix.replace(/\/$/, '') + path) || '/';
      logger.debug({ originalPath: req.path, prefix, newUrl: req.url }, 'Path rewritten from X-Forwarded-Prefix');
    }
    next();
  });

  // Upload and download routes first so GET /upload/:token and GET /download/:token
  // are served (SPA page or file stream), not passed to static (which would 404).
  setupUploadRoutes(app, uploadManager, userManager, spaDir);
  setupDownloadRoutes(app, downloadManager, spaDir);

  // Static files from the built Nuxt SPA (index, assets, etc.)
  app.use(express.static(spaDir));

  // Status routes (per-user overview and management UI)
  const statusRouter = createStatusRouter(
    { userManager, workerManager, uploadManager, downloadManager },
    spaDir,
  );
  app.use('/status', requireUserContextOrStatusToken, statusRouter);

  // User-context extraction middleware: maps session ID to user email
  app.use('/mcp', (req, _res, next) => {
    const userContext = extractUserContext(req.headers);
    if (userContext) {
      logger.debug({ email: userContext.email }, 'Request from user');

      // Store email for session-based lookup in tool handlers
      const sessionId = req.headers['mcp-session-id'];
      if (sessionId && typeof sessionId === 'string') {
        sessionEmailMap.set(sessionId, userContext.email);
      }
    }
    next();
  });

  setupMcpEndpoints(app, {
    serverName: SERVER_NAME,
    version: SERVER_VERSION,
    port: PORT,
    transports,
    createServer: createSession,
    logger,
    onSessionActivity: (sessionId: string) => sessionLastActivity.set(sessionId, Date.now()),
  });

  return app;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Initialize user manager DB and restore existing users
    await userManager.initialize();
    await userManager.restoreUsers();
    logger.info('User restoration complete');

    // Idle session cleanup: close sessions with no activity for MCP_LINUX_SESSION_IDLE_TIMEOUT_MIN
    const sessionIdleTimeoutMin = parseInt(
      process.env.MCP_LINUX_SESSION_IDLE_TIMEOUT_MIN || '30',
      10,
    );
    const sessionIdleTimeoutMs = sessionIdleTimeoutMin * 60 * 1000;
    const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // run every 5 min
    const sessionCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, lastActivity] of sessionLastActivity.entries()) {
        if (now - lastActivity < sessionIdleTimeoutMs) continue;
        const t = transports.get(sessionId);
        if (!t) {
          sessionLastActivity.delete(sessionId);
          continue;
        }
        try {
          t.close();
        } catch (err) {
          logger.error({ error: err, sessionId }, 'Error closing idle session');
        }
        transports.delete(sessionId);
        sessionEmailMap.delete(sessionId);
        sessionLastActivity.delete(sessionId);
        logger.info({ sessionId, totalSessions: transports.size }, 'Session evicted (idle timeout)');
      }
    }, SESSION_CLEANUP_INTERVAL_MS);
    sessionCleanupTimer.unref();

    // Optional: scheduled cleanup of uploads/ (MCP_LINUX_UPLOADS_MAX_AGE_DAYS > 0)
    const uploadsMaxAgeDays = parseInt(process.env.MCP_LINUX_UPLOADS_MAX_AGE_DAYS || '0', 10);
    if (uploadsMaxAgeDays > 0) {
      const UPLOADS_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
      const cleanupTimer = setInterval(async () => {
        const emails = userManager.listUserEmails();
        for (const email of emails) {
          try {
            const res = await workerManager.sendRequest(email, {
              id: randomUUID(),
              method: 'clean_all_workspace_uploads',
              params: { olderThanDays: uploadsMaxAgeDays },
            });
            if (res.error) continue;
            const deleted = (res.result as { deleted?: number })?.deleted ?? 0;
            if (deleted > 0) {
              logger.info({ email, deleted }, 'Uploads cleanup');
            }
          } catch {
            // Skip (e.g. worker not running)
          }
        }
      }, UPLOADS_CLEANUP_INTERVAL_MS);
      cleanupTimer.unref();
    }

    const app = await createApp();
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT, server: SERVER_NAME, version: SERVER_VERSION }, 'MCP Linux Server started');
    });

    setupGracefulShutdown(server, transports, logger);

    // Also clean up workers, upload manager, and download manager on shutdown
    process.on('SIGTERM', async () => {
      uploadManager.dispose();
      downloadManager.dispose();
      await workerManager.shutdownAll();
    });
    process.on('SIGINT', async () => {
      uploadManager.dispose();
      downloadManager.dispose();
      await workerManager.shutdownAll();
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    logger.error({ error }, 'Fatal error');
    process.exit(1);
  });
}

export { createApp, createMcpServer };
