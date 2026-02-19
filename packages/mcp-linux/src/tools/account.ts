/**
 * Account tool registration for MCP server
 *
 * Registers account management tools (get info, reset, system info).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.ts';
import type { UserManager } from '../user-manager.ts';
import type { WorkerManager } from '../worker-manager.ts';
import { resolveEmail, errorResult } from './helpers.ts';
import {
  GetAccountInfoSchema,
  ResetAccountSchema,
  GetSystemInfoSchema,
} from '../schemas/account.schema.ts';

/**
 * Registers all account tools on the MCP server
 */
export function registerAccountTools(
  server: McpServer,
  userManager: UserManager,
  workerManager: WorkerManager,
): void {

  server.registerTool(
    'get_account_info',
    {
      description: 'Get information about the current user account: username, home path, disk usage, installed runtimes, workspace count',
      inputSchema: GetAccountInfoSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const mapping = await userManager.ensureUser(email);
        const info = await userManager.getUserInfo(email);

        if (!info) {
          return errorResult('User account not found');
        }

        // Get workspace count from worker
        let workspaceCount = 0;
        try {
          const response = await workerManager.sendRequest(email, {
            id: randomUUID(),
            method: 'list_workspaces',
            params: {},
          });
          if (!response.error && response.result) {
            const result = response.result as { workspaces: unknown[] };
            workspaceCount = result.workspaces?.length || 0;
          }
        } catch {
          // Worker may not be running yet
        }

        // Get runtime versions from worker
        let runtimes: Record<string, string> = {};
        try {
          const response = await workerManager.sendRequest(email, {
            id: randomUUID(),
            method: 'get_system_runtimes',
            params: {},
          });
          if (!response.error && response.result) {
            const result = response.result as { runtimes: Record<string, string> };
            runtimes = result.runtimes || {};
          }
        } catch {
          // Worker may not be running
        }

        const result = {
          email,
          username: info.username,
          uid: info.uid,
          home: info.home,
          disk_usage: info.diskUsage,
          workspace_count: workspaceCount,
          runtimes,
          created_at: info.createdAt,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'reset_account',
    {
      description: 'Reset the user account: wipes home directory (all workspaces, history, configs!), re-creates from defaults. Requires confirm: true.',
      inputSchema: ResetAccountSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);

        if (!args.confirm) {
          return errorResult('Must pass confirm: true to reset account');
        }

        // Stop the worker first
        await workerManager.stopWorker(email);

        // Reset the account
        await userManager.resetUser(email);

        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'Account reset successfully. All data has been wiped and defaults restored.' }) }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_system_info',
    {
      description: 'Get available system runtimes and their versions (Node.js, Python, Git, etc.)',
      inputSchema: GetSystemInfoSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'get_system_runtimes',
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
}

// ── Helpers: resolveEmail, errorResult from ./helpers.ts ──────────────────────
