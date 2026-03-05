#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Worker Process
 *
 * Runs as an unprivileged Linux user. Manages:
 * - Terminal sessions (persistent PTYs via node-pty)
 * - Workspace operations (git init, clone, status)
 *
 * Communicates with the main MCP server via Unix socket IPC.
 */

import { createServer, type Socket } from 'node:net';
import fs from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { getDefaultGitIdentity } from './utils/git-config.ts';
import { validateWorkspaceName, validateTerminalId } from './utils/security.ts';
import { stripAnsi } from './utils/strip-ansi.ts';
import {
  type PlanTask,
  type WorkspaceConfig,
  type SubmodulesStatus,
  isTaskStatus,
  taskStatusFrom,
  PLAN_DIR,
  PLAN_MD_FILENAME,
  TASKS_FILENAME,
  AGENTS_MD_FILENAME,
  CONFIG_FILENAME,
  SUBMODULES_STATUS_FILENAME,
  LIST_WORKSPACES_PLAN_PREVIEW_LEN,
} from './workspace-plan.ts';
import { createFromEnv, type CodeIndexer } from '@codebase-indexer/core';

const execFile = promisify(execFileCb);

// Lazy-initialized code indexer instance (created on first use)
let _codeIndexer: CodeIndexer | null = null;
function getCodeIndexer(): CodeIndexer {
  if (!_codeIndexer) {
    _codeIndexer = createFromEnv();
  }
  return _codeIndexer;
}

// Parse CLI arguments
const args = process.argv.slice(2);
const socketPath = args[args.indexOf('--socket') + 1];
const homeDir = args[args.indexOf('--home') + 1];

if (!socketPath || !homeDir) {
  console.error('Usage: worker.ts --socket <path> --home <path>');
  process.exit(1);
}

const workspacesDir = join(homeDir, 'workspaces');

// ── Terminal Management ──────────────────────────────────────────────────────

interface TerminalSession {
  id: string;
  pty: import('node-pty').IPty;
  output: string[];
  totalLength: number;
  workspace: string;
  createdAt: number;
}

const terminals = new Map<string, TerminalSession>();

/**
 * Dynamically imports node-pty (native module, loaded at runtime)
 */
async function loadNodePty(): Promise<typeof import('node-pty')> {
  return await import('node-pty');
}

let ptyModule: typeof import('node-pty') | null = null;

async function getPty(): Promise<typeof import('node-pty')> {
  if (!ptyModule) {
    ptyModule = await loadNodePty();
  }
  return ptyModule;
}

/**
 * Creates a new terminal session in a workspace
 */
async function createTerminal(workspace: string, terminalId?: string): Promise<string> {
  const pty = await getPty();
  const id = terminalId || randomUUID().slice(0, 8);

  // Validate ID if provided
  if (terminalId) {
    const error = validateTerminalId(terminalId);
    if (error) throw new Error(error);
  }

  const cwd = resolveWorkspacePath(workspace);

  try {
    await fs.access(cwd);
  } catch {
    throw new Error(`Workspace directory does not exist: ${workspace}`);
  }

  const shell = pty.spawn('/bin/bash', ['--login'], {
    name: 'xterm-256color',
    cols: 200,
    rows: 50,
    cwd,
    env: {
      HOME: homeDir,
      USER: process.env.USER || '',
      LOGNAME: process.env.LOGNAME || '',
      SHELL: '/bin/bash',
      TERM: 'xterm-256color',
      PATH: `${homeDir}/.local/bin:${process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}`,
      LANG: 'en_US.UTF-8',
    },
  });

  const session: TerminalSession = {
    id,
    pty: shell,
    output: [],
    totalLength: 0,
    workspace,
    createdAt: Date.now(),
  };

  shell.onData((data: string) => {
    session.output.push(data);
    session.totalLength += data.length;

    // Limit buffer: keep last ~1MB
    while (session.totalLength > 1_000_000 && session.output.length > 1) {
      const removed = session.output.shift()!;
      session.totalLength -= removed.length;
    }
  });

  shell.onExit(({ exitCode, signal }) => {
    terminals.delete(id);
  });

  terminals.set(id, session);
  return id;
}

// ── Workspace Operations ─────────────────────────────────────────────────────

function resolveWorkspacePath(workspace: string): string {
  const error = validateWorkspaceName(workspace);
  if (error) {
    throw new Error(error);
  }
  return join(workspacesDir, workspace);
}

interface PlanData {
  plan: string | null;
  tasks: PlanTask[];
}

function getPlanDir(workspace: string): string {
  return join(resolveWorkspacePath(workspace), PLAN_DIR);
}

