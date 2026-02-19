/**
 * Terminal tool registration for MCP server
 *
 * Registers terminal management tools that delegate to per-user workers.
 * All terminal tools accept an optional workspace parameter and return
 * git metadata (branch, dirty) alongside the terminal output.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.ts';
import type { UserManager } from '../user-manager.ts';
import type { WorkerManager } from '../worker-manager.ts';
import { sessionEmailMap } from './workspace.ts';
import {
  ExecuteCommandSchema,
  ReadTerminalOutputSchema,
  WriteTerminalSchema,
  ListTerminalsSchema,
  KillTerminalSchema,
} from '../schemas/terminal.schema.ts';

/**
 * Registers all terminal tools on the MCP server
 */
export function registerTerminalTools(
  server: McpServer,
  userManager: UserManager,
  workerManager: WorkerManager,
): void {

  server.registerTool(
    'execute_command',
    {
      description:
        'Execute a shell command in a workspace context. The command always runs in the given workspace (shell starts there); paths in the command are relative to the workspace root. Returns: terminal output, terminal_id, workspace, cwd (current working directory after the command), optional cwd_relative_to_workspace, and git metadata (branch, dirty). Use the same workspace and the same relative path for read_workspace_file and create_download_link (e.g. if the script saves to chart.png, use read_workspace_file(workspace, "chart.png")). The terminal is the primary interface for file operations, search, git, and everything else.',
      inputSchema: ExecuteCommandSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'execute_command',
          params: {
            command: args.command,
            timeout_ms: args.timeout_ms,
            workspace: args.workspace,
            terminal_id: args.terminal_id,
          },
        });

        if (response.error) {
          return errorResult(response.error);
        }

        return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'read_terminal_output',
    {
      description: 'Read output from an active terminal session. Supports reading a specific range via offset and length.',
      inputSchema: ReadTerminalOutputSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'read_terminal_output',
          params: {
            terminal_id: args.terminal_id,
            offset: args.offset,
            length: args.length,
          },
        });

        if (response.error) {
          return errorResult(response.error);
        }

        return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'write_terminal',
    {
      description: 'Send input to a running terminal session. Useful for interactive prompts, REPLs, and stdin.',
      inputSchema: WriteTerminalSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'write_terminal',
          params: {
            terminal_id: args.terminal_id,
            input: args.input,
            timeout_ms: args.timeout_ms,
          },
        });

        if (response.error) {
          return errorResult(response.error);
        }

        return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_terminals',
    {
      description: 'List all active terminal sessions for the current user',
      inputSchema: ListTerminalsSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'list_terminals',
          params: {},
        });

        if (response.error) {
          return errorResult(response.error);
        }

        return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'kill_terminal',
    {
      description: 'Terminate a terminal session',
      inputSchema: KillTerminalSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'kill_terminal',
          params: {
            terminal_id: args.terminal_id,
          },
        });

        if (response.error) {
          return errorResult(response.error);
        }

        return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveEmail(extra: unknown): string {
  const ctx = extra as Record<string, unknown> | undefined;

  if (ctx?.sessionId && typeof ctx.sessionId === 'string') {
    const email = sessionEmailMap.get(ctx.sessionId);
    if (email) return email;
  }

  if (ctx && typeof (ctx as Record<string, unknown>).email === 'string') {
    return (ctx as Record<string, unknown>).email as string;
  }

  throw new Error('User email not found in request context. Ensure X-User-Email header is sent.');
}

function errorResult(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}
