/**
 * Workspace Manager
 *
 * Utility functions for workspace management. Used by both the main server
 * (for path resolution) and the worker (for workspace operations).
 *
 * Each workspace is a git repository under ~/workspaces/.
 * The "default" workspace is auto-created and cannot be deleted.
 */

import { existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
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
export function listWorkspaces(homeDir: string): string[] {
  const dir = getWorkspacesDir(homeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * Validates workspace parameters for creation
 */
export function validateCreateWorkspace(name: string, homeDir: string): string {
  const sanitized = sanitizeWorkspaceName(name);
  const error = validateWorkspaceName(sanitized);
  if (error) {
    throw new WorkspaceError(error);
  }

  const wsPath = resolveWorkspacePath(homeDir, sanitized);
  if (existsSync(wsPath)) {
    throw new WorkspaceError(`Workspace "${sanitized}" already exists`);
  }

  return sanitized;
}

/**
 * Validates workspace parameters for deletion
 */
export function validateDeleteWorkspace(name: string, homeDir: string): string {
  if (name === 'default') {
    throw new WorkspaceError('Cannot delete the default workspace');
  }

  const wsPath = resolveWorkspacePath(homeDir, name);
  if (!existsSync(wsPath)) {
    throw new WorkspaceError(`Workspace "${name}" does not exist`);
  }

  return wsPath;
}
