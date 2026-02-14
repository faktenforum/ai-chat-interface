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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getDefaultGitIdentity } from './utils/git-config.ts';
import { validateWorkspaceName, validateTerminalId } from './utils/security.ts';
import {
  type PlanTask,
  isTaskStatus,
  taskStatusFrom,
  PLAN_DIR,
  PLAN_FILENAME,
  LIST_WORKSPACES_PLAN_PREVIEW_LEN,
} from './workspace-plan.ts';

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

  if (!existsSync(cwd)) {
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

function getPlanPath(workspace: string): string {
  const wsPath = resolveWorkspacePath(workspace);
  return join(wsPath, PLAN_DIR, PLAN_FILENAME);
}

function readPlanFile(workspace: string): PlanData {
  const path = getPlanPath(workspace);
  if (!existsSync(path)) {
    return { plan: null, tasks: [] };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      const plan = typeof obj.plan === 'string' ? obj.plan : obj.plan === null ? null : null;
      const tasks = Array.isArray(obj.tasks)
        ? (obj.tasks as unknown[])
            .filter(
              (t): t is Record<string, unknown> =>
                t != null && typeof t === 'object' && typeof (t as Record<string, unknown>).title === 'string',
            )
            .map((t): PlanTask => {
              const title = String(t.title);
              const status = taskStatusFrom(t.status, t.done === true);
              return { title, status };
            })
        : [];
      return { plan, tasks };
    }
  } catch {
    /* parse or read error */
  }
  return { plan: null, tasks: [] };
}

