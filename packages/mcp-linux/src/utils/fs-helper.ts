/**
 * Filesystem Helpers
 *
 * Shared utilities for safe file path resolution and validation.
 */

import { join, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { validateWorkspaceName } from './security.ts';

/**
 * Resolves a file path within a workspace and ensures it does not traverse outside.
 *
 * @param username - Linux username (owner of the workspace)
 * @param workspace - Workspace name
 * @param relativePath - Path relative to the workspace root
 * @returns Absolute path to the file
 * @throws Error if workspace name is invalid or path traversal is detected
 */
export function resolveSafePath(username: string, workspace: string, relativePath: string): string {
  const wsError = validateWorkspaceName(workspace);
  if (wsError) {
    throw new Error(wsError);
  }

  const workspaceRoot = join('/home', username, 'workspaces', workspace);
  const absolutePath = resolve(workspaceRoot, relativePath);

  // Security: ensure path is within the workspace
  if (!absolutePath.startsWith(workspaceRoot + '/') && absolutePath !== workspaceRoot) {
    throw new Error('Path traversal denied: file_path must be within the workspace');
  }

  return absolutePath;
}

/**
 * Checks if a file exists and is a regular file.
 *
 * @param path - Absolute path to check
 * @throws Error if file does not exist or is not a file
 */
export function ensureFileExists(path: string): void {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new Error(`File not found: ${path}`);
  }

  if (!stat.isFile()) {
    throw new Error(`Not a file: ${path} (is it a directory?)`);
  }
}
