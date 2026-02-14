/**
 * Download tool registration for MCP server
 *
 * Registers download link management tools (create, list, close).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserManager } from '../user-manager.ts';
import type { DownloadManager } from '../download/download-manager.ts';
import { resolveEmail, errorResult } from './helpers.ts';
import {
  CreateDownloadLinkSchema,
  ListDownloadLinksSchema,
  CloseDownloadLinkSchema,
} from '../schemas/download.schema.ts';

/**
 * Registers all download tools on the MCP server
 */
export function registerDownloadTools(
  server: McpServer,
  userManager: UserManager,
  downloadManager: DownloadManager,
): void {
  server.registerTool(
    'create_download_link',
    {
      description:
        'Create a temporary download link for a file in a workspace. ' +
        'Returns a unique URL that the user can open in their browser to download the file. ' +
        'Links are single-use and expire after the configured timeout.',
      inputSchema: CreateDownloadLinkSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const mapping = await userManager.ensureUser(email);

        const { token, url, session } = downloadManager.createLink(
          email,
          mapping.username,
          args.workspace,
          args.file_path,
          args.expires_in_minutes,
        );

        // Check for stale sessions and include a warning
        const activeSessions = downloadManager.listSessions(email, true);
        const staleWarning =
          activeSessions.length > 1
            ? `\n\nWARNING: There are ${activeSessions.length} active download links (including the one just created). Consider closing unused links with close_download_link.`
            : '';

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(session, null, 2) + staleWarning,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_download_links',
    {
      description:
        'List download links for the current user. By default shows only active links. ' +
        'Use this to check for stale/open links that should be closed.',
      inputSchema: ListDownloadLinksSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const sessions = downloadManager.listSessions(email, args.active_only);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ links: sessions, count: sessions.length }, null, 2),
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'close_download_link',
    {
      description: 'Close/revoke an active download link. Use this to clean up links that are no longer needed.',
      inputSchema: CloseDownloadLinkSchema.shape,
    },
    async (args, extra) => {
      try {
        resolveEmail(extra);
        const result = downloadManager.closeSession(args.token);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ status: result }, null, 2),
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
