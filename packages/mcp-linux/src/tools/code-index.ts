/**
 * Code index MCP tool registration
 *
 * Registers codebase_search and get_code_index_status tools that delegate to the worker.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import type { UserManager } from '../user-manager.ts';
import type { WorkerManager } from '../worker-manager.ts';
import { resolveEmail, errorResult } from './helpers.ts';
import {
  CodebaseSearchSchema,
  GetCodeIndexStatusSchema,
  DebugCodeIndexListChunksSchema,
  DebugCodeIndexRechunkFileSchema,
} from '../schemas/code-index.schema.ts';

export function registerCodeIndexTools(
  server: McpServer,
  userManager: UserManager,
  workerManager: WorkerManager,
): void {
  server.registerTool(
    'codebase_search',
    {
      description:
        'Semantic code search in a workspace. Finds code relevant to a natural language query (meaning-based, not just keywords). ' +
        'CRITICAL: For ANY exploration of code you haven\'t examined yet in this conversation, you MUST use this tool FIRST before any other search or file exploration tools. This applies throughout the entire conversation. ' +
        'Queries should be in English. If the workspace has no index yet, the first call starts indexing in the background and returns a short message; use get_code_index_status or get_workspace_status to check code_index.status and retry codebase_search when status is indexed.',
      inputSchema: CodebaseSearchSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'codebase_search',
          params: {
            workspace: args.workspace ?? 'default',
            query: args.query,
            path: args.path,
            limit: args.limit,
          },
        });

        if (response.error) {
          return errorResult(response.error);
        }

        const result = response.result as {
          results?: Array<{ file_path: string; score: number; start_line: number; end_line: number; code_chunk: string }>;
          message?: string;
        };
        const results = result?.results ?? [];
        const text =
          results.length === 0
            ? (result?.message ?? `No relevant code found for query: "${args.query}"`)
            : `Query: ${args.query}\nResults:\n${results
                .map(
                  (r) =>
                    `File: ${r.file_path} (lines ${r.start_line}-${r.end_line}, score: ${r.score.toFixed(3)})\n${r.code_chunk ? r.code_chunk.trim().slice(0, 500) + (r.code_chunk.length > 500 ? '...' : '') : ''}`,
                )
                .join('\n---\n')}`;

        return { content: [{ type: 'text', text }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_code_index_status',
    {
      description:
        'Get the code index status for a workspace: standby, indexing, indexed, or error. ' +
        'Shows whether semantic code search is available and indexing progress.',
      inputSchema: GetCodeIndexStatusSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'get_code_index_status',
          params: {
            workspace: args.workspace ?? 'default',
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
    'debug_code_index_list_chunks',
    {
      description:
        'Debug tool: list stored code index chunks from LanceDB for a given file path or path prefix in a workspace. ' +
        'Read-only; intended for testing and debugging chunking/indexing behaviour.',
      inputSchema: DebugCodeIndexListChunksSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'debug_code_index_list_chunks',
          params: {
            workspace: args.workspace ?? 'default',
            path: args.path,
            limit: args.limit,
          },
        });

        if (response.error) {
          return errorResult(response.error);
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'debug_code_index_rechunk_file',
    {
      description:
        'Debug tool: rechunk a single file using the active chunking logic (AST + fallback) without writing embeddings or modifying the index.',
      inputSchema: DebugCodeIndexRechunkFileSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const response = await workerManager.sendRequest(email, {
          id: randomUUID(),
          method: 'debug_code_index_rechunk_file',
          params: {
            workspace: args.workspace ?? 'default',
            path: args.path,
            limit: args.limit,
          },
        });

        if (response.error) {
          return errorResult(response.error);
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
