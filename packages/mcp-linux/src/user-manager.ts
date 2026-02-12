/**
 * User Manager
 *
 * Manages Linux user accounts for LibreChat users.
 * - Derives usernames from email (lc_ + local part, sanitized)
 * - Creates Linux accounts with useradd
 * - Persists user mapping in /app/data/users.json
 * - Configures SSH keys for git access
 * - Restores users on container restart / image upgrade
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './utils/logger.ts';
import { UserCreationError } from './utils/errors.ts';
import { deriveUsername, addUsernameSuffix } from './utils/security.ts';
import { getDefaultGitIdentity, shellEscapeSingleQuoted } from './utils/git-config.ts';

const DATA_DIR = '/app/data';
const USERS_FILE = join(DATA_DIR, 'users.json');
const BASE_UID = 2000;

export interface UserMapping {
  email: string;
  username: string;
  uid: number;
  createdAt: string;
}

export interface UserMappingDB {
  users: Record<string, UserMapping>; // keyed by email
  nextUid: number;
}

export class UserManager {
  private db: UserMappingDB;

  constructor() {
    this.db = this.loadDb();
  }

  /**
   * Loads the user mapping database from disk
   */
  private loadDb(): UserMappingDB {
    try {
      if (existsSync(USERS_FILE)) {
        const data = readFileSync(USERS_FILE, 'utf-8');
        return JSON.parse(data) as UserMappingDB;
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load user mapping, starting fresh');
    }
    return { users: {}, nextUid: BASE_UID };
  }

  /**
   * Persists the user mapping database to disk
   */
  private saveDb(): void {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(USERS_FILE, JSON.stringify(this.db, null, 2), 'utf-8');
    } catch (error) {
      logger.error({ error }, 'Failed to save user mapping');
    }
  }

  /**
   * Checks if a Linux username already exists in the system
   */
  private linuxUserExists(username: string): boolean {
    try {
      execSync(`id "${username}"`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves a unique username, handling collisions with existing users
   */
  private resolveUniqueUsername(email: string): string {
    const base = deriveUsername(email);

    // Check if this username is already taken by a different email
    const existingByUsername = Object.values(this.db.users).find(
      (u) => u.username === base && u.email !== email,
    );

    if (!existingByUsername) {
      return base;
    }

    // Collision: add numeric suffix
    for (let i = 2; i < 1000; i++) {
      const candidate = addUsernameSuffix(base, i);
      const taken = Object.values(this.db.users).find((u) => u.username === candidate);
      if (!taken) {
        return candidate;
      }
    }

    throw new UserCreationError(`Cannot resolve unique username for ${email}`);
  }

  /**
   * Creates a Linux user account
   */
  private createLinuxUser(username: string, uid: number): void {
    try {
      execSync(
        `useradd -m -s /bin/bash -u ${uid} -d /home/${username} "${username}"`,
        { stdio: 'pipe' },
      );
      logger.info({ username, uid }, 'Created Linux user');
    } catch (error) {
      // User may already exist (e.g., from a previous container with the same volume)
      if (this.linuxUserExists(username)) {
        logger.info({ username }, 'Linux user already exists, skipping creation');
        return;
      }
      throw new UserCreationError(
        `Failed to create Linux user ${username}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Sets up the default workspace (~/workspaces/default/) with git init
   */
  private setupDefaultWorkspace(username: string): void {
    const workspacesDir = `/home/${username}/workspaces`;
    const defaultDir = join(workspacesDir, 'default');

    if (!existsSync(defaultDir)) {
      mkdirSync(defaultDir, { recursive: true });
      try {
        const { name, email } = getDefaultGitIdentity();
        const emailEsc = shellEscapeSingleQuoted(email);
        const nameEsc = shellEscapeSingleQuoted(name);
        execSync(
          `cd "${defaultDir}" && git init -b main && git config user.email '${emailEsc}' && git config user.name '${nameEsc}'`,
          { stdio: 'pipe', env: { ...process.env, HOME: `/home/${username}` } },
        );
      } catch (error) {
        logger.warn({ username, error }, 'Failed to init default workspace git repo');
      }
      // Ensure ownership
      try {
        execSync(`chown -R "${username}:${username}" "${workspacesDir}"`, { stdio: 'pipe' });
      } catch {
        // Non-critical
      }
    }
  }

  /**
   * Configures SSH key for git access if MCP_LINUX_GIT_SSH_KEY is set
   */
  private setupSshKey(username: string): void {
    const sshKeyBase64 = process.env.GIT_SSH_KEY || process.env.MCP_LINUX_GIT_SSH_KEY;
    if (!sshKeyBase64) return;

    const sshDir = `/home/${username}/.ssh`;
    const keyPath = join(sshDir, 'id_ed25519');
    const configPath = join(sshDir, 'config');

    try {
      mkdirSync(sshDir, { recursive: true });

      // Decode and write the private key (strip all whitespace so multi-line env values decode fully)
      const base64Normalized = sshKeyBase64.replace(/\s+/g, '');
      const keyContent = Buffer.from(base64Normalized, 'base64').toString('utf-8');
      writeFileSync(keyPath, keyContent, { mode: 0o600 });

      // Write SSH config
      const sshConfig = `Host github.com
  HostName github.com
  User git
  IdentityFile ${keyPath}
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
`;
      writeFileSync(configPath, sshConfig, { mode: 0o644 });

      // Set ownership and ensure strict permissions (SSH rejects key if group/other can read)
      chmodSync(sshDir, 0o700);
      execSync(`chown -R "${username}:${username}" "${sshDir}"`, { stdio: 'pipe' });
      chmodSync(keyPath, 0o600);
      chmodSync(configPath, 0o644);

      logger.info({ username }, 'SSH key configured for git access');
    } catch (error) {
      logger.warn({ username, error }, 'Failed to configure SSH key');
    }
  }

  /**
   * Ensures a Linux user exists for the given email.
   * Creates the user if new, returns the Linux username.
   */
  async ensureUser(email: string): Promise<UserMapping> {
    // Check if user already exists in mapping
    const existing = this.db.users[email];
    if (existing) {
      // Ensure Linux user exists (may be missing after image upgrade)
      if (!this.linuxUserExists(existing.username)) {
        this.createLinuxUser(existing.username, existing.uid);
        this.setupDefaultWorkspace(existing.username);
        this.setupSshKey(existing.username);
      }
      return existing;
    }

    // New user: derive username, assign UID, create account
    const username = this.resolveUniqueUsername(email);
    const uid = this.db.nextUid++;

    this.createLinuxUser(username, uid);
    this.setupDefaultWorkspace(username);
    this.setupSshKey(username);

    const mapping: UserMapping = {
      email,
      username,
      uid,
      createdAt: new Date().toISOString(),
    };

    this.db.users[email] = mapping;
    this.saveDb();

    logger.info({ email, username, uid }, 'New user registered');
    return mapping;
  }

  /**
   * Resets a user account: wipes home directory, re-creates from skel + default workspace
   */
  async resetUser(email: string): Promise<void> {
    const mapping = this.db.users[email];
    if (!mapping) {
      throw new UserCreationError(`User not found for email: ${email}`);
    }

    const { username } = mapping;
    const homeDir = `/home/${username}`;

    try {
      // Remove home contents but keep the directory
      execSync(`rm -rf ${homeDir}/.* ${homeDir}/* 2>/dev/null || true`, { stdio: 'pipe' });

      // Re-create from skel
      execSync(`cp -rT /etc/skel "${homeDir}"`, { stdio: 'pipe' });
      execSync(`chown -R "${username}:${username}" "${homeDir}"`, { stdio: 'pipe' });

      // Re-create default workspace and SSH key
      this.setupDefaultWorkspace(username);
      this.setupSshKey(username);

      logger.info({ email, username }, 'User account reset');
    } catch (error) {
      throw new UserCreationError(
        `Failed to reset user ${username}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Gets information about a user account
   */
  async getUserInfo(email: string): Promise<{
    username: string;
    uid: number;
    home: string;
    diskUsage: string;
    createdAt: string;
  } | null> {
    const mapping = this.db.users[email];
    if (!mapping) return null;

    const homeDir = `/home/${mapping.username}`;
    let diskUsage = 'unknown';
    try {
      diskUsage = execSync(`du -sh "${homeDir}" 2>/dev/null | cut -f1`, { encoding: 'utf-8' }).trim();
    } catch {
      // Non-critical
    }

    return {
      username: mapping.username,
      uid: mapping.uid,
      home: homeDir,
      diskUsage,
      createdAt: mapping.createdAt,
    };
  }

  /**
   * Gets the Linux username for an email (or null if not registered)
   */
  getUsername(email: string): string | null {
    return this.db.users[email]?.username || null;
  }

  /**
   * Gets the home directory path for a user
   */
  getHomePath(email: string): string | null {
    const username = this.getUsername(email);
    return username ? `/home/${username}` : null;
  }

  /**
   * Restores all users from the persistent mapping on container startup.
   * Idempotent: skips users that already exist in /etc/passwd.
   */
  async restoreUsers(): Promise<void> {
    const entries = Object.entries(this.db.users);
    if (entries.length === 0) {
      logger.info('No users to restore');
      return;
    }

    logger.info({ count: entries.length }, 'Restoring users from mapping');

    for (const [email, mapping] of entries) {
      try {
        if (!this.linuxUserExists(mapping.username)) {
          this.createLinuxUser(mapping.username, mapping.uid);
          this.setupDefaultWorkspace(mapping.username);
        }
        this.setupSshKey(mapping.username);
      } catch (error) {
        logger.error({ email, username: mapping.username, error }, 'Failed to restore user');
      }
    }
  }
}
