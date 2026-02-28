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
import { resolveEmail, errorResult } from './helpers.ts';
import { getWorkspaceTemplate } from '../config.ts';
import {
  ListWorkspacesSchema,
  CreateWorkspaceSchema,
  DeleteWorkspaceSchema,
  GetWorkspaceStatusSchema,
  SetWorkspacePlanSchema,
  SetWorkspaceConfigSchema,
  CleanWorkspaceUploadsSchema,
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
      description: 'Call first to see all workspaces before creating or choosing one. Returns branch, dirty, remote_url, plan_preview. Use get_workspace_status(workspace) for full plan and tasks. When handing off to a workspace specialist, put the chosen workspace name in the handoff instructions so they call get_workspace_status(workspace) first.',
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
      description: 'Create a new workspace (empty repo or clone from git_url). When cloning, submodules are checked out recursively (--recurse-submodules). Call list_workspaces first if unsure whether the name already exists.',
      inputSchema: CreateWorkspaceSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        let gitUrl = args.git_url;
        let branch = args.branch;
        let default_workspace_config: { code_index_enabled?: boolean } | undefined;
        if (gitUrl == null || gitUrl === '') {
          const template = getWorkspaceTemplate(args.name);
          if (template) {
            gitUrl = template.git_url;
            branch = template.branch ?? branch;
            default_workspace_config = {
              code_index_enabled: template.code_index_enabled ?? true,
            };
          }
        }
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'create_workspace',
          params: {
            name: args.name,
            git_url: gitUrl,
            branch,
            ...(default_workspace_config != null && { default_workspace_config }),
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
      description:
        'Full git status, plan, tasks, submodules status (idle/updating/done/error/none), and code_index status (enabled, status, progress). When AGENTS.md exists in the workspace root, returns its content as instructions. First call after every handoff: use workspace from handoff instructions (default if none). Plan and tasks are the source of truth for what to do next. Pass summary_only: true to get only a plan summary and task counts (done/in_progress/pending/cancelled) instead of the full plan and task list.',
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
            summary_only: args.summary_only,
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
      description:
        'Set plan and/or tasks. Plan is stored in .mcp-linux/plan.md, tasks in .mcp-linux/tasks.json. AGENTS.md in the workspace root is not modified by tools. Call before every handoff and at end of your turn so the next agent sees current state; if you omit this, context is lost. Pass full task list with updated statuses (done | in_progress | pending). Alternatively pass task_updates: [{ index, status }] to update only specific task statuses (0-based index from get_workspace_status) without sending the full list. Next agent reads via get_workspace_status. Tasks: prefer string[] e.g. ["Step 1","Step 2"] or [{ title, status? }]; status: pending | in_progress | done | cancelled.',
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
            task_updates: args.task_updates,
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
    'set_workspace_config',
    {
      description:
        'Set per-workspace config (stored in .mcp-linux/config.json). Use code_index_enabled: false to disable semantic code indexing for this workspace only. get_workspace_status returns the current config.',
      inputSchema: SetWorkspaceConfigSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'set_workspace_config',
          params: {
            workspace: args.workspace,
            code_index_enabled: args.code_index_enabled,
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
    'clean_workspace_uploads',
    {
      description: 'Delete files in workspace uploads/ older than N days. Use to free space; uploads/ is ephemeral. olderThanDays: default 7; use 0 to delete all.',
      inputSchema: CleanWorkspaceUploadsSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'clean_workspace_uploads',
          params: {
            workspace: args.workspace,
            olderThanDays: args.olderThanDays,
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
 * User identity: see helpers.resolveEmail (prefers request headers for multi-user).
 */

/**
 * Global map to track session ID -> email mapping.
 * Populated by the server when sessions are created.
 */
export const sessionEmailMap = new Map<string, string>();
