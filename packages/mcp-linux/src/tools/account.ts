/**
 * Account tool registration for MCP server
 *
 * Registers account management tools (status overview, reset).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserManager } from '../user-manager.ts';
import type { WorkerManager } from '../worker-manager.ts';
import type { UploadManager } from '../upload/upload-manager.ts';
import type { DownloadManager } from '../download/download-manager.ts';
import { resolveEmail, errorResult } from './helpers.ts';
import { GetStatusSchema, ResetAccountSchema } from '../schemas/account.schema.ts';
import { buildStatusOverview } from '../status-overview.ts';
import { renderStatusUi } from '../ui/status-ui.ts';
import { uiResource } from '../ui/html.ts';

/**
 * Registers all account tools on the MCP server
 */
export function registerAccountTools(
  server: McpServer,
  userManager: UserManager,
  workerManager: WorkerManager,
  uploadManager: UploadManager,
  downloadManager: DownloadManager,
): void {

  server.registerTool(
    'get_status',
    {
      description:
        'Get current user status: account, runtimes, workspaces, upload/download sessions, and terminals. ' +
        'The result includes an interactive status card as a UI resource - place its marker (\\ui{id}) in your reply ' +
        'so the user can view and manage everything inline. Buttons in the card ask you to run the matching tool.',
      inputSchema: GetStatusSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const overview = await buildStatusOverview(
          { userManager, workerManager, uploadManager, downloadManager },
          email,
        );

        const u = overview.user;
        const summary = {
          email: u.email,
          username: u.username,
          home: u.home,
          disk_usage: u.diskUsage,
          created_at: u.createdAt,
          runtimes: u.runtimes,
          workspaces: overview.workspaces,
          active_upload_sessions: overview.upload_sessions
            .filter((s) => s.status === 'active')
            .map((s) => ({ token: s.token, workspace: s.workspace, expires_at: s.expires_at })),
          active_download_links: overview.download_sessions
            .filter((s) => s.status === 'active')
            .map((s) => ({ token: s.token, filename: s.filename, expires_at: s.expires_at })),
          terminals: overview.terminals.map((t) => ({ terminal_id: t.terminal_id, workspace: t.workspace })),
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            uiResource('ui://mcp-linux/status', renderStatusUi(overview)),
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'reset_account',
    {
      description:
        'Reset the user account: wipes home directory (all workspaces, history, configs!), re-creates from defaults. Requires confirm: true.',
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
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'Account reset successfully. All data has been wiped and defaults restored.',
              }),
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

// ── Helpers: resolveEmail, errorResult from ./helpers.ts ──────────────────────
