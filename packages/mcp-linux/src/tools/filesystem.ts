/**
 * First-class filesystem tool registration for the MCP server.
 *
 * write / edit mutate files and run in the per-user worker (correct ownership).
 * grep / glob run ripgrep in the worker scoped to the workspace.
 * These complement read_workspace_file / list_workspace_files and reduce reliance
 * on execute_command for routine file work.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import type { UserManager } from '../user-manager.ts';
import type { WorkerManager } from '../worker-manager.ts';
import { resolveEmail, errorResult } from './helpers.ts';
import { WriteFileSchema, EditFileSchema, GrepSchema, GlobSchema } from '../schemas/filesystem.schema.ts';

export function registerFilesystemTools(
  server: McpServer,
  _userManager: UserManager,
  workerManager: WorkerManager,
): void {
  server.registerTool(
    'write',
    {
      description:
        'Write content to a file in a workspace, creating it (and any parent directories) or overwriting it. ' +
        'Prefer this over echoing content through execute_command. Path is relative to the workspace root.',
      inputSchema: WriteFileSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'write_file',
          params: { workspace: args.workspace, file_path: args.file_path, content: args.content },
        });
        if (response.error) return errorResult(response.error);
        return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'edit',
    {
      description:
        'Make a targeted edit to an existing file by replacing an exact string. old_string must match exactly (including whitespace) and be unique unless replace_all is true. ' +
        'Prefer this over rewriting the whole file. Read the file first so old_string matches.',
      inputSchema: EditFileSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'edit_file',
          params: {
            workspace: args.workspace,
            file_path: args.file_path,
            old_string: args.old_string,
            new_string: args.new_string,
            replace_all: args.replace_all,
          },
        });
        if (response.error) return errorResult(response.error);
        return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'grep',
    {
      description:
        'Search file contents by regular expression (ripgrep) within a workspace. Returns matching files, line numbers and line text. ' +
        'Use path to narrow to a subdirectory and glob to filter files (e.g. "*.ts"). Prefer this over running grep/rg via execute_command.',
      inputSchema: GrepSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'grep',
          params: { workspace: args.workspace, pattern: args.pattern, path: args.path, glob: args.glob, limit: args.limit },
        });
        if (response.error) return errorResult(response.error);
        return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'glob',
    {
      description:
        'Find files by glob pattern within a workspace (e.g. "**/*.py"). Returns matching file paths relative to the workspace root. ' +
        'Use path to narrow to a subdirectory. Prefer this over running find via execute_command.',
      inputSchema: GlobSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'glob',
          params: { workspace: args.workspace, pattern: args.pattern, path: args.path, limit: args.limit },
        });
        if (response.error) return errorResult(response.error);
        return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
