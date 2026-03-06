/**
 * Workspace Manager
 *
 * Utility functions for workspace management. Used by both the main server
 * (for path resolution) and the worker (for workspace operations).
 *
 * Each workspace is a git repository under ~/workspaces/.
 * The "default" workspace is auto-created and cannot be deleted.
 */

import fs from 'node:fs/promises';
import { join } from 'node:path';
import { WorkspaceError } from './utils/errors.ts';
import { sanitizeWorkspaceName, validateWorkspaceName } from './utils/security.ts';

/**
 * Resolves the filesystem path for a workspace
 */
export function resolveWorkspacePath(homeDir: string, workspace: string): string {
  return join(homeDir, 'workspaces', workspace);
}

/**
 * Gets the workspaces directory for a user
 */
export function getWorkspacesDir(homeDir: string): string {
  return join(homeDir, 'workspaces');
}

/**
 * Lists all workspaces for a user
 */
export async function listWorkspaces(homeDir: string): Promise<string[]> {
  const dir = getWorkspacesDir(homeDir);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Validates workspace parameters for creation
 */
export async function validateCreateWorkspace(name: string, homeDir: string): Promise<string> {
  const sanitized = sanitizeWorkspaceName(name);
  const error = validateWorkspaceName(sanitized);
  if (error) {
    throw new WorkspaceError(error);
  }

  const wsPath = resolveWorkspacePath(homeDir, sanitized);
  try {
    await fs.access(wsPath);
    throw new WorkspaceError(`Workspace "${sanitized}" already exists`);
  } catch (e) {
    if (e instanceof WorkspaceError) throw e;
    // ENOENT: does not exist, proceed
  }

  return sanitized;
}

/**
 * Validates workspace parameters for deletion
 */
export async function validateDeleteWorkspace(name: string, homeDir: string): Promise<string> {
  if (name === 'default') {
    throw new WorkspaceError('Cannot delete the default workspace');
  }

  const wsPath = resolveWorkspacePath(homeDir, name);
  try {
    await fs.access(wsPath);
  } catch {
    throw new WorkspaceError(`Workspace "${name}" does not exist`);
  }

  return wsPath;
}
