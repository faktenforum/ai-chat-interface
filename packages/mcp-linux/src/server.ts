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
import { fileURLToPath } from 'url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from './utils/logger.ts';
import {
  setupMcpEndpoints,
  setupHealthEndpoint,
  setupGracefulShutdown,
  extractUserContext,
  idleSessionIds,
} from './utils/http-server.ts';
import { UserManager } from './user-manager.ts';
import { WorkerManager } from './worker-manager.ts';
import { registerWorkspaceTools, sessionEmailMap } from './tools/workspace.ts';
import { registerTerminalTools } from './tools/terminal.ts';
import { registerAccountTools } from './tools/account.ts';
import { registerUploadTools } from './tools/upload.ts';
import { registerDownloadTools } from './tools/download.ts';
import { registerFileTools } from './tools/file.ts';
import { registerFilesystemTools } from './tools/filesystem.ts';
import { registerJobTools } from './tools/job.ts';
import { registerTodoTools } from './tools/todo.ts';
import { registerPrompts } from './prompts/index.ts';
import { registerWorkspaceResources } from './resources/workspace-resources.ts';
import { UploadManager } from './upload/upload-manager.ts';
import { setupUploadRoutes } from './upload/upload-routes.ts';
import { DownloadManager } from './download/download-manager.ts';
import { setupDownloadRoutes } from './download/download-routes.ts';
import { createMailServer } from './mail/mcp-server.ts';
import { createCalendarServer } from './calendar/mcp-server.ts';

const PORT = parseInt(process.env.PORT || '3015', 10);
const SERVER_NAME = 'mcp-linux-server';
const SERVER_VERSION = '1.0.0';

/** Where the other servers answer. Same container, own tool lists, own credentials. */
const MAIL_PATH = '/mcp/mail';
const CALENDAR_PATH = '/mcp/calendar';

// Session management
const transports = new Map<string, StreamableHTTPServerTransport>();
/** Tracked apart from the Linux ones; each path is a separate MCP server. */
const mailTransports = new Map<string, StreamableHTTPServerTransport>();
const calendarTransports = new Map<string, StreamableHTTPServerTransport>();
/** Last activity timestamp per session (for idle timeout and leak prevention) */
const sessionLastActivity = new Map<string, number>();
/**
 * Sessions whose client currently holds its SSE stream open. They are exempt
 * from the idle timeout: LibreChat opens the stream once and then keeps it, so
 * measuring idleness as "time since the last request" evicted connections that
 * were very much alive - the client answered every timeout with
 * "session lost, triggering reconnection".
 */
const openStreams = new Set<string>();

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
- create_upload_session returns an inline upload widget (UI resource) plus a browser URL. Place the widget's marker (\\ui{id}) in your reply so the user can drop a file directly in the chat; the URL is a fallback they can open in a new tab. Uploaded files are saved to ~/workspaces/{workspace}/uploads/. Uploads are ephemeral (may be purged); use clean_workspace_uploads to free space or move/download important outputs. Sessions auto-close after upload and expire after 15 minutes by default. User uploaded → list_upload_sessions, find completed session with uploaded_file, then read_workspace_file(workspace, e.g. uploads/filename). Never read_workspace_file without path from list_upload_sessions when user just uploaded. Close unnecessary active sessions with close_upload_session when appropriate.

File Download:
- create_download_link for a temporary download URL for any workspace file; share the URL with the user. Links are single-use, expire after 60 minutes by default. Cleanup: list_download_links, close_download_link to limit exposure.

Reading Files:
- read_workspace_file returns content with line numbers for diffing. Use optional line_ranges for specific sections, or offset/limit to page through a long file - it returns the first 1200 lines by default and tells you the total, so read the part you need rather than the whole file. Text files are returned inline; images and audio as base64; large or binary files get a download link instead.

Long-running commands:
- execute_command has to answer within the call timeout, so use start_job for anything slow: installs, builds, test suites, downloads, long scripts. It returns a job_id immediately and the job keeps running after the turn ends.
- Then either wait_for_job(job_id) to be handed the exit code and output as soon as it finishes (the call reports progress while waiting, so several minutes are fine), or carry on with other work and check job_status / read_job_output later. list_jobs finds jobs from earlier turns. kill_job stops one.
- You are not notified on your own when a job finishes - nothing wakes you between turns. So either wait for it in the same turn, or tell the user you will report back and check with list_jobs at the start of your next reply.
- Terminal and job output is capped per call (head and tail, middle dropped, with the omitted count). When you need the middle, page it with read_terminal_output / read_job_output using offset and length instead of re-running the command.