async function readPlanData(workspace: string): Promise<PlanData> {
  const dir = getPlanDir(workspace);
  let plan: string | null = null;
  const planPath = join(dir, PLAN_MD_FILENAME);
  try {
    const raw = (await fs.readFile(planPath, 'utf-8')).trim();
    plan = raw.length > 0 ? raw : null;
  } catch {
    /* file not found or read error */
  }

  let tasks: PlanTask[] = [];
  const tasksPath = join(dir, TASKS_FILENAME);
  try {
    const raw = await fs.readFile(tasksPath, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    const arr =
      data != null && typeof data === 'object' && !Array.isArray(data) && 'tasks' in data && Array.isArray((data as { tasks: unknown }).tasks)
        ? (data as { tasks: unknown[] }).tasks
        : Array.isArray(data)
          ? data
          : [];
    tasks = arr
      .filter(
        (t): t is Record<string, unknown> =>
          t != null && typeof t === 'object' && typeof (t as Record<string, unknown>).title === 'string',
      )
      .map((t): PlanTask => {
        const title = String(t.title);
        const status = taskStatusFrom(t.status, t.done === true);
        return { title, status };
      });
  } catch {
    /* parse or read error */
  }
  return { plan, tasks };
}

async function readInstructionsFile(workspace: string): Promise<string | null> {
  const path = join(resolveWorkspacePath(workspace), AGENTS_MD_FILENAME);
  try {
    const raw = (await fs.readFile(path, 'utf-8')).trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

async function writePlanData(workspace: string, data: PlanData): Promise<void> {
  const dir = getPlanDir(workspace);
  await fs.mkdir(dir, { recursive: true });

  const planPath = join(dir, PLAN_MD_FILENAME);
  if (data.plan != null && data.plan.length > 0) {
    await fs.writeFile(planPath, data.plan, 'utf-8');
  } else {
    try { await fs.unlink(planPath); } catch { /* ignore */ }
  }

  await fs.writeFile(join(dir, TASKS_FILENAME), JSON.stringify({ tasks: data.tasks }, null, 2), 'utf-8');
}

async function readWorkspaceConfig(workspace: string): Promise<WorkspaceConfig> {
  const path = join(getPlanDir(workspace), CONFIG_FILENAME);
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    if (data != null && typeof data === 'object' && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      return {
        code_index_enabled:
          typeof obj.code_index_enabled === 'boolean' ? obj.code_index_enabled : undefined,
      };
    }
  } catch {
    /* parse or read error */
  }
  return {};
}

async function writeWorkspaceConfig(workspace: string, config: WorkspaceConfig): Promise<void> {
  const dir = getPlanDir(workspace);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, CONFIG_FILENAME), JSON.stringify(config, null, 2), 'utf-8');
}

async function readSubmodulesStatus(workspace: string): Promise<SubmodulesStatus | null> {
  const path = join(getPlanDir(workspace), SUBMODULES_STATUS_FILENAME);
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    if (data != null && typeof data === 'object' && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      const status = obj.status as string | undefined;
      if (
        status === 'idle' ||
        status === 'updating' ||
        status === 'done' ||
        status === 'error' ||
        status === 'none'
      ) {
        return {
          status,
          message: typeof obj.message === 'string' ? obj.message : undefined,
        };
      }
    }
  } catch {
    /* parse or read error */
  }
  return null;
}

async function writeSubmodulesStatus(workspace: string, data: SubmodulesStatus): Promise<void> {
  const dir = getPlanDir(workspace);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, SUBMODULES_STATUS_FILENAME),
    JSON.stringify(data, null, 0),
    'utf-8',
  );
}

/** True if code index is enabled globally and not disabled for this workspace via config.json. */
async function isCodeIndexEnabledForWorkspace(workspace: string): Promise<boolean> {
  if (!getCodeIndexer().isEnabled()) return false;
  const config = await readWorkspaceConfig(workspace);
  return config.code_index_enabled !== false;
}

function applyTaskUpdates(
  current: PlanTask[],
  updates: Array<{ index: number; status: string }>,
): PlanTask[] {
  const result = current.map((t) => ({ ...t }));
  for (const u of updates) {
    if (u.index >= 0 && u.index < result.length && isTaskStatus(u.status)) {
      result[u.index].status = u.status;
    }
  }
  return result;
}

/**
 * Escapes a path for use inside double-quoted shell string (escape \ and ").
 */
function escapeForDoubleQuotedShell(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function getGitMetadata(workspace: string): Promise<{ branch: string; dirty: boolean }> {
  // Validate workspace name to prevent path traversal
  const error = validateWorkspaceName(workspace);
  if (error) return { branch: 'main', dirty: false };

  const cwd = join(workspacesDir, workspace);
  let branch = 'main';
  let dirty = false;

  try {
    const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeout: 5000,
    });
    branch = stdout.trim() || 'main';
  } catch {
    // Not a git repo or no commits
  }

  try {
    const { stdout } = await execFile('git', ['status', '--porcelain'], {
      cwd,
      timeout: 5000,
    });
    dirty = stdout.trim().length > 0;
  } catch {
    // Not a git repo
  }

  return { branch, dirty };
}

const DEFAULT_STATUS_MAX_FILES = 50;
const DEFAULT_STATUS_COLLAPSE_DIRS = 'uploads,venv,.venv';

const DEFAULT_GITIGNORE = 'uploads/\nvenv/\n.venv/\n';