function writePlanFile(workspace: string, data: PlanData): void {
  const wsPath = resolveWorkspacePath(workspace);
  const dir = join(wsPath, PLAN_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PLAN_FILENAME), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Escapes a path for use inside double-quoted shell string (escape \ and ").
 */
function escapeForDoubleQuotedShell(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getGitMetadata(workspace: string): { branch: string; dirty: boolean } {
  // Validate workspace name to prevent path traversal
  const error = validateWorkspaceName(workspace);
  if (error) return { branch: 'main', dirty: false };

  const cwd = join(workspacesDir, workspace);
  let branch = 'main';
  let dirty = false;

  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim() || 'main';
  } catch {
    // Not a git repo or no commits
  }

  try {
    const status = execSync('git status --porcelain 2>/dev/null', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    dirty = status.length > 0;
  } catch {
    // Not a git repo
  }

  return { branch, dirty };
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
      if (existsSync(cwdFile)) {
        cwd = readFileSync(cwdFile, 'utf-8').trim() || workspaceRoot;
        unlinkSync(cwdFile);
      }
    } catch {
      // Keep workspaceRoot as fallback
    }

    const cwdRelative =
      cwd === workspaceRoot ? '' : relative(workspaceRoot, cwd).replace(/^\//, '') || '';

    const meta = getGitMetadata(workspace);

    return {
      terminal_id: terminalId,
      output: newOutput,
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
    const meta = getGitMetadata(session.workspace);

    return {
      terminal_id: terminalId,
      output: slice,
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
    const meta = getGitMetadata(session.workspace);

    return {
      terminal_id: terminalId,
      output: newOutput,
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
    if (!existsSync(workspacesDir)) {
      return { workspaces: [] };
    }

    const entries = readdirSync(workspacesDir, { withFileTypes: true });
    const workspaces = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const wsPath = join(workspacesDir, entry.name);
      
      // Skip invalid workspace names (e.g. hidden files)
      if (validateWorkspaceName(entry.name)) continue;

      const meta = getGitMetadata(entry.name);

      let remoteUrl = '';
      try {
        remoteUrl = execSync('git remote get-url origin 2>/dev/null', {
          cwd: wsPath,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();
      } catch {
        // No remote
      }

      const { plan } = readPlanFile(entry.name);
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

    if (existsSync(wsPath)) {
      throw new Error(`Workspace "${name}" already exists`);
    }

    if (gitUrl) {
      // Clone from remote
      if (gitUrl.startsWith('-')) {
        throw new Error('Git URL cannot start with -');
      }

      if (branch.startsWith('-')) {
        throw new Error('Branch name cannot start with -');
      }

      const result = spawnSync('git', ['clone', '--branch', branch, gitUrl, wsPath], {
        stdio: 'pipe',
        timeout: 120000,
        encoding: 'utf-8',
      });
      if (result.status !== 0) {
        throw new Error(`Git clone failed: ${result.stderr}`);
      }
    } else {
      // Create empty repo
      mkdirSync(wsPath, { recursive: true });
      const { name: gitName, email: gitEmail } = getDefaultGitIdentity();
      
      if (branch.startsWith('-')) {
        throw new Error('Branch name cannot start with -');
      }

      // Use spawnSync for safety instead of execSync with shell string
      spawnSync('git', ['init', '-b', branch], { cwd: wsPath, stdio: 'ignore' });
      spawnSync('git', ['config', 'user.email', gitEmail], { cwd: wsPath, stdio: 'ignore' });
      spawnSync('git', ['config', 'user.name', gitName], { cwd: wsPath, stdio: 'ignore' });
    }

    const meta = getGitMetadata(name);
    return {
      name,
      path: wsPath,
      ...meta,
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
    if (!existsSync(wsPath)) {
      throw new Error(`Workspace "${name}" does not exist`);
    }

    rmSync(wsPath, { recursive: true, force: true });
    return { deleted: name };
  },

  async get_workspace_status(params) {
    const workspace = (params.workspace as string) || 'default';
    const wsPath = resolveWorkspacePath(workspace);

    if (!existsSync(wsPath)) {
      throw new Error(`Workspace "${workspace}" does not exist`);
    }

    const meta = getGitMetadata(workspace);

    // Get detailed git status
    let statusOutput = '';
    let aheadBehind = '';
    let remoteUrl = '';

    try {
      statusOutput = execSync('git status --porcelain 2>/dev/null', {
        cwd: wsPath, encoding: 'utf-8', timeout: 5000,
      }).trim();
    } catch { /* not a git repo */ }

    try {
      aheadBehind = execSync('git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null', {
        cwd: wsPath, encoding: 'utf-8', timeout: 5000,
      }).trim();
    } catch { /* no upstream */ }

    try {
      remoteUrl = execSync('git remote get-url origin 2>/dev/null', {
        cwd: wsPath, encoding: 'utf-8', timeout: 5000,
      }).trim();
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

    const { plan, tasks } = readPlanFile(workspace);

    return {
      workspace,
      branch: meta.branch,
      dirty: meta.dirty,
      remote_url: remoteUrl || null,
      staged,
      unstaged,
      untracked,
      ahead,
      behind,
      plan,
      tasks,
    };
  },

  async set_workspace_plan(params) {
    const workspace = (params.workspace as string) || 'default';
    const wsPath = resolveWorkspacePath(workspace);

    if (!existsSync(wsPath)) {
      throw new Error(`Workspace "${workspace}" does not exist`);
    }

    const current = readPlanFile(workspace);
    const planProvided = params.plan !== undefined && params.plan !== null;
    const tasksProvided = params.tasks !== undefined && Array.isArray(params.tasks);

    const nextPlan = planProvided ? (params.plan as string) : current.plan;
    const nextTasks = tasksProvided
      ? (params.tasks as PlanTask[]).map((t): PlanTask => ({
          title: String(t.title),
          status: isTaskStatus(t.status) ? t.status : 'pending',
        }))
      : current.tasks;

    const data: PlanData = { plan: nextPlan, tasks: nextTasks };
    writePlanFile(workspace, data);

    return { plan: data.plan, tasks: data.tasks };
  },

  // Account Tools ─────────────────────────────────────────────────────────────

  async get_system_runtimes() {
    const runtimes: Record<string, string> = {};

    const checks: Array<[string, string]> = [
      ['node', 'node --version'],
      ['npm', 'npm --version'],
      ['python3', 'python3 --version'],
      ['pip3', 'pip3 --version'],
      ['git', 'git --version'],
      ['bash', 'bash --version | head -1'],
      ['rg', 'rg --version | head -1'],
    ];

    for (const [name, cmd] of checks) {
      try {
        runtimes[name] = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
      } catch {
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
function startServer(): void {
  const socketDir = dirname(socketPath);
  mkdirSync(socketDir, { recursive: true });

  // Clean up stale socket
  if (existsSync(socketPath)) {
    try { unlinkSync(socketPath); } catch { /* ignore */ }
  }

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

// Ensure workspaces directory exists
mkdirSync(workspacesDir, { recursive: true });

startServer();
