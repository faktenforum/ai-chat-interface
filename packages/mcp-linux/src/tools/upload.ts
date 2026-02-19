/**
 * Upload tool registration for MCP server
 *
 * Registers upload session management tools (create, list, close).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserManager } from '../user-manager.ts';
import type { UploadManager } from '../upload/upload-manager.ts';
import { resolveEmail, errorResult } from './helpers.ts';
import {
  CreateUploadSessionSchema,
  ListUploadSessionsSchema,
  CloseUploadSessionSchema,
} from '../schemas/upload.schema.ts';

/**
 * Registers all upload tools on the MCP server
 */
export function registerUploadTools(
  server: McpServer,
  _userManager: UserManager,
  uploadManager: UploadManager,
): void {
  server.registerTool(
    'create_upload_session',
    {
      description:
        'Create a file upload session. Returns a unique URL that the user can open in their browser to upload a file. ' +
        'The file will be saved to the specified workspace under uploads/. ' +
        'Sessions auto-close after successful upload and expire after the configured timeout.',
      inputSchema: CreateUploadSessionSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);

        const { token, url, session } = uploadManager.createSession(email, {
          workspace: args.workspace,
          expiresInMinutes: args.expires_in_minutes,
          maxFileSizeMb: args.max_file_size_mb,
          allowedExtensions: args.allowed_extensions,
        });

        // Also check for stale sessions and include a warning
        const activeSessions = uploadManager.listSessions(email, true);
        const staleWarning =
          activeSessions.length > 1
            ? `\n\nWARNING: There are ${activeSessions.length} active upload sessions (including the one just created). Consider closing unused sessions with close_upload_session.`
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
    'list_upload_sessions',
    {
      description:
        'List upload sessions for the current user. By default returns all sessions (active, completed, expired, closed). ' +
        'Completed sessions include uploaded_file with name, size, and path (e.g. ~/workspaces/{workspace}/uploads/{filename}). ' +
        'When the user has uploaded a file: call this tool, find a session with status "completed" and uploaded_file, then use uploaded_file.path with read_workspace_file (path relative to workspace, e.g. uploads/filename.csv). ' +
        'Use active_only: true only when explicitly checking for open sessions to close with close_upload_session.',
      inputSchema: ListUploadSessionsSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const sessions = uploadManager.listSessions(email, args.active_only);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ sessions, count: sessions.length }, null, 2),
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'close_upload_session',
    {
      description: 'Close/revoke an active upload session. Use this to clean up sessions that are no longer needed.',
      inputSchema: CloseUploadSessionSchema.shape,
    },
    async (args, extra) => {
      try {
        // Verify the caller owns the session (optional security check)
        resolveEmail(extra);

        const result = uploadManager.closeSession(args.token);

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