async function ensureDefaultGitignore(wsPath: string): Promise<void> {
  const gitignorePath = join(wsPath, '.gitignore');
  try {
    await fs.access(gitignorePath);
    return; // already exists
  } catch {
    // does not exist, create it
  }
  try {
    await fs.writeFile(gitignorePath, DEFAULT_GITIGNORE, 'utf-8');
  } catch {
    // Non-fatal
  }
}

function getStatusLimitConfig(): { maxFiles: number; collapseDirs: Set<string> } {
  const maxFiles = parseInt(process.env.MCP_LINUX_STATUS_MAX_FILES || '', 10);
  const raw = process.env.MCP_LINUX_STATUS_COLLAPSE_DIRS ?? DEFAULT_STATUS_COLLAPSE_DIRS;
  const collapseDirs = new Set(
    raw.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
  );
  return {
    maxFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? maxFiles : DEFAULT_STATUS_MAX_FILES,
    collapseDirs,
  };
}

/**
 * Collapse paths under bulk dirs to a single summary line and cap total entries per category.
 * Returns the reduced arrays plus counts and a truncated flag.
 */
function capAndCollapseStatusLists(
  staged: string[],
  unstaged: string[],
  untracked: string[],
): {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
  truncated: boolean;
} {
  const { maxFiles, collapseDirs } = getStatusLimitConfig();

  function processList(lines: string[]): { result: string[]; count: number } {
    const count = lines.length;
    const byDir = new Map<string, string[]>();
    const other: string[] = [];
    for (const line of lines) {
      const pathPart = line.length >= 2 && line[1] === ' ' ? line.slice(2) : line;
      const top = pathPart.split('/')[0];
      const key = top.toLowerCase();
      if (collapseDirs.has(key)) {
        const list = byDir.get(top) ?? [];
        list.push(line);
        byDir.set(top, list);
      } else {
        other.push(line);
      }
    }
    const result: string[] = [];
    for (const [dirName, list] of byDir) {
      result.push(`${dirName}/ (${list.length} files)`);
    }
    const cap = Math.max(0, maxFiles - result.length);
    for (let i = 0; i < other.length && result.length < maxFiles; i++) {
      result.push(other[i]);
    }
    return { result, count };
  }

  const stagedOut = processList(staged);
  const unstagedOut = processList(unstaged);
  const untrackedOut = processList(untracked);
  const truncated =
    stagedOut.count > stagedOut.result.length ||
    unstagedOut.count > unstagedOut.result.length ||
    untrackedOut.count > untrackedOut.result.length;

  return {
    staged: stagedOut.result,
    unstaged: unstagedOut.result,
    untracked: untrackedOut.result,
    staged_count: stagedOut.count,
    unstaged_count: unstagedOut.count,
    untracked_count: untrackedOut.count,
    truncated,
  };
}

/**
 * Deletes files in uploadsDir older than olderThanDays (0 = delete all).
 * Removes empty subdirs. Returns number of files deleted.
 */
async function purgeUploadsByAge(uploadsDir: string, olderThanDays: number): Promise<number> {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  const entries = await fs.readdir(uploadsDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(uploadsDir, entry.name);
    if (entry.isDirectory()) {
      deleted += await purgeUploadsByAge(full, olderThanDays);
      try {
        const remaining = await fs.readdir(full);
        if (remaining.length === 0) await fs.rm(full, { recursive: true });
      } catch { /* ignore */ }
    } else {
      try {
        const stat = await fs.stat(full);
        if (olderThanDays === 0 || stat.mtimeMs < cutoff) {
          await fs.unlink(full);
          deleted++;
        }
      } catch { /* ignore */ }
    }
  }
  return deleted;
}

/**
 * Spawns a child process with a timeout, returning stdout/stderr.
 * Used for long-running operations like git clone.
 */
