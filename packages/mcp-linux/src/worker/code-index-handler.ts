/**
 * Code index handler - semantic search and debug tools.
 */

import fs from 'node:fs/promises';
import { resolveWorkspacePath, isCodeIndexEnabledForWorkspace } from './workspace-utils.ts';
import type { Handler, WorkerContext } from './types.ts';

export function createCodeIndexHandlers(ctx: WorkerContext): Record<string, Handler> {
  return {

    async index_workspace_code(params) {
      const workspace = (params.workspace as string) || 'default';
      const force = params.force === true;
      const wsPath = resolveWorkspacePath(ctx.workspacesDir, workspace);
      try {
        await fs.access(wsPath);
      } catch {
        throw new Error(`Workspace "${workspace}" does not exist`);
      }
      if (!(await isCodeIndexEnabledForWorkspace(ctx, workspace))) {
        return {
          status: 'standby',
          message: 'Code index disabled (global or workspace config)',
          files_processed: 0,
          files_total: 0,
        };
      }
      const state = await ctx.getCodeIndexer().indexWorkspace(wsPath, { force });
      return state;
    },

    async codebase_search(params) {
      const workspace = (params.workspace as string) || 'default';
      const query = (params.query as string) || '';
      const pathPrefix = params.path as string | undefined;
      const limit = typeof params.limit === 'number' ? params.limit : undefined;
      const wsPath = resolveWorkspacePath(ctx.workspacesDir, workspace);
      try {
        await fs.access(wsPath);
      } catch {
        throw new Error(`Workspace "${workspace}" does not exist`);
      }
      if (!query.trim()) {
        return { results: [] };
      }
      const indexer = ctx.getCodeIndexer();
      if ((await isCodeIndexEnabledForWorkspace(ctx, workspace)) && !(await indexer.hasIndex(wsPath))) {
        indexer.indexWorkspace(wsPath).catch((err) => {
          console.error(`Code indexing failed for ${workspace}:`, (err as Error).message);
        });
        return {
          results: [],
          message:
            'No index yet. Indexing has been started. Use get_workspaces to check code_index.status and retry codebase_search when status is indexed.',
        };
      }
      const results = await indexer.searchWorkspace(wsPath, query.trim(), {
        pathPrefix: pathPrefix?.trim() || undefined,
        limit,
      });
      return { results };
    },

    async debug_code_index_list_chunks(params) {
      const workspace = (params.workspace as string) || 'default';
      const pathFilter = (params.path as string) || '';
      const limitParam = typeof params.limit === 'number' ? params.limit : undefined;
      const limit = limitParam && limitParam > 0 && limitParam <= 200 ? limitParam : 50;
      if (!pathFilter.trim()) {
        return { chunk_count: 0, chunks: [], index_status: 'none' };
      }
      const wsPath = resolveWorkspacePath(ctx.workspacesDir, workspace);
      try {
        await fs.access(wsPath);
      } catch {
        throw new Error(`Workspace "${workspace}" does not exist`);
      }
      const chunks = await ctx.getCodeIndexer().listChunksInIndex(wsPath, pathFilter, limit);
      const indexStatus = chunks.length > 0 ? 'indexed' : 'none';
      return {
        chunk_count: chunks.length,
        chunks,
        index_status: indexStatus,
      };
    },

    async debug_code_index_rechunk_file(params) {
      const workspace = (params.workspace as string) || 'default';
      const relPath = (params.path as string) || '';
      const limitParam = typeof params.limit === 'number' ? params.limit : undefined;
      const limit = limitParam && limitParam > 0 && limitParam <= 200 ? limitParam : 50;
      if (!relPath.trim()) {
        return { chunk_count: 0, chunks: [] };
      }
      const wsPath = resolveWorkspacePath(ctx.workspacesDir, workspace);
      try {
        await fs.access(wsPath);
      } catch {
        throw new Error(`Workspace "${workspace}" does not exist`);
      }
      const chunks = await ctx.getCodeIndexer().rechunkFileForDebug(wsPath, relPath, limit);
      return {
        chunk_count: chunks.length,
        chunks,
      };
    },
  };
}
