import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load JSON configuration file with fallback paths
 * @param primaryPath - Primary path to try (e.g., /app/data/config.json)
 * @param fallbackPath - Fallback path if primary doesn't exist (e.g., relative path)
 * @returns Parsed JSON object
 * @throws Error if neither path exists
 */
export function loadConfigFile<T>(primaryPath: string, fallbackPath?: string): T {
  // Try primary path first
  if (existsSync(primaryPath)) {
    try {
      return JSON.parse(readFileSync(primaryPath, 'utf-8')) as T;
    } catch (error) {
      throw new Error(`Failed to parse ${primaryPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Try fallback path if provided
  if (fallbackPath) {
    const resolvedFallback = fallbackPath.startsWith('/') 
      ? fallbackPath 
      : join(__dirname, fallbackPath);
    
    if (existsSync(resolvedFallback)) {
      try {
        return JSON.parse(readFileSync(resolvedFallback, 'utf-8')) as T;
      } catch (error) {
        throw new Error(`Failed to parse ${resolvedFallback}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  throw new Error(`Config file not found: ${primaryPath}${fallbackPath ? ` or ${fallbackPath}` : ''}`);
}

/**
 * Load JSON configuration file with optional fallback (returns empty array if not found)
 * Useful for optional config files like agents.private.json
 */
export function loadOptionalConfigFile<T>(primaryPath: string, fallbackPath?: string, defaultValue?: T): T {
  try {
    return loadConfigFile<T>(primaryPath, fallbackPath);
  } catch {
    return defaultValue as T;
  }
}

/**
 * Get system user ID based on priority:
 * 1. First user from LIBRECHAT_DEFAULT_ADMINS
 * 2. First admin user (role: 'ADMIN')
 * 3. First available user (for initial setup)
 */
export async function getSystemUserId(User: mongoose.Model<mongoose.Document>): Promise<mongoose.Types.ObjectId> {
  const DEFAULT_ADMINS = process.env.LIBRECHAT_DEFAULT_ADMINS || '';
  
  // Try to get first admin from DEFAULT_ADMINS
  if (DEFAULT_ADMINS) {
    const adminEmails = DEFAULT_ADMINS.split(',')
      .map(email => email.trim())
      .filter(Boolean);
    
    for (const email of adminEmails) {
      const user = await User.findOne({ email });
      if (user) {
        return user._id;
      }
    }
  }
  
  // Fallback: get any admin user
  const adminUser = await User.findOne({ role: 'ADMIN' });
  if (adminUser) {
    return adminUser._id;
  }
  
  // Last resort: get any user (for initial setup)
  const anyUser = await User.findOne();
  if (anyUser) {
    console.log('⚠ No admin user found, using first available user as system user');
    return anyUser._id;
  }
  
  throw new Error('No users found in database. Please create a user first.');
}