function spawnWithTimeout(
  command: string,
  args: string[],
  options: { timeout?: number; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { timeout = 120000, cwd } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeout);

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (killed) {
        reject(new Error(`Process timed out after ${timeout}ms`));
      } else if (code !== 0) {
        reject(new Error(stderr || `Process exited with code ${code ?? signal}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// ── Request Handlers ─────────────────────────────────────────────────────────

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<string, Handler> = {

  // Terminal Tools ─────────────────────────────────────────────────────────────

  async execute_command(params) {
    const rawCommand = (params.command as string) || '';
    const workspace = (params.workspace as string) || 'default';
    const timeoutMs = (params.timeout_ms as number) || 30000;
    let terminalId = params.terminal_id as string | undefined;

    if (terminalId) {
      const error = validateTerminalId(terminalId);
      if (error) throw new Error(error);
    }

    const workspaceRoot = resolveWorkspacePath(workspace);
    const quotedRoot = '"' + escapeForDoubleQuotedShell(workspaceRoot) + '"';
    const wrappedCommand =
      rawCommand.trim() === ''
        ? `cd ${quotedRoot}`
        : `cd ${quotedRoot} && ${rawCommand}`;

    // Create or reuse terminal
    if (terminalId && terminals.has(terminalId)) {
      // Reuse existing terminal
    } else {
      terminalId = await createTerminal(workspace, terminalId);
    }

    const session = terminals.get(terminalId)!;
    const outputBefore = session.output.length;

    const waitSettle = async (): Promise<void> => {
      let lastOutputLength = session.output.length;
      const start = Date.now();
      let settled = 0;
      await new Promise<void>((resolve) => {
        const check = () => {
          if (Date.now() - start > timeoutMs) {
            resolve();
            return;
          }
          if (session.output.length !== lastOutputLength) {
            lastOutputLength = session.output.length;
            settled = 0;
          } else {
            settled += 100;
          }
          if (settled >= 500) {
            resolve();
            return;
          }
          setTimeout(check, 100);
        };
        setTimeout(check, 100);
      });
    };

    // Run user command (always in workspace root)
    session.pty.write(wrappedCommand + '\n');
    await waitSettle();

    const newOutput = session.output.slice(outputBefore).join('');

    // Get current working directory via temp file (no pollution of user output)
    const cwdFile = join(homeDir, '.mcp_cwd_' + terminalId + '.txt');
    const cwdCmd = `pwd > "${escapeForDoubleQuotedShell(cwdFile)}" 2>/dev/null\n`;
    session.pty.write(cwdCmd);
    await waitSettle();

    let cwd = workspaceRoot;
    try {
      cwd = (await fs.readFile(cwdFile, 'utf-8')).trim() || workspaceRoot;
      await fs.unlink(cwdFile);
    } catch {
      // Keep workspaceRoot as fallback
    }

    const cwdRelative =
      cwd === workspaceRoot ? '' : relative(workspaceRoot, cwd).replace(/^\//, '') || '';

    const meta = await getGitMetadata(workspace);

    return {
      terminal_id: terminalId,
      output: stripAnsi(newOutput),
      workspace,
      cwd,
      cwd_relative_to_workspace: cwdRelative || undefined,
      ...meta,
    };
  },

  async read_terminal_output(params) {
    const terminalId = params.terminal_id as string;
    const offset = (params.offset as number) || 0;
    const length = (params.length as number) || undefined;

    const error = validateTerminalId(terminalId);
    if (error) throw new Error(error);

    const session = terminals.get(terminalId);
    if (!session) {
      throw new Error(`Terminal ${terminalId} not found`);
    }

    const fullOutput = session.output.join('');
    const slice = length ? fullOutput.slice(offset, offset + length) : fullOutput.slice(offset);
    const meta = await getGitMetadata(session.workspace);

    return {
      terminal_id: terminalId,
      output: stripAnsi(slice),
      total_length: fullOutput.length,
      ...meta,
    };
  },

  async write_terminal(params) {
    const terminalId = params.terminal_id as string;
    const input = params.input as string;
    const timeoutMs = (params.timeout_ms as number) || 5000;

    const error = validateTerminalId(terminalId);
    if (error) throw new Error(error);

    const session = terminals.get(terminalId);
    if (!session) {
      throw new Error(`Terminal ${terminalId} not found`);
    }

    const outputBefore = session.output.length;
    session.pty.write(input);

    // Wait for response
    let lastLen = session.output.length;
    const start = Date.now();
    let settled = 0;

    await new Promise<void>((resolve) => {
      const check = () => {
        if (Date.now() - start > timeoutMs) { resolve(); return; }
        if (session.output.length !== lastLen) { lastLen = session.output.length; settled = 0; }
        else { settled += 100; }
        if (settled >= 300) { resolve(); return; }
        setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const newOutput = session.output.slice(outputBefore).join('');
    const meta = await getGitMetadata(session.workspace);

    return {
      terminal_id: terminalId,
      output: stripAnsi(newOutput),
      ...meta,
    };
  },

  async list_terminals() {
    const result: Array<{
      terminal_id: string;
      workspace: string;
      created_at: number;
      output_length: number;
    }> = [];

    for (const [id, session] of terminals) {
      result.push({
        terminal_id: id,
        workspace: session.workspace,
        created_at: session.createdAt,
        output_length: session.totalLength,
      });
    }

    return { terminals: result };
  },

  async kill_terminal(params) {
    const terminalId = params.terminal_id as string;
    const error = validateTerminalId(terminalId);
    if (error) throw new Error(error);

    const session = terminals.get(terminalId);
    if (!session) {
      throw new Error(`Terminal ${terminalId} not found`);
    }

    session.pty.kill();
    terminals.delete(terminalId);
    return { killed: terminalId };
  },

  // Workspace Tools ───────────────────────────────────────────────────────────

  async list_workspaces() {
    let entries;
    try {
      entries = await fs.readdir(workspacesDir, { withFileTypes: true });
    } catch {
      return { workspaces: [] };
    }

    const workspaces = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const wsPath = join(workspacesDir, entry.name);

      // Skip invalid workspace names (e.g. hidden files)
      if (validateWorkspaceName(entry.name)) continue;

      const meta = await getGitMetadata(entry.name);

      let remoteUrl = '';
      try {
        const { stdout } = await execFile('git', ['remote', 'get-url', 'origin'], {
          cwd: wsPath,
          timeout: 5000,
        });
        remoteUrl = stdout.trim();
      } catch {
        // No remote
      }

      const { plan } = await readPlanData(entry.name);
      const normalized = plan != null && plan.length > 0 ? plan.replace(/\s+/g, ' ').trim() : '';
      const plan_preview =
        normalized.length > 0
          ? normalized.slice(0, LIST_WORKSPACES_PLAN_PREVIEW_LEN) +
            (normalized.length > LIST_WORKSPACES_PLAN_PREVIEW_LEN ? '…' : '')
          : null;

      workspaces.push({
        name: entry.name,
        path: wsPath,
        branch: meta.branch,
        dirty: meta.dirty,
        remote_url: remoteUrl || null,
        plan_preview,
      });
    }

    return { workspaces };
  },

  async create_workspace(params) {
    const name = params.name as string;
    const gitUrl = params.git_url as string | undefined;
    const branch = (params.branch as string) || 'main';

    // Validate name strictly
    const wsError = validateWorkspaceName(name);
    if (wsError) {
      throw new Error(wsError);
    }

    const wsPath = join(workspacesDir, name);

    try {
      await fs.access(wsPath);
      throw new Error(
        `Workspace "${name}" already exists. Call list_workspaces to see existing workspaces; use get_workspaces("${name}") to continue in it.`,
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes('already exists')) throw e;
      // ENOENT: does not exist, proceed
    }

    if (gitUrl) {
      // Clone from remote (without submodules; submodules are updated in background)
      if (gitUrl.startsWith('-')) {
        throw new Error('Git URL cannot start with -');
      }

      if (branch.startsWith('-')) {
        throw new Error('Branch name cannot start with -');
      }

      await spawnWithTimeout(
        'git',
        ['clone', '--branch', branch, gitUrl, wsPath],
        { timeout: 120000 },
      );

      // If repo has submodules, update them in background
      const gitmodulesPath = join(wsPath, '.gitmodules');
      try {
        await fs.access(gitmodulesPath);
        await writeSubmodulesStatus(name, { status: 'updating', message: '' });
        const child = spawn('git', ['submodule', 'update', '--init', '--recursive'], {
          cwd: wsPath,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on('exit', (code, signal) => {
          if (code === 0) {
            writeSubmodulesStatus(name, { status: 'done', message: '' }).catch(() => {});
          } else {
            const msg = stderr.trim() || `exit ${code ?? signal}`;
            writeSubmodulesStatus(name, { status: 'error', message: msg }).catch(() => {});
          }
        });
        child.on('error', (err) => {
          writeSubmodulesStatus(name, { status: 'error', message: err.message }).catch(() => {});
        });
      } catch {
        // No .gitmodules
      }
    } else {
      // Create empty repo
      await fs.mkdir(wsPath, { recursive: true });
      const { name: gitName, email: gitEmail } = await getDefaultGitIdentity();

      if (branch.startsWith('-')) {
        throw new Error('Branch name cannot start with -');
      }

      await execFile('git', ['init', '-b', branch], { cwd: wsPath });
      await execFile('git', ['config', 'user.email', gitEmail], { cwd: wsPath });
      await execFile('git', ['config', 'user.name', gitName], { cwd: wsPath });
    }
    await ensureDefaultGitignore(wsPath);

    const defaultConfig = params.default_workspace_config as { code_index_enabled?: boolean } | undefined;
    if (defaultConfig != null && typeof defaultConfig === 'object') {
      const workspaceConfig: WorkspaceConfig = {};
      if (typeof defaultConfig.code_index_enabled === 'boolean') {
        workspaceConfig.code_index_enabled = defaultConfig.code_index_enabled;
      }
      if (Object.keys(workspaceConfig).length > 0) {
        await writeWorkspaceConfig(name, workspaceConfig);
      }
    }

    if (await isCodeIndexEnabledForWorkspace(name)) {
      getCodeIndexer().indexWorkspace(wsPath).catch((err) => {
        console.error(`Code indexing failed for ${name}:`, (err as Error).message);
      });
    }

    const meta = await getGitMetadata(name);
    let remoteUrl = '';
    try {
      const { stdout } = await execFile('git', ['remote', 'get-url', 'origin'], {
        cwd: wsPath,
        timeout: 5000,
      });
      remoteUrl = stdout.trim();
    } catch {
      // No remote
    }
    return {
      name,
      path: wsPath,
      ...meta,
      remote_url: remoteUrl || null,
    };
  },

  async delete_workspace(params) {
    const name = params.name as string;
    const confirm = params.confirm as boolean;

    if (!confirm) {
      throw new Error('Must pass confirm: true to delete a workspace');
    }

    if (name === 'default') {
      throw new Error('Cannot delete the default workspace');
    }

    const wsPath = resolveWorkspacePath(name);
    try {
      await fs.access(wsPath);
    } catch {
      throw new Error(`Workspace "${name}" does not exist`);
    }

    await fs.rm(wsPath, { recursive: true, force: true });
    return { deleted: name };
  },

  async get_workspaces(params) {
    const workspace = (params.workspace as string) || 'default';
    const summaryOnly = (params.summary_only as boolean) === true;
    const wsPath = resolveWorkspacePath(workspace);

    try {
      await fs.access(wsPath);
    } catch {
      throw new Error(`Workspace "${workspace}" does not exist`);
    }

    const meta = await getGitMetadata(workspace);

    // Get detailed git status
    let statusOutput = '';
    let aheadBehind = '';
    let remoteUrl = '';

    try {
      const { stdout } = await execFile('git', ['status', '--porcelain'], {
        cwd: wsPath, timeout: 5000,
      });
      statusOutput = stdout.trim();
    } catch { /* not a git repo */ }

    try {
      const { stdout } = await execFile('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], {
        cwd: wsPath, timeout: 5000,
      });
      aheadBehind = stdout.trim();
    } catch { /* no upstream */ }

    try {
      const { stdout } = await execFile('git', ['remote', 'get-url', 'origin'], {
        cwd: wsPath, timeout: 5000,
      });
      remoteUrl = stdout.trim();
    } catch { /* no remote */ }

    // Parse status
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const line of statusOutput.split('\n')) {
      if (!line) continue;
      const x = line[0];
      const y = line[1];
      const file = line.slice(3);

      if (x === '?') {
        untracked.push(file);
      } else {
        if (x !== ' ' && x !== '?') staged.push(`${x} ${file}`);
        if (y !== ' ' && y !== '?') unstaged.push(`${y} ${file}`);
      }
    }

    // Parse ahead/behind
    let ahead = 0;
    let behind = 0;
    if (aheadBehind) {
      const parts = aheadBehind.split('\t');
      ahead = parseInt(parts[0] || '0', 10);
      behind = parseInt(parts[1] || '0', 10);
    }

    const { plan, tasks } = await readPlanData(workspace);
    const instructions = await readInstructionsFile(workspace);

    const capped = capAndCollapseStatusLists(staged, unstaged, untracked);
    const config = await readWorkspaceConfig(workspace);

    // Submodules status
    const submodulesStatusFile = await readSubmodulesStatus(workspace);
    let hasGitmodules = false;
    try {
      await fs.access(join(wsPath, '.gitmodules'));
      hasGitmodules = true;
    } catch { /* no .gitmodules */ }
    const submodules =
      submodulesStatusFile ??
      (hasGitmodules
        ? ({ status: 'idle' as const, message: '' } satisfies SubmodulesStatus)
        : ({ status: 'none' as const, message: '' } satisfies SubmodulesStatus));

    // Code index status (enabled + index state when enabled)
    const codeIndexEnabled = await isCodeIndexEnabledForWorkspace(workspace);
    const indexer = getCodeIndexer();
    let codeIndexState = indexer.getIndexStatus(wsPath);
    const hasIndexData = await indexer.hasIndex(wsPath);
    if (
      hasIndexData &&
      codeIndexState.status === 'standby' &&
      codeIndexState.files_total === 0 &&
      codeIndexState.files_processed === 0
    ) {
      const stats = await indexer.getIndexStats(wsPath);
      if (stats) {
        codeIndexState = {
          status: 'indexed',
          message: 'Index complete',
          files_processed: stats.fileCount,
          files_total: stats.fileCount,
        };
      }
    }
    const code_index = codeIndexEnabled
      ? { enabled: true as const, ...codeIndexState, has_index: hasIndexData }
      : { enabled: false as const };

    if (summaryOnly) {
      const normalized = plan != null && plan.length > 0 ? plan.replace(/\s+/g, ' ').trim() : '';
      const plan_summary =
        normalized.length > 0
          ? normalized.slice(0, LIST_WORKSPACES_PLAN_PREVIEW_LEN) +
            (normalized.length > LIST_WORKSPACES_PLAN_PREVIEW_LEN ? '…' : '')
          : null;
      const task_counts = {
        done: tasks.filter((t) => t.status === 'done').length,
        in_progress: tasks.filter((t) => t.status === 'in_progress').length,
        pending: tasks.filter((t) => t.status === 'pending').length,
        cancelled: tasks.filter((t) => t.status === 'cancelled').length,
      };
      return {
        workspace,
        branch: meta.branch,
        dirty: meta.dirty,
        remote_url: remoteUrl || null,
        staged: capped.staged,
        unstaged: capped.unstaged,
        untracked: capped.untracked,
        staged_count: capped.staged_count,
        unstaged_count: capped.unstaged_count,
        untracked_count: capped.untracked_count,
        truncated: capped.truncated,
        ahead,
        behind,
        plan_summary,
        task_counts,
        instructions: instructions ?? null,
        config,
        submodules,
        code_index,
      };
    }

    return {
      workspace,
      branch: meta.branch,
      dirty: meta.dirty,
      remote_url: remoteUrl || null,
      staged: capped.staged,
      unstaged: capped.unstaged,
      untracked: capped.untracked,
      staged_count: capped.staged_count,
      unstaged_count: capped.unstaged_count,
      untracked_count: capped.untracked_count,
      truncated: capped.truncated,
      ahead,
      behind,
      plan,
      tasks,
      instructions: instructions ?? null,
      config,
      submodules,
      code_index,
    };
  },

  async update_workspace(params) {
    const workspace = (params.workspace as string) || 'default';
    const wsPath = resolveWorkspacePath(workspace);

    try {
      await fs.access(wsPath);
    } catch {
      throw new Error(`Workspace "${workspace}" does not exist`);
    }

    const result: Record<string, unknown> = {};

    // --- Config updates (first, so reindex sees new state) ---
    const codeIndexEnabled = params.code_index_enabled as boolean | undefined;
    if (codeIndexEnabled !== undefined) {
      const current = await readWorkspaceConfig(workspace);
      const next: WorkspaceConfig = { ...current, code_index_enabled: codeIndexEnabled };
      await writeWorkspaceConfig(workspace, next);
      result.config = next;
    }

    // --- Plan/tasks updates ---
    const planProvided = params.plan !== undefined && params.plan !== null;
    const tasksProvided = params.tasks !== undefined && Array.isArray(params.tasks);
    const taskUpdates = params.task_updates as Array<{ index: number; status: string }> | undefined;
    const hasTaskUpdates = taskUpdates != null && taskUpdates.length > 0;

    if (planProvided || tasksProvided || hasTaskUpdates) {
      const current = await readPlanData(workspace);
      const nextPlan = planProvided ? (params.plan as string) : current.plan;
      let nextTasks: PlanTask[];
      if (hasTaskUpdates) {
        nextTasks = applyTaskUpdates(current.tasks, taskUpdates);
      } else if (tasksProvided) {
        nextTasks = (params.tasks as PlanTask[]).map((t): PlanTask => ({
          title: String(t.title),
          status: isTaskStatus(t.status) ? t.status : 'pending',
        }));
      } else {
        nextTasks = current.tasks;
      }
      const data: PlanData = { plan: nextPlan, tasks: nextTasks };
      await writePlanData(workspace, data);
      result.plan = data.plan;
      result.tasks = data.tasks;
    }

    // --- Reindex action ---
    if (params.reindex === true) {
      if (!(await isCodeIndexEnabledForWorkspace(workspace))) {
        result.reindex = { status: 'skipped', message: 'Code index is disabled for this workspace' };
      } else {
        const state = await getCodeIndexer().indexWorkspace(wsPath, { force: true });
        result.reindex = state;
      }
    }

    // If nothing was updated, return current state
    if (Object.keys(result).length === 0) {
      const config = await readWorkspaceConfig(workspace);
      const { plan, tasks } = await readPlanData(workspace);
      return { config, plan, tasks };
    }

    return result;
  },

  async clean_workspace_uploads(params) {
    const workspace = (params.workspace as string) || 'default';
    const olderThanDays = typeof params.olderThanDays === 'number' ? params.olderThanDays : 7;
    const uploadsDir = join(workspacesDir, workspace, 'uploads');
    try {
      await fs.access(uploadsDir);
    } catch {
      return { deleted: 0 };
    }
    return { deleted: await purgeUploadsByAge(uploadsDir, olderThanDays) };
  },

  // Code Index ─────────────────────────────────────────────────────────────────

  async index_workspace_code(params) {
    const workspace = (params.workspace as string) || 'default';
    const force = params.force === true;
    const wsPath = resolveWorkspacePath(workspace);
    try {
      await fs.access(wsPath);
    } catch {
      throw new Error(`Workspace "${workspace}" does not exist`);
    }
    if (!(await isCodeIndexEnabledForWorkspace(workspace))) {
      return {
        status: 'standby',
        message: 'Code index disabled (global or workspace config)',
        files_processed: 0,
        files_total: 0,
      };
    }
    const state = await getCodeIndexer().indexWorkspace(wsPath, { force });
    return state;
  },

  async codebase_search(params) {
    const workspace = (params.workspace as string) || 'default';
    const query = (params.query as string) || '';
    const pathPrefix = params.path as string | undefined;
    const limit = typeof params.limit === 'number' ? params.limit : undefined;
    const wsPath = resolveWorkspacePath(workspace);
    try {
      await fs.access(wsPath);
    } catch {
      throw new Error(`Workspace "${workspace}" does not exist`);
    }
    if (!query.trim()) {
      return { results: [] };
    }
    const indexer = getCodeIndexer();
    if ((await isCodeIndexEnabledForWorkspace(workspace)) && !(await indexer.hasIndex(wsPath))) {
      indexer.indexWorkspace(wsPath).catch((err) => {
        console.error(`Code indexing failed for ${workspace}:`, (err as Error).message);
      });
      return {
        results: [],
        message:
          'No index yet. Indexing has been started. Use get_workspaces to check code_index.status and retry codebase_search when status is indexed.',
      };
    }
    const results = await indexer.searchWorkspace(wsPath, query.trim(), {
      pathPrefix: pathPrefix?.trim() || undefined,
      limit,
    });
    return { results };
  },

  async debug_code_index_list_chunks(params) {
    const workspace = (params.workspace as string) || 'default';
    const pathFilter = (params.path as string) || '';
    const limitParam = typeof params.limit === 'number' ? params.limit : undefined;
    const limit = limitParam && limitParam > 0 && limitParam <= 200 ? limitParam : 50;
    if (!pathFilter.trim()) {
      return { chunk_count: 0, chunks: [], index_status: 'none' };
    }
    const wsPath = resolveWorkspacePath(workspace);
    try {
      await fs.access(wsPath);
    } catch {
      throw new Error(`Workspace "${workspace}" does not exist`);
    }
    const chunks = await getCodeIndexer().listChunksInIndex(wsPath, pathFilter, limit);
    const indexStatus = chunks.length > 0 ? 'indexed' : 'none';
    return {
      chunk_count: chunks.length,
      chunks,
      index_status: indexStatus,
    };
  },

  async debug_code_index_rechunk_file(params) {
    const workspace = (params.workspace as string) || 'default';
    const relPath = (params.path as string) || '';
    const limitParam = typeof params.limit === 'number' ? params.limit : undefined;
    const limit = limitParam && limitParam > 0 && limitParam <= 200 ? limitParam : 50;
    if (!relPath.trim()) {
      return { chunk_count: 0, chunks: [] };
    }
    const wsPath = resolveWorkspacePath(workspace);
    try {
      await fs.access(wsPath);
    } catch {
      throw new Error(`Workspace "${workspace}" does not exist`);
    }
    const chunks = await getCodeIndexer().rechunkFileForDebug(wsPath, relPath, limit);
    return {
      chunk_count: chunks.length,
      chunks,
    };
  },

  async clean_all_workspace_uploads(params) {
    const olderThanDays = typeof params.olderThanDays === 'number' ? params.olderThanDays : 7;
    let totalDeleted = 0;
    let entries;
    try {
      entries = await fs.readdir(workspacesDir, { withFileTypes: true });
    } catch {
      return { deleted: 0 };
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (validateWorkspaceName(entry.name)) continue;
      const uploadsDir = join(workspacesDir, entry.name, 'uploads');
      try {
        await fs.access(uploadsDir);
      } catch {
        continue;
      }
      totalDeleted += await purgeUploadsByAge(uploadsDir, olderThanDays);
    }
    return { deleted: totalDeleted };
  },

  // Account Tools ─────────────────────────────────────────────────────────────

  async get_system_runtimes() {
    const runtimes: Record<string, string> = {};

    const checks: Array<[string, string, string[]]> = [
      ['node', 'node', ['--version']],
      ['npm', 'npm', ['--version']],
      ['python3', 'python3', ['--version']],
      ['pip3', 'pip3', ['--version']],
      ['git', 'git', ['--version']],
      ['bash', 'bash', ['--version']],
      ['rg', 'rg', ['--version']],
    ];

    const results = await Promise.allSettled(
      checks.map(async ([name, cmd, args]) => {
        const { stdout } = await execFile(cmd, args, { timeout: 5000 });
        // Take first line only (equivalent to `| head -1` for bash/rg)
        const firstLine = stdout.trim().split('\n')[0] || '';
        return [name, firstLine] as [string, string];
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const [name, version] = result.value;
        runtimes[name] = version;
      }
    }
    // Fill in missing with 'not installed'
    for (const [name] of checks) {
      if (!(name in runtimes)) {
        runtimes[name] = 'not installed';
      }
    }

    return { runtimes };
  },
};

// ── IPC Server ───────────────────────────────────────────────────────────────

/**
 * Handles a single client connection (one request-response per connection)
 */
function handleConnection(socket: Socket): void {
  let data = '';

  socket.on('data', (chunk: Buffer) => {
    data += chunk.toString();

    // Try to parse complete JSON (newline-delimited)
    const lines = data.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const request = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
        processRequest(request).then(
          (result) => {
            const response = JSON.stringify({ id: request.id, result }) + '\n';
            socket.write(response);
          },
          (error) => {
            const response = JSON.stringify({
              id: request.id,
              error: error instanceof Error ? error.message : String(error),
            }) + '\n';
            socket.write(response);
          },
        );
      } catch {
        // Incomplete JSON, wait for more data
      }
    }
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
  });
}

async function processRequest(request: { id: string; method: string; params: Record<string, unknown> }): Promise<unknown> {
  const handler = handlers[request.method];
  if (!handler) {
    throw new Error(`Unknown method: ${request.method}`);
  }
  return handler(request.params);
}

/**
 * Starts the IPC server
 */
async function startServer(): Promise<void> {
  const socketDir = dirname(socketPath);
  await fs.mkdir(socketDir, { recursive: true });

  // Clean up stale socket
  try { await fs.unlink(socketPath); } catch { /* ignore */ }

  const server = createServer(handleConnection);

  server.listen(socketPath, () => {
    console.log(`Worker listening on ${socketPath}`);
  });

  server.on('error', (err) => {
    console.error('Server error:', err.message);
    process.exit(1);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Worker shutting down...');
    // Kill all terminal sessions
    for (const [id, session] of terminals) {
      try { session.pty.kill(); } catch { /* ignore */ }
    }
    terminals.clear();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Ensure workspaces directory exists
  await fs.mkdir(workspacesDir, { recursive: true });
  await startServer();
}

main().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
