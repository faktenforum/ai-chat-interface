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

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './utils/logger.ts';
import { UserCreationError } from './utils/errors.ts';
import { deriveUsername, addUsernameSuffix } from './utils/security.ts';
import { getDefaultGitIdentity } from './utils/git-config.ts';

const execFile = promisify(execFileCb);

const DATA_DIR = '/app/data';
const USERS_FILE = join(DATA_DIR, 'users.json');
const BASE_UID = 2000;

const DEFAULT_WORKSPACE_GITIGNORE = 'uploads/\nvenv/\n.venv/\n';

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
  private db: UserMappingDB = { users: {}, nextUid: BASE_UID };

  constructor() {
    // DB loaded via async initialize()
  }

  /**
   * Initializes the user manager by loading the DB from disk.
   * Must be called before any other method.
   */
  async initialize(): Promise<void> {
    this.db = await this.loadDb();
  }

  /**
   * Loads the user mapping database from disk
   */
  private async loadDb(): Promise<UserMappingDB> {
    try {
      const data = await fs.readFile(USERS_FILE, 'utf-8');
      const db = JSON.parse(data) as UserMappingDB;

      // Validate loaded data to prevent injection from tampered file
      if (db && typeof db === 'object') {
        if (typeof db.nextUid !== 'number') db.nextUid = BASE_UID;
        if (!db.users || typeof db.users !== 'object') db.users = {};

        for (const key in db.users) {
          const u = db.users[key];
          if (!u || typeof u.username !== 'string' || typeof u.uid !== 'number') {
            logger.warn({ key }, 'Invalid user entry in DB, removing');
            delete db.users[key];
            continue;
          }
          // Strict username validation (alphanumeric + underscore)
          if (!/^[a-z0-9_]+$/.test(u.username)) {
             logger.warn({ username: u.username }, 'Invalid username in DB, removing');
             delete db.users[key];
          }
        }
        return db;
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error({ error }, 'Failed to load user mapping, starting fresh');
      }
    }
    return { users: {}, nextUid: BASE_UID };
  }

  /**
   * Persists the user mapping database to disk using atomic write
   */
  private async saveDb(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tempFile = `${USERS_FILE}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(this.db, null, 2), 'utf-8');
      await fs.rename(tempFile, USERS_FILE);
    } catch (error) {
      logger.error({ error }, 'Failed to save user mapping');
    }
  }

  /**
   * Checks if a Linux username already exists in the system
   */
  private async linuxUserExists(username: string): Promise<boolean> {
    try {
      await execFile('id', [username]);
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
  private async createLinuxUser(username: string, uid: number): Promise<void> {
    try {
      await execFile('useradd', [
        '-m',
        '-s', '/bin/bash',
        '-u', uid.toString(),
        '-d', `/home/${username}`,
        username,
      ]);
      logger.info({ username, uid }, 'Created Linux user');
    } catch {
      // User may already exist (e.g., from a previous container with the same volume)
      if (await this.linuxUserExists(username)) {
        logger.info({ username }, 'Linux user already exists, skipping creation');
        return;
      }
      throw new UserCreationError(`Failed to create Linux user ${username}`);
    }
  }

  /**
   * Sets up the default workspace (~/workspaces/default/) with git init
   */
  private async setupDefaultWorkspace(username: string): Promise<void> {
    const workspacesDir = `/home/${username}/workspaces`;
    const defaultDir = join(workspacesDir, 'default');

    try {
      await fs.access(defaultDir);
      return; // already exists
    } catch {
      // Does not exist, proceed to create
    }

    await fs.mkdir(defaultDir, { recursive: true });
    try {
      const { name, email } = await getDefaultGitIdentity(username);
      await execFile('git', ['-C', defaultDir, 'init', '-b', 'main']);
      await execFile('git', ['-C', defaultDir, 'config', 'user.email', email]);
      await execFile('git', ['-C', defaultDir, 'config', 'user.name', name]);

      const gitignorePath = join(defaultDir, '.gitignore');
      try {
        await fs.access(gitignorePath);
      } catch {
        await fs.writeFile(gitignorePath, DEFAULT_WORKSPACE_GITIGNORE, 'utf-8').catch(() => {});
      }
    } catch (error) {
      logger.warn({ username, error }, 'Failed to init default workspace git repo');
    }
    // Ensure ownership
    try {
      await execFile('chown', ['-R', `${username}:${username}`, workspacesDir]);
    } catch {
      // Non-critical
    }
  }

  /**
   * Configures SSH key for git access if MCP_LINUX_GIT_SSH_KEY is set
   */
  private async setupSshKey(username: string): Promise<void> {
    const sshKeyBase64 = process.env.GIT_SSH_KEY || process.env.MCP_LINUX_GIT_SSH_KEY;
    if (!sshKeyBase64) return;

    const sshDir = `/home/${username}/.ssh`;
    const keyPath = join(sshDir, 'id_ed25519');
    const configPath = join(sshDir, 'config');

    try {
      await fs.mkdir(sshDir, { recursive: true });

      // Decode and write the private key (strip all whitespace so multi-line env values decode fully)
      const base64Normalized = sshKeyBase64.replace(/\s+/g, '');
      const keyContent = Buffer.from(base64Normalized, 'base64').toString('utf-8');
      await fs.writeFile(keyPath, keyContent, { mode: 0o600 });

      // Write SSH config
      const sshConfig = `Host github.com
  HostName github.com
  User git
  IdentityFile ${keyPath}
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
`;
      await fs.writeFile(configPath, sshConfig, { mode: 0o644 });

      // Set ownership and ensure strict permissions (SSH rejects key if group/other can read)
      await fs.chmod(sshDir, 0o700);
      await execFile('chown', ['-R', `${username}:${username}`, sshDir]);
      await fs.chmod(keyPath, 0o600);
      await fs.chmod(configPath, 0o644);

      logger.info({ username }, 'SSH key configured for git access');
    } catch (error) {
      logger.warn({ username, error }, 'Failed to configure SSH key');
    }
  }

  /**
   * Configures GitHub CLI authentication if MCP_GITHUB_PAT is set
   * Uses the same PAT as GitHub MCP for consistency
   */
  private async setupGitHubCli(username: string): Promise<void> {
    const githubPat = process.env.MCP_GITHUB_PAT;
    if (!githubPat) return;

    const ghConfigDir = `/home/${username}/.config/gh`;
    const ghHostsFile = join(ghConfigDir, 'hosts.yml');

    try {
      await fs.mkdir(ghConfigDir, { recursive: true });

      // Write GitHub CLI hosts config with PAT authentication
      const gitUserName = process.env.MCP_LINUX_GIT_USER_NAME || 'faktenforum-mcp-bot';
      const ghHostsConfig = `github.com:
    oauth_token: ${githubPat}
    git_protocol: ssh
    user: ${gitUserName}
`;
      await fs.writeFile(ghHostsFile, ghHostsConfig, { mode: 0o600 });

      // Set ownership and permissions
      await fs.chmod(ghConfigDir, 0o700);
      await execFile('chown', ['-R', `${username}:${username}`, ghConfigDir]);
      await fs.chmod(ghHostsFile, 0o600);

      logger.info({ username }, 'GitHub CLI configured with PAT');
    } catch (error) {
      logger.warn({ username, error }, 'Failed to configure GitHub CLI');
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
      if (!await this.linuxUserExists(existing.username)) {
        await this.createLinuxUser(existing.username, existing.uid);
        await this.setupDefaultWorkspace(existing.username);
        await this.setupSshKey(existing.username);
        await this.setupGitHubCli(existing.username);
      }
      return existing;
    }

    // New user: derive username, assign UID, create account
    const username = this.resolveUniqueUsername(email);
    const uid = this.db.nextUid++;

    await this.createLinuxUser(username, uid);
    await this.setupDefaultWorkspace(username);
    await this.setupSshKey(username);
    await this.setupGitHubCli(username);

    const mapping: UserMapping = {
      email,
      username,
      uid,
      createdAt: new Date().toISOString(),
    };

    this.db.users[email] = mapping;
    await this.saveDb();

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
      await execFile('find', [homeDir, '-mindepth', '1', '-delete']);

      // Re-create from skel
      await execFile('cp', ['-rT', '/etc/skel', homeDir]);
      await execFile('chown', ['-R', `${username}:${username}`, homeDir]);

      // Re-create default workspace and SSH key
      await this.setupDefaultWorkspace(username);
      await this.setupSshKey(username);
      await this.setupGitHubCli(username);

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
      const { stdout } = await execFile('du', ['-sh', homeDir]);
      diskUsage = stdout.split('\t')[0].trim();
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
   * Returns all registered user emails (for scheduled cleanup etc.)
   */
  listUserEmails(): string[] {
    return Object.keys(this.db.users);
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
        if (!await this.linuxUserExists(mapping.username)) {
          await this.createLinuxUser(mapping.username, mapping.uid);
          await this.setupDefaultWorkspace(mapping.username);
        }
        await this.setupSshKey(mapping.username);
        await this.setupGitHubCli(mapping.username);
      } catch (error) {
        logger.error({ email, username: mapping.username, error }, 'Failed to restore user');
      }
    }
  }
}
