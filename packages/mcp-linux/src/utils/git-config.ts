/**
 * Default Git identity for new/init repos (user.name, user.email).
 * Reads MCP_LINUX_GIT_USER_NAME and MCP_LINUX_GIT_USER_EMAIL; fallback to Correctiv machine user.
 */

const DEFAULT_GIT_USER_NAME = 'Correctiv Team Digital Bot';
const DEFAULT_GIT_USER_EMAIL = 'correctiv-team-digital-bot@correctiv.org';

export function getDefaultGitIdentity(): { name: string; email: string } {
  const name =
    process.env.MCP_LINUX_GIT_USER_NAME?.trim() || process.env.GIT_USER_NAME?.trim() || DEFAULT_GIT_USER_NAME;
  const email =
    process.env.MCP_LINUX_GIT_USER_EMAIL?.trim() || process.env.GIT_USER_EMAIL?.trim() || DEFAULT_GIT_USER_EMAIL;
  return { name, email };
}

/** Escapes a string for safe use inside single-quoted shell arguments ( '...' ). */
export function shellEscapeSingleQuoted(value: string): string {
  return value.replace(/'/g, "'\\''");
}
