import { createHash } from 'node:crypto';

/**
 * Maximum length for Linux usernames (useradd limit is 32)
 */
const MAX_USERNAME_LENGTH = 32;

/**
 * Derives a Linux username from an email address.
 *
 * Format: lc_ + email local part (before @) with special chars replaced by _
 * Example: pascal.garber@correctiv.org -> lc_pascal_garber
 *
 * @param email - LibreChat user email
 * @returns Sanitized Linux username
 */
export function deriveUsername(email: string): string {
  const localPart = email.split('@')[0] || 'unknown';
  const sanitized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')    // Replace non-alphanumeric with _
    .replace(/_+/g, '_')            // Collapse consecutive underscores
    .replace(/^_|_$/g, '');         // Trim leading/trailing underscores

  const username = `lc_${sanitized}`;

  // Truncate to max length if needed
  if (username.length > MAX_USERNAME_LENGTH) {
    // Use hash suffix to avoid collisions on truncation
    const hash = createHash('sha256').update(email).digest('hex').slice(0, 6);
    return username.slice(0, MAX_USERNAME_LENGTH - 7) + '_' + hash;
  }

  return username;
}

/**
 * Adds a numeric suffix to resolve username collisions.
 *
 * @param baseUsername - Original derived username
 * @param suffix - Numeric suffix (2, 3, ...)
 * @returns Username with suffix
 */
export function addUsernameSuffix(baseUsername: string, suffix: number): string {
  const suffixStr = `_${suffix}`;
  if (baseUsername.length + suffixStr.length > MAX_USERNAME_LENGTH) {
    return baseUsername.slice(0, MAX_USERNAME_LENGTH - suffixStr.length) + suffixStr;
  }
  return baseUsername + suffixStr;
}

/**
 * Sanitizes a workspace name for use as a directory name.
 *
 * @param name - Raw workspace name
 * @returns Sanitized name safe for filesystem use
 */
export function sanitizeWorkspaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 128);
}

/**
 * Validates that a workspace name is acceptable.
 *
 * @param name - Workspace name to validate
 * @returns Error message if invalid, null if valid
 */
export function validateWorkspaceName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return 'Workspace name cannot be empty';
  }
  if (name === '.' || name === '..') {
    return 'Workspace name cannot be . or ..';
  }
  if (name.includes('/') || name.includes('\\')) {
    return 'Workspace name cannot contain path separators';
  }
  if (name.length > 128) {
    return 'Workspace name too long (max 128 characters)';
  }
  return null;
}
