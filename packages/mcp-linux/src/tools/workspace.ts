/**
 * Workspace tool registration for MCP server
 *
 * Registers workspace management tools that delegate to per-user workers.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.ts';
import { extractUserContext } from '../utils/http-server.ts';
import type { UserManager } from '../user-manager.ts';
import type { WorkerManager } from '../worker-manager.ts';
import {
  ListWorkspacesSchema,
  CreateWorkspaceSchema,
  DeleteWorkspaceSchema,
  GetWorkspaceStatusSchema,
  SetWorkspacePlanSchema,
} from '../schemas/workspace.schema.ts';

/**
 * Helper to extract email from MCP server context (session metadata).
 *
 * Since MCP tool handlers receive only the arguments (not HTTP headers),
 * we use a workaround: the server stores user context per session in a Map,
 * and tools look it up. For now, we pass email via the tool arguments
 * as a hidden internal parameter, or use server-level session context.
 *
 * In this implementation, the server-level middleware stores user context,
 * and we pass it through the tool execution flow.
 */

/**
 * Registers all workspace tools on the MCP server
 */
export function registerWorkspaceTools(
  server: McpServer,
  userManager: UserManager,
  workerManager: WorkerManager,
): void {

  server.registerTool(
    'list_workspaces',
    {
      description: 'Call first to see all workspaces before creating or choosing one. Returns branch, dirty, remote_url, plan_preview. Use get_workspace_status(workspace) for full plan and tasks.',
      inputSchema: ListWorkspacesSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'list_workspaces',
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
    'create_workspace',
    {
      description: 'Create a new workspace (empty repo or clone from git_url). Call list_workspaces first if unsure whether the name already exists.',
      inputSchema: CreateWorkspaceSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'create_workspace',
          params: {
            name: args.name,
            git_url: args.git_url,
            branch: args.branch,
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
    'delete_workspace',
    {
      description: 'Delete a workspace (cannot delete "default"). Requires confirm: true.',
      inputSchema: DeleteWorkspaceSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'delete_workspace',
          params: {
            name: args.name,
            confirm: args.confirm,
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
    'get_workspace_status',
    {
      description: 'Full git status plus plan and tasks (each task: title, status). Call after receiving a handoff (use workspace name from handoff instructions; default if none).',
      inputSchema: GetWorkspaceStatusSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'get_workspace_status',
          params: {
            workspace: args.workspace,
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
    'set_workspace_plan',
    {
      description: 'Set plan and/or tasks for handoffs (can update only plan, only tasks, or both). Tasks: prefer string[] e.g. ["Step 1","Step 2"]; or [{ title, status? }]. status: pending | in_progress | done | cancelled. Next agent reads via get_workspace_status.',
      inputSchema: SetWorkspacePlanSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'set_workspace_plan',
          params: {
            workspace: args.workspace,
            plan: args.plan,
            tasks: args.tasks,
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

/**
 * Resolves user email from MCP extra context.
 *
 * The MCP SDK passes session metadata through the `extra` parameter.
 * We store user email in the session's transport metadata.
 */
function resolveEmail(extra: unknown): string {
  // The extra parameter from MCP SDK contains session info
  // We need to extract the email from the original HTTP headers
  // This is stored in the session context by our middleware
  const ctx = extra as Record<string, unknown> | undefined;

  // Try to get from session metadata (set by our middleware)
  if (ctx?.sessionId && typeof ctx.sessionId === 'string') {
    // Look up in the session-to-email map (set in server.ts)
    const email = sessionEmailMap.get(ctx.sessionId);
    if (email) return email;
  }

  // Fallback: check if email is directly on context
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

/**
 * Global map to track session ID -> email mapping.
 * Populated by the server when sessions are created.
 */
export const sessionEmailMap = new Map<string, string>();
