/**
 * Shared types for the worker modules.
 */

import type { CodeIndexer } from '@codebase-indexer/core';

export interface TerminalSession {
  id: string;
  pty: import('node-pty').IPty;
  output: string[];
  totalLength: number;
  workspace: string;
  createdAt: number;
}

export interface PlanData {
  plan: string | null;
  tasks: import('../workspace-plan.ts').PlanTask[];
}

export type Handler = (params: Record<string, unknown>) => Promise<unknown>;

/** All known worker method names. Used for compile-time completeness checks. */
export type WorkerMethod =
  // Terminal
  | 'execute_command'
  | 'read_terminal_output'
  | 'write_terminal'
  | 'list_terminals'
  | 'kill_terminal'
  // Workspace
  | 'list_workspaces'
  | 'create_workspace'
  | 'delete_workspace'
  | 'get_workspaces'
  | 'update_workspace'
  | 'clean_workspace_uploads'
  | 'clean_all_workspace_uploads'
  | 'get_system_runtimes'
  // Code Index
  | 'index_workspace_code'
  | 'codebase_search'
  | 'debug_code_index_list_chunks'
  | 'debug_code_index_rechunk_file';

export type HandlerMap = Record<WorkerMethod, Handler>;

/**
 * Shared context passed to all handler factory functions.
 */
export interface WorkerContext {
  workspacesDir: string;
  homeDir: string;
  getCodeIndexer: () => CodeIndexer;
}
