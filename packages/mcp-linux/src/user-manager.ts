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
import { GITHUB_KNOWN_HOSTS } from './utils/github-known-hosts.ts';

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

/** The account a GitHub token belongs to, as GitHub reports it. */
interface GitHubIdentity {
  login: string;
  id: number;
}

/** Whose GitHub token the user's `gh` and HTTPS git remotes authenticate with. */
export type GitHubTokenSource = 'user' | 'shared' | 'none';

export interface GitHubCredentialStatus {
  tokenSource: GitHubTokenSource;
  /** The shared bot SSH key, which is what makes `git@github.com:` remotes work. */
  sharedSshKey: boolean;
  /** Plain state for the model, plus the one action that fixes it when something is missing. */
  message: string;
}

/** The LibreChat setting a user has to fill in - named here so every message says the same thing. */
const GITHUB_PAT_SETTING = 'GITHUB_PAT in the Linux Workspace server settings in LibreChat';
const NEVER_ASK_IN_CHAT = 'Never ask the user to paste a token into the chat.';

export class UserManager {
  private db: UserMappingDB = { users: {}, nextUid: BASE_UID };

  /** Tokens users configured for themselves in LibreChat, keyed by email. Memory only - they
   * arrive with every request, so nothing is persisted here. */
  private readonly ownPatByEmail = new Map<string, string>();

  /** Token last written to a user's gh/git config, so unchanged requests do no filesystem work. */
  private readonly appliedPatByUsername = new Map<string, string>();

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
    /* Own file, not ~/.ssh/known_hosts: this one is rewritten on every start (so a GitHub host key
     * rotation reaches existing accounts) and the default file stays the user's, with whatever
     * other hosts they added. It applies to github.com only, via the config block below. */
    const knownHostsPath = join(sshDir, 'known_hosts_github');

