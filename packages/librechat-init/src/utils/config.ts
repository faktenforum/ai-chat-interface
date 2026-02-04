import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseWithExtension<T>(filePath: string, content: string): T {
  const isYaml = filePath.endsWith('.yaml') || filePath.endsWith('.yml');
  const isJson = filePath.endsWith('.json');
  try {
    if (isYaml) return parseYaml(content) as T;
    if (isJson) return JSON.parse(content) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${filePath}: ${msg}`);
  }
  throw new Error(`Unsupported config extension: ${filePath}`);
}

/** Returns [path] or [path, pathWithJsonExt] when path is .yaml/.yml. */
function pathWithJsonFallback(path: string): string[] {
  if (path.endsWith('.yaml')) return [path, path.slice(0, -5) + '.json'];
  if (path.endsWith('.yml')) return [path, path.slice(0, -4) + '.json'];
  return [path];
}

/** Ordered list of paths to try: primary (yaml then json), then fallback (yaml then json). */
function candidatePaths(primaryPath: string, fallbackPath?: string): string[] {
  const primary = pathWithJsonFallback(primaryPath);
  if (!fallbackPath) return primary;
  const resolved = fallbackPath.startsWith('/')
    ? fallbackPath
    : join(__dirname, fallbackPath);
  return [...primary, ...pathWithJsonFallback(resolved)];
}

/**
 * Loads a config file (YAML or JSON). Tries primary path, then same path with .json if primary
 * is .yaml, then fallback path(s). Backward-compatible with existing .json configs.
 * @throws Error if no file found or parse failed
 */
export function loadConfigFile<T>(primaryPath: string, fallbackPath?: string): T {
  for (const path of candidatePaths(primaryPath, fallbackPath)) {
    if (existsSync(path)) {
      return parseWithExtension<T>(path, readFileSync(path, 'utf-8'));
    }
  }
  throw new Error(
    `Config file not found: ${primaryPath}${fallbackPath ? ` or ${fallbackPath}` : ''}`
  );
}

/**
 * Like loadConfigFile but returns defaultValue when no file exists. Still throws on parse error.
 */
export function loadOptionalConfigFile<T>(
  primaryPath: string,
  fallbackPath?: string,
  defaultValue?: T
): T {
  try {
    return loadConfigFile<T>(primaryPath, fallbackPath);
  } catch {
    return defaultValue as T;
  }
}

/**
 * Resolves the system user ID for agent ownership.
 * Priority: LIBRECHAT_DEFAULT_ADMINS → first admin → first user.
 */
export async function getSystemUserId(
  User: mongoose.Model<mongoose.Document>
): Promise<mongoose.Types.ObjectId> {
  const DEFAULT_ADMINS = process.env.LIBRECHAT_DEFAULT_ADMINS || '';

  if (DEFAULT_ADMINS) {
    const adminEmails = DEFAULT_ADMINS.split(',')
      .map((email) => email.trim())
      .filter(Boolean);

    for (const email of adminEmails) {
      const user = await User.findOne({ email });
      if (user) return user._id;
    }
  }

  const adminUser = await User.findOne({ role: 'ADMIN' });
  if (adminUser) return adminUser._id;

  const anyUser = await User.findOne();
  if (anyUser) {
    console.log('⚠ No admin user found, using first available user as system user');
    return anyUser._id;
  }

  throw new Error('No users found in database. Please create a user first.');
}
