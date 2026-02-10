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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from './utils/logger.ts';
import { setupMcpEndpoints, setupGracefulShutdown, extractUserContext } from './utils/http-server.ts';
import { UserManager } from './user-manager.ts';
import { WorkerManager } from './worker-manager.ts';
import { registerWorkspaceTools, sessionEmailMap } from './tools/workspace.ts';
import { registerTerminalTools } from './tools/terminal.ts';
import { registerAccountTools } from './tools/account.ts';
import { registerUploadTools } from './tools/upload.ts';
import { registerDownloadTools } from './tools/download.ts';
import { registerFileTools } from './tools/file.ts';
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

Each user has their own isolated Linux account with:
- A personal home directory with persistent bash history
- Git-backed workspaces (a "default" workspace exists automatically)
- Pre-installed runtimes: Node.js, Python 3, Git, Bash, ripgrep, and more
- SSH access to GitHub via a shared machine user key

Usage guidelines:
- Use the terminal tools (execute_command, write_terminal) to run any command
- All commands run in the context of a workspace (default: "default")
- Use workspace tools to manage projects (create from git clone or empty repo)
- File operations, search, and git are all done via the terminal
- Each terminal response includes workspace git metadata (branch, dirty status)
- Use get_workspace_status for detailed git status information
- Users can install additional tools in their home (nvm, pip --user, etc.)

File Upload:
- Use create_upload_session to generate a unique upload URL for the user
- Share the URL with the user so they can upload files via their browser
- Uploaded files are saved to ~/workspaces/{workspace}/uploads/
- Upload sessions auto-close after successful upload and expire after 15 minutes by default
- IMPORTANT: Always check list_upload_sessions for stale open sessions and warn the user about them
- Close unnecessary sessions with close_upload_session to maintain security

File Download:
- Use create_download_link to generate a temporary download URL for any workspace file
- Share the URL with the user so they can download files via their browser
- Download links are single-use and expire after 60 minutes by default
- IMPORTANT: Always check list_download_links for stale open links and close unused ones
- Close unnecessary links with close_download_link to maintain security

Reading Files:
- Use read_workspace_file to read a file and get its contents as structured content
- Text files (.txt, .csv, .json, .py, .js, etc.) are returned inline as text
- Images (.png, .jpg, .gif, .webp) are returned as base64 image content
- Audio files (.wav, .mp3, .ogg) are returned as base64 audio content
- Large or binary files automatically get a download link instead`,
    },
  );

  // Register all tools
  registerWorkspaceTools(server, userManager, workerManager);
  registerTerminalTools(server, userManager, workerManager);
  registerAccountTools(server, userManager, workerManager);
  registerUploadTools(server, userManager, uploadManager);
  registerDownloadTools(server, userManager, downloadManager);
  registerFileTools(server, userManager, downloadManager);

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
    },
  });

  server.server.onclose = async () => {
    const sid = transport.sessionId;
    if (sid && transports.has(sid)) {
      logger.info({ sessionId: sid, totalSessions: transports.size - 1 }, 'Session closed');
      transports.delete(sid);
      sessionEmailMap.delete(sid);
    }
  };

  return { server, transport };
}

/**
 * Creates and configures the Express application
 */
function createApp(): express.Application {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.disable('x-powered-by');

  // Pug template engine for upload pages
  const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  app.set('views', join(appRoot, 'views'));
  app.set('view engine', 'pug');

  // Static files (CSS, JS) for upload pages
  app.use(express.static(join(appRoot, 'public')));

  // Upload routes (before MCP endpoints, no JSON body parsing needed for multipart)
  setupUploadRoutes(app, uploadManager, userManager);

  // Download routes (file streaming)
  setupDownloadRoutes(app, downloadManager);

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
  });

  return app;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Restore existing users from persistent mapping on startup
    await userManager.restoreUsers();
    logger.info('User restoration complete');

    const app = createApp();
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
