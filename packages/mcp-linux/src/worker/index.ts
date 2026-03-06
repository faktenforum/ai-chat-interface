#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Worker Process
 *
 * Runs as an unprivileged Linux user. Manages:
 * - Terminal sessions (persistent PTYs via node-pty)
 * - Workspace operations (git init, clone, status)
 *
 * Communicates with the main MCP server via Unix socket IPC.
 */

import { createServer, type Socket } from 'node:net';
import fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createFromEnv, type CodeIndexer } from '@codebase-indexer/core';
import { createTerminalHandlers } from './terminal-handler.ts';
import { createWorkspaceHandlers } from './workspace-handler.ts';
import { createCodeIndexHandlers } from './code-index-handler.ts';
import type { Handler, HandlerMap, WorkerContext, WorkerMethod } from './types.ts';

// ── CLI Arguments ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const socketPath = args[args.indexOf('--socket') + 1];
const homeDir = args[args.indexOf('--home') + 1];

if (!socketPath || !homeDir) {
  console.error('Usage: worker.ts --socket <path> --home <path>');
  process.exit(1);
}

// ── Context & Handlers ───────────────────────────────────────────────────────

let _codeIndexer: CodeIndexer | null = null;
function getCodeIndexer(): CodeIndexer {
  if (!_codeIndexer) {
    _codeIndexer = createFromEnv();
  }
  return _codeIndexer;
}

const ctx: WorkerContext = {
  workspacesDir: join(homeDir, 'workspaces'),
  homeDir,
  getCodeIndexer,
};

const { handlers: terminalHandlers, shutdownTerminals } = createTerminalHandlers(ctx);
const workspaceHandlers = createWorkspaceHandlers(ctx);
const codeIndexHandlers = createCodeIndexHandlers(ctx);

const handlers: HandlerMap = {
  ...terminalHandlers,
  ...workspaceHandlers,
  ...codeIndexHandlers,
} as HandlerMap;

// ── IPC Server ───────────────────────────────────────────────────────────────

function handleConnection(socket: Socket): void {
  let data = '';

  socket.on('data', (chunk: Buffer) => {
    data += chunk.toString();

    const lines = data.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const request = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
        processRequest(request).then(
          (result) => {
            const response = JSON.stringify({ id: request.id, result }) + '\n';
            socket.write(response);
          },
          (error) => {
            const response = JSON.stringify({
              id: request.id,
              error: error instanceof Error ? error.message : String(error),
            }) + '\n';
            socket.write(response);
          },
        );
      } catch {
        // Incomplete JSON, wait for more data
      }
    }
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
  });
}

async function processRequest(request: { id: string; method: string; params: Record<string, unknown> }): Promise<unknown> {
  const handler = handlers[request.method as WorkerMethod] as Handler | undefined;
  if (!handler) {
    throw new Error(`Unknown method: ${request.method}`);
  }
  return handler(request.params);
}

async function startServer(): Promise<void> {
  const socketDir = dirname(socketPath);
  await fs.mkdir(socketDir, { recursive: true });

  // Clean up stale socket
  try { await fs.unlink(socketPath); } catch { /* ignore */ }

  const server = createServer(handleConnection);

  server.listen(socketPath, () => {
    console.log(`Worker listening on ${socketPath}`);
  });

  server.on('error', (err) => {
    console.error('Server error:', err.message);
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Worker shutting down...');
    shutdownTerminals();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await fs.mkdir(ctx.workspacesDir, { recursive: true });
  await startServer();
}

main().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
