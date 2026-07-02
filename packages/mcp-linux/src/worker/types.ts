/**
 * Shared types for the worker modules.
 */

export interface TerminalSession {
  id: string;
  pty: import('node-pty').IPty;
  output: string[];
  totalLength: number;
  workspace: string;
  createdAt: number;
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
  | 'clean_workspace_uploads'
  | 'clean_all_workspace_uploads'
  | 'get_system_runtimes'
  // Filesystem
  | 'write_file'
  | 'edit_file'
  | 'grep'
  | 'glob';

export type HandlerMap = Record<WorkerMethod, Handler>;

/**
 * Shared context passed to all handler factory functions.
 */
export interface WorkerContext {
  workspacesDir: string;
  homeDir: string;
}