    try {
      await fs.mkdir(sshDir, { recursive: true });

      // Decode and write the private key (strip all whitespace so multi-line env values decode fully)
      const base64Normalized = sshKeyBase64.replace(/\s+/g, '');
      const keyContent = Buffer.from(base64Normalized, 'base64').toString('utf-8');
      await fs.writeFile(keyPath, keyContent, { mode: 0o600 });

      await fs.writeFile(knownHostsPath, GITHUB_KNOWN_HOSTS, { mode: 0o644 });

      /* The last two lines are the point: without host key verification, anything that answers as
       * github.com gets the bot key offered to it. The keys ship with the image, see
       * utils/github-known-hosts.ts. */
      const sshConfig = `Host github.com
  HostName github.com
  User git
  IdentityFile ${keyPath}
  StrictHostKeyChecking yes
  UserKnownHostsFile ${knownHostsPath}
`;
      await fs.writeFile(configPath, sshConfig, { mode: 0o644 });

      // Set ownership and ensure strict permissions (SSH rejects key if group/other can read)
      await fs.chmod(sshDir, 0o700);
      await execFile('chown', ['-R', `${username}:${username}`, sshDir]);
      await fs.chmod(keyPath, 0o600);
      await fs.chmod(configPath, 0o644);
      await fs.chmod(knownHostsPath, 0o644);

      logger.info({ username }, 'SSH key configured for git access');
    } catch (error) {
      logger.warn({ username, error }, 'Failed to configure SSH key');
    }
  }

  /**
   * Writes the GitHub credentials this user should act under.
   *
   * Everyone starts on the shared bot account: its PAT for `gh`, its SSH key for git. A user who
   * configured their own token in LibreChat gets that instead, over HTTPS - a token cannot
   * authenticate an SSH remote, so git URLs are rewritten to HTTPS for them and their commits are
   * authored under their own GitHub identity.
   *
   * Cheap to call repeatedly: nothing is written while the effective token is unchanged.
   */
  private async setupGitHubCli(email: string, username: string): Promise<void> {
    const ownPat = this.ownPatByEmail.get(email) ?? null;
    const effectivePat = ownPat ?? process.env.MCP_GITHUB_PAT ?? null;
    /* Empty string stands for "no token at all", so that state is cached like any other. */
    const applied = effectivePat ?? '';

    if (this.appliedPatByUsername.get(username) === applied) {
      return;
    }

    const xdgConfigDir = `/home/${username}/.config`;
    const ghConfigDir = join(xdgConfigDir, 'gh');
    const ghHostsFile = join(ghConfigDir, 'hosts.yml');

    try {
      /* Runs before the write below so a revoked token is removed even when there is no shared
       * one to fall back to - otherwise it would stay on disk and keep being used. */
      if (!ownPat) {
        await this.clearOwnGitCredentials(username);
      }

      if (!effectivePat) {
        this.appliedPatByUsername.set(username, applied);
        logger.info(
          { username },
          'No GitHub token available (MCP_GITHUB_PAT unset, user has none); gh commands will fail',
        );
        return;
      }

      await fs.mkdir(ghConfigDir, { recursive: true });

      /* `user` is the GitHub login, which only the token knows - MCP_LINUX_GIT_USER_NAME is the
       * git author display name and was the wrong source. Resolve it from the API and omit the
       * field entirely when that fails, since gh can derive it from the token itself. */
      const identity = await this.resolveGitHubIdentity(effectivePat);
      const ghHostsConfig = `github.com:
    oauth_token: ${effectivePat}
    git_protocol: ${ownPat ? 'https' : 'ssh'}
${identity ? `    user: ${identity.login}\n` : ''}`;
      await fs.writeFile(ghHostsFile, ghHostsConfig, { mode: 0o600 });

      /* mkdir -p created ~/.config as root on the way to gh/, and chowning only the leaf left the
       * user unable to add any other XDG config dir - which every tool they install wants. Mode is
       * left as it is: whoever created the directory picked it. */
      await execFile('chown', [`${username}:${username}`, xdgConfigDir]);

      await fs.chmod(ghConfigDir, 0o700);
      await execFile('chown', ['-R', `${username}:${username}`, ghConfigDir]);
      await fs.chmod(ghHostsFile, 0o600);

      if (ownPat) {
        await this.enableOwnGitCredentials(username, ownPat, identity);
      }

      this.appliedPatByUsername.set(username, applied);
      logger.info(
        { username, login: identity?.login, own: ownPat !== null },
        'GitHub CLI configured',
      );
    } catch (error) {
      logger.warn({ username, error }, 'Failed to configure GitHub CLI');
    }
  }

  /**
   * Records the token a user configured for themselves in LibreChat and applies it if their
   * account already exists. Passing null puts them back on the shared bot account.
   *
   * Called on every request, including the ones that change nothing. It does not shortcut on an
   * unchanged token, because right after a container start "unchanged" still means the home on the
   * persistent volume was never reconciled with this process - setupGitHubCli's own cache is what
   * keeps this to one write per user per start.
   */
  async setUserGitHubPat(email: string, pat: string | null): Promise<void> {
    if (pat) {
      this.ownPatByEmail.set(email, pat);
    } else {
      this.ownPatByEmail.delete(email);
    }

    const username = this.getUsername(email);
    if (!username) {
      /* Account not created yet - ensureUser applies it as part of setup. */
      return;
    }
    await this.setupGitHubCli(email, username);
  }

  /**
   * What this user's git and `gh` authenticate as right now.
   *
   * Exists so a failing tool can say why instead of handing the model a bare
   * `Permission denied (publickey)`, which it then explains by guessing.
   */
  describeGitHubCredentials(email: string): GitHubCredentialStatus {
    const hasOwn = this.ownPatByEmail.has(email);
    const hasShared = (process.env.MCP_GITHUB_PAT ?? '').trim() !== '';
    const sharedSshKey =
      (process.env.GIT_SSH_KEY ?? process.env.MCP_LINUX_GIT_SSH_KEY ?? '').trim() !== '';
    const tokenSource: GitHubTokenSource = hasOwn ? 'user' : hasShared ? 'shared' : 'none';

    if (tokenSource === 'user') {
      return {
        tokenSource,
        sharedSshKey,
        message: `Using the GitHub token this user configured as ${GITHUB_PAT_SETTING}. Commits are authored under their GitHub account and remotes go over HTTPS.`,
      };
    }

    if (tokenSource === 'shared') {
      return {
        tokenSource,
        sharedSshKey,
        message: `Using the shared bot GitHub account, which only reaches repositories that account has access to. To work as themselves, the user sets ${GITHUB_PAT_SETTING}. ${NEVER_ASK_IN_CHAT}`,
      };
    }

    return {
      tokenSource,
      sharedSshKey,
      message: sharedSshKey
        ? `No GitHub token is configured, so \`gh\` and HTTPS remotes cannot authenticate; only the shared SSH key works, and only for repositories that bot account can reach. The user has to set ${GITHUB_PAT_SETTING}. ${NEVER_ASK_IN_CHAT}`
        : `No GitHub credentials are configured at all: no personal token, no shared token, no shared SSH key. Nothing can authenticate against GitHub until the user sets ${GITHUB_PAT_SETTING}. ${NEVER_ASK_IN_CHAT}`,
    };
  }

  /**
   * Points git at the user's own token: stored as an HTTPS credential, with SSH URLs rewritten so
   * remotes cloned under the bot account keep working, and commits authored as them.
   *
   * The `ownCredentials` marker records that these values came from us, so switching back can
   * remove exactly what we set and nothing a user configured by hand in the terminal.
   */
  private async enableOwnGitCredentials(
    username: string,
    pat: string,
    identity: GitHubIdentity | null,
  ): Promise<void> {
    const credentialsFile = `/home/${username}/.git-credentials`;
    await fs.writeFile(credentialsFile, `https://x-access-token:${pat}@github.com\n`, {
      mode: 0o600,
    });
    await execFile('chown', [`${username}:${username}`, credentialsFile]);

    await this.gitConfig(username, ['credential.helper', 'store']);
    await this.gitConfig(username, ['url.https://github.com/.insteadOf', 'git@github.com:']);
    await this.gitConfig(username, ['url.https://github.com/.insteadOf', 'ssh://git@github.com/'], {
      add: true,
    });

    if (identity) {
      await this.gitConfig(username, ['user.name', identity.login]);
      /* The noreply address attributes the commit to their account without exposing a private
       * address; the numeric-id form is the one GitHub accepts for every account age. */
      await this.gitConfig(username, [
        'user.email',
        `${identity.id}+${identity.login}@users.noreply.github.com`,
      ]);
    }

    await this.gitConfig(username, ['faktenforum.ownCredentials', 'true']);
  }

  /** Undoes enableOwnGitCredentials, leaving anything the user set by hand alone. */
  private async clearOwnGitCredentials(username: string): Promise<void> {
    if (!(await this.hasOwnCredentialsMarker(username))) {
      return;
    }

    await fs.rm(`/home/${username}/.git-credentials`, { force: true });
    for (const args of [
      ['--unset-all', 'credential.helper'],
      ['--remove-section', 'url.https://github.com/'],
      ['--unset', 'user.name'],
      ['--unset', 'user.email'],
      ['--unset', 'faktenforum.ownCredentials'],
    ]) {
      await this.gitConfig(username, args);
    }
    logger.info({ username }, 'Reverted git credentials to the shared account');
  }

  private async hasOwnCredentialsMarker(username: string): Promise<boolean> {
    try {
      const { stdout } = await execFile('runuser', [
        '-u',
        username,
        '--',
        'git',
        'config',
        '--global',
        '--get',
        'faktenforum.ownCredentials',
      ]);
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  /** Runs `git config --global` as the user; a missing key to unset is not an error worth raising. */
  private async gitConfig(
    username: string,
    args: string[],
    options: { add?: boolean } = {},
  ): Promise<void> {
    try {
      await execFile('runuser', [
        '-u',
        username,
        '--',
        'git',
        'config',
        '--global',
        ...(options.add === true ? ['--add'] : []),
        ...args,
      ]);
    } catch (error) {
      logger.debug({ username, args, error }, 'git config call did not apply');
    }
  }

  /**
   * Looks up the account belonging to the PAT. Returns null on any failure - an unresolved
   * identity is not worth failing the whole user setup over, and gh works without the field.
   */
  private async resolveGitHubIdentity(pat: string): Promise<GitHubIdentity | null> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'mcp-linux',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, 'Could not resolve the GitHub account for the PAT');
        return null;
      }
      const body = (await response.json()) as { login?: unknown; id?: unknown };
      if (typeof body.login !== 'string' || body.login.length === 0) {
        return null;
      }
      return { login: body.login, id: typeof body.id === 'number' ? body.id : 0 };
    } catch (error) {
      logger.warn({ error }, 'Could not resolve the GitHub account for the PAT');
      return null;
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
        this.appliedPatByUsername.delete(existing.username);
        await this.createLinuxUser(existing.username, existing.uid);
        await this.setupDefaultWorkspace(existing.username);
        await this.setupSshKey(existing.username);
        await this.setupGitHubCli(email, existing.username);
      }
      return existing;
    }

    // New user: derive username, assign UID, create account
    const username = this.resolveUniqueUsername(email);
    const uid = this.db.nextUid++;

    await this.createLinuxUser(username, uid);
    await this.setupDefaultWorkspace(username);
    await this.setupSshKey(username);
    await this.setupGitHubCli(email, username);

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
    /* The wipe below takes the gh and git config with it, so the token has to be written again. */
    this.appliedPatByUsername.delete(username);

    try {
      // Remove home contents but keep the directory
      await execFile('find', [homeDir, '-mindepth', '1', '-delete']);

      // Re-create from skel
      await execFile('cp', ['-rT', '/etc/skel', homeDir]);
      await execFile('chown', ['-R', `${username}:${username}`, homeDir]);

      // Re-create default workspace and SSH key
      await this.setupDefaultWorkspace(username);
      await this.setupSshKey(username);
      await this.setupGitHubCli(email, username);

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

    for (const [, mapping] of entries) {
      try {
        if (!await this.linuxUserExists(mapping.username)) {
          this.appliedPatByUsername.delete(mapping.username);
          await this.createLinuxUser(mapping.username, mapping.uid);
          await this.setupDefaultWorkspace(mapping.username);
        }
        await this.setupSshKey(mapping.username);
        /* No GitHub credentials here on purpose. Tokens are per user and only a request carries
         * one, so startup could write nothing but the shared bot token - over the configuration of
         * every user who has their own, until their next request repaired it. The first request of
         * each user applies the right token instead (setUserGitHubPat), and a user who configured
         * none still gets the shared one that way. */
      } catch (error) {
        logger.error({ email: mapping.email, username: mapping.username, error }, 'Failed to restore user');
      }
    }
  }
}
