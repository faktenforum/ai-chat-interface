/**
 * Workspace filesystem constants and submodule status shape shared by the worker.
 */

export const PLAN_DIR = '.mcp-linux';
export const AGENTS_MD_FILENAME = 'AGENTS.md';
export const SUBMODULES_STATUS_FILENAME = 'submodules_status.json';

/** Submodule update status (stored in .mcp-linux/submodules_status.json). */
export interface SubmodulesStatus {
  status: 'idle' | 'updating' | 'done' | 'error' | 'none';
  message?: string;
}