Status card: Users can view and manage their account (workspaces, upload/download sessions, terminals) inline. Call get_status and place the returned UI resource marker (\\ui{id}) in your reply to render the interactive card. Its buttons (delete workspace, close upload session, revoke download link, kill terminal, refresh) arrive back as new messages asking you to run the matching tool; run it and report the result. There is no external status page. See the account_status prompt for details.`,
    },
  );

  // Register all tools
  registerWorkspaceTools(server, userManager, workerManager);
  registerTerminalTools(server, userManager, workerManager);
  registerAccountTools(server, userManager, workerManager, uploadManager, downloadManager);
  registerUploadTools(server, userManager, uploadManager);
  registerDownloadTools(server, userManager, downloadManager);
  registerFileTools(server, userManager, downloadManager);
  registerFilesystemTools(server, userManager, workerManager);
  registerJobTools(server, userManager, workerManager);
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
    /* SSE responses, not plain JSON: a JSON response is a single body with no room for
     * notifications/progress, so wait_for_job could never report progress and the client would cut
     * the call off at its tool timeout. Every MCP client accepts text/event-stream by spec. */
    enableJsonResponse: false,
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
      openStreams.delete(sid);
    }
  };

  return { server, transport };
}

/**
 * Session for one of the extra endpoints. Same transport settings as the Linux
 * one; the only difference is which tools the server carries.
 */
function createExtraSession(
  label: string,
  make: () => McpServer,
  sessions: Map<string, StreamableHTTPServerTransport>,
): { server: McpServer; transport: StreamableHTTPServerTransport } {
  const server = make();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: false,
    onsessioninitialized: (sessionId: string) => {
      logger.info({ sessionId, label, totalSessions: sessions.size + 1 }, 'Session initialized');
      sessions.set(sessionId, transport);
      sessionLastActivity.set(sessionId, Date.now());
    },
  });

  server.server.onclose = async () => {
    const sid = transport.sessionId;
    if (sid && sessions.has(sid)) {
      logger.info({ sessionId: sid, label, totalSessions: sessions.size - 1 }, 'Session closed');
      sessions.delete(sid);
      sessionLastActivity.delete(sid);
      openStreams.delete(sid);
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

  // Upload (browser page + multipart POST) and download (file stream) routes.
  setupUploadRoutes(app, uploadManager, userManager);
  setupDownloadRoutes(app, downloadManager);

  // User-context extraction middleware: maps session ID to user email
  app.use('/mcp', (req, _res, next) => {
    /**
     * express strips the mount path, so '/' is the Linux endpoint itself and
     * '/mail' is the other server on this container. Only the Linux endpoint
     * carries a GitHub token, and applying this to /mcp/mail would read a
     * missing header as "the user revoked their token".
     */
    if (req.path !== '/') {
      next();
      return;
    }

    const userContext = extractUserContext(req.headers);
    if (!userContext) {
      next();
      return;
    }

    logger.debug({ email: userContext.email }, 'Request from user');

    // Store email for session-based lookup in tool handlers
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && typeof sessionId === 'string') {
      sessionEmailMap.set(sessionId, userContext.email);
    }

    /* The token travels with every request, so this is where it becomes visible - and the only
     * place a per-user token is applied at all, since startup has no token to apply. Awaited
     * because the tools in this same request must already run under the new credentials; after the
     * first request of a user it writes nothing until their token changes. */
    userManager
      .setUserGitHubPat(userContext.email, userContext.githubPat)
      .catch((error: unknown) =>
        logger.warn({ email: userContext.email, error }, 'Failed to apply the user GitHub token'),
      )
      .finally(() => next());
  });

  setupHealthEndpoint(app, {
    serverName: SERVER_NAME,
    version: SERVER_VERSION,
    sessionCounts: () => ({
      linux: transports.size,
      mail: mailTransports.size,
      calendar: calendarTransports.size,
    }),
    openStreams: () => openStreams.size,
  });

  setupMcpEndpoints(app, {
    serverName: SERVER_NAME,
    version: SERVER_VERSION,
    port: PORT,
    transports,
    createServer: createSession,
    logger,
    onSessionActivity: (sessionId: string) => sessionLastActivity.set(sessionId, Date.now()),
    onStreamOpen: (sessionId: string) => openStreams.add(sessionId),
    onStreamClose: (sessionId: string) => openStreams.delete(sessionId),
  });

  setupMcpEndpoints(app, {
    serverName: SERVER_NAME,
    version: SERVER_VERSION,
    port: PORT,
    path: MAIL_PATH,
    transports: mailTransports,
    createServer: () =>
      createExtraSession('mail', () => createMailServer(userManager), mailTransports),
    logger,
    onSessionActivity: (sessionId: string) => sessionLastActivity.set(sessionId, Date.now()),
    onStreamOpen: (sessionId: string) => openStreams.add(sessionId),
    onStreamClose: (sessionId: string) => openStreams.delete(sessionId),
  });

  setupMcpEndpoints(app, {
    serverName: SERVER_NAME,
    version: SERVER_VERSION,
    port: PORT,
    path: CALENDAR_PATH,
    transports: calendarTransports,
    createServer: () =>
      createExtraSession('calendar', createCalendarServer, calendarTransports),
    logger,
    onSessionActivity: (sessionId: string) => sessionLastActivity.set(sessionId, Date.now()),
    onStreamOpen: (sessionId: string) => openStreams.add(sessionId),
    onStreamClose: (sessionId: string) => openStreams.delete(sessionId),
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
      const stale = idleSessionIds({
        lastActivity: sessionLastActivity,
        openStreams,
        idleTimeoutMs: sessionIdleTimeoutMs,
        now: Date.now(),
      });

      for (const sessionId of stale) {
        /* One activity map covers all endpoints, so find which one owns the session. */
        const owner = [transports, mailTransports, calendarTransports].find((map) =>
          map.has(sessionId),
        );
        const t = owner?.get(sessionId);
        if (!owner || !t) {
          sessionLastActivity.delete(sessionId);
          continue;
        }
        try {
          t.close();
        } catch (err) {
          logger.error({ error: err, sessionId }, 'Error closing idle session');
        }
        owner.delete(sessionId);
        sessionEmailMap.delete(sessionId);
        sessionLastActivity.delete(sessionId);
        openStreams.delete(sessionId);
        logger.info(
          {
            sessionId,
            totalSessions:
              transports.size + mailTransports.size + calendarTransports.size,
          },
          'Session evicted (idle timeout)',
        );
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

    setupGracefulShutdown(server, transports, logger, mailTransports, calendarTransports);

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
