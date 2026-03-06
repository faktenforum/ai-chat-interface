/**
 * Default Git identity for new/init repos (user.name, user.email).
 * Reads MCP_LINUX_GIT_USER_NAME and MCP_LINUX_GIT_USER_EMAIL; falls back to user's git config, then Correctiv machine user.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const DEFAULT_GIT_USER_NAME = 'Correctiv Team Digital Bot';
const DEFAULT_GIT_USER_EMAIL = 'correctiv-team-digital-bot@correctiv.org';

/**
 * Reads the user's git config (user.name and user.email).
 * Returns null if git config is not available or not set.
 */
async function getUserGitConfig(): Promise<{ name: string; email: string } | null> {
  try {
    const { stdout: nameOut } = await execFile('git', ['config', '--global', 'user.name']);
    const { stdout: emailOut } = await execFile('git', ['config', '--global', 'user.email']);
    const name = nameOut.trim();
    const email = emailOut.trim();
    if (name && email) {
      return { name, email };
    }
  } catch {
    // Git config not set or git not available
  }
  return null;
}

/**
 * Reads the git config for a specific Linux user (when running as root).
 * Uses runuser to execute git config commands as that user.
 */
async function getUserGitConfigAsUser(username: string): Promise<{ name: string; email: string } | null> {
  try {
    const { stdout: nameOut } = await execFile('runuser', ['-u', username, '--', 'git', 'config', '--global', 'user.name']);
    const { stdout: emailOut } = await execFile('runuser', ['-u', username, '--', 'git', 'config', '--global', 'user.email']);

    const name = nameOut.trim();
    const email = emailOut.trim();

    if (name && email) {
      return { name, email };
    }
  } catch {
    // Git config not set or git not available
  }
  return null;
}

export async function getDefaultGitIdentity(username?: string): Promise<{ name: string; email: string }> {
  // First priority: environment variables
  const envName = process.env.MCP_LINUX_GIT_USER_NAME?.trim() || process.env.GIT_USER_NAME?.trim();
  const envEmail = process.env.MCP_LINUX_GIT_USER_EMAIL?.trim() || process.env.GIT_USER_EMAIL?.trim();

  // Second priority: user's git config (if env vars are not both set)
  let userConfig: { name: string; email: string } | null = null;
  if (!envName || !envEmail) {
    // Only check user config if we need to fill in missing values
    if (username) {
      // Running as root, need to execute as user
      userConfig = await getUserGitConfigAsUser(username);
    } else {
      // Running as user, can read directly
      userConfig = await getUserGitConfig();
    }
  }

  // Combine: use env vars if set, otherwise use user config, otherwise use defaults
  return {
    name: envName || userConfig?.name || DEFAULT_GIT_USER_NAME,
    email: envEmail || userConfig?.email || DEFAULT_GIT_USER_EMAIL,
  };
}

/** Escapes a string for safe use inside single-quoted shell arguments ( '...' ). */
export function shellEscapeSingleQuoted(value: string): string {
  return value.replace(/'/g, "'\\''");
}
