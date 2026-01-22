import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function loadConfigFile<T>(primaryPath: string, fallbackPath?: string): T {
  if (existsSync(primaryPath)) {
    try {
      return JSON.parse(readFileSync(primaryPath, 'utf-8')) as T;
    } catch (error) {
      throw new Error(`Failed to parse ${primaryPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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

export function loadOptionalConfigFile<T>(primaryPath: string, fallbackPath?: string, defaultValue?: T): T {
  try {
    return loadConfigFile<T>(primaryPath, fallbackPath);
  } catch {
    return defaultValue as T;
  }
}

export async function getSystemUserId(User: mongoose.Model<mongoose.Document>): Promise<mongoose.Types.ObjectId> {
  const DEFAULT_ADMINS = process.env.LIBRECHAT_DEFAULT_ADMINS || '';
  
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
  
  const adminUser = await User.findOne({ role: 'ADMIN' });
  if (adminUser) {
    return adminUser._id;
  }
  
  const anyUser = await User.findOne();
  if (anyUser) {
    console.log('⚠ No admin user found, using first available user as system user');
    return anyUser._id;
  }
  
  throw new Error('No users found in database. Please create a user first.');
}
