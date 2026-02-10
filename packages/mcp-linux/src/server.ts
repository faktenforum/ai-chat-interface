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
import { setupMcpEndpoints, setupGracefulShutdown, extractUserContext } from './utils/http-server.ts';
import { UserManager } from './user-manager.ts';
import { WorkerManager } from './worker-manager.ts';
import { registerWorkspaceTools, sessionEmailMap } from './tools/workspace.ts';
import { registerTerminalTools } from './tools/terminal.ts';
import { registerAccountTools } from './tools/account.ts';
import { registerPrompts } from './prompts/index.ts';

const PORT = parseInt(process.env.PORT || '3015', 10);
const SERVER_NAME = 'mcp-linux-server';
const SERVER_VERSION = '1.0.0';

// Session management
const transports = new Map<string, StreamableHTTPServerTransport>();

// Shared managers (singleton per container)
const userManager = new UserManager();
const workerManager = new WorkerManager(userManager);

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
- Users can install additional tools in their home (nvm, pip --user, etc.)`,
    },
  );

  // Register all tools
  registerWorkspaceTools(server, userManager, workerManager);
  registerTerminalTools(server, userManager, workerManager);
  registerAccountTools(server, userManager, workerManager);

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

    // Also clean up workers on shutdown
    process.on('SIGTERM', async () => {
      await workerManager.shutdownAll();
    });
    process.on('SIGINT', async () => {
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
