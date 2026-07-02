/**
 * Workspace handler - CRUD operations and account tools.
 */

import { execFile as execFileCb, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { validateWorkspaceName } from '../utils/security.ts';
import { getDefaultGitIdentity } from '../utils/git-config.ts';
import { type SubmodulesStatus } from '../workspace-plan.ts';
import { getGitMetadata, spawnWithTimeout } from './git-utils.ts';
import { GIT_TIMEOUT_MS, CLONE_TIMEOUT_MS } from './constants.ts';
import {
  resolveWorkspacePath,
  readInstructionsFile,
  readSubmodulesStatus,
  writeSubmodulesStatus,
  ensureDefaultGitignore,
  capAndCollapseStatusLists,
  purgeUploadsByAge,
} from './workspace-utils.ts';
import type { Handler, WorkerContext } from './types.ts';

const execFile = promisify(execFileCb);

export function createWorkspaceHandlers(ctx: WorkerContext): Record<string, Handler> {
  return {

    async list_workspaces() {
      let entries;
      try {
        entries = await fs.readdir(ctx.workspacesDir, { withFileTypes: true });
      } catch {
        return { workspaces: [] };
      }

      const workspaces = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const wsPath = join(ctx.workspacesDir, entry.name);

        // Skip invalid workspace names (e.g. hidden files)
        if (validateWorkspaceName(entry.name)) continue;

        const meta = await getGitMetadata(ctx.workspacesDir, entry.name);

        let remoteUrl = '';
        try {
          const { stdout } = await execFile('git', ['remote', 'get-url', 'origin'], {
            cwd: wsPath,
            timeout: GIT_TIMEOUT_MS,
          });
          remoteUrl = stdout.trim();
        } catch {
          // No remote
        }

        workspaces.push({
          name: entry.name,
          path: wsPath,
          branch: meta.branch,
          dirty: meta.dirty,
          remote_url: remoteUrl || null,
        });
      }

      return { workspaces };
    },

    async create_workspace(params) {
      const name = params.name as string;
      const gitUrl = params.git_url as string | undefined;
      const branch = (params.branch as string) || 'main';

      const wsError = validateWorkspaceName(name);
      if (wsError) {
        throw new Error(wsError);
      }

      const wsPath = join(ctx.workspacesDir, name);

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
        if (gitUrl.startsWith('-')) {
          throw new Error('Git URL cannot start with -');
        }

        if (branch.startsWith('-')) {
          throw new Error('Branch name cannot start with -');
        }

        await spawnWithTimeout(
          'git',
          ['clone', '--branch', branch, gitUrl, wsPath],
          { timeout: CLONE_TIMEOUT_MS },
        );

        // If repo has submodules, update them in background
        const gitmodulesPath = join(wsPath, '.gitmodules');
        try {
          await fs.access(gitmodulesPath);
          await writeSubmodulesStatus(ctx.workspacesDir, name, { status: 'updating', message: '' });
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
              writeSubmodulesStatus(ctx.workspacesDir, name, { status: 'done', message: '' }).catch(() => {});
            } else {
              const msg = stderr.trim() || `exit ${code ?? signal}`;
              writeSubmodulesStatus(ctx.workspacesDir, name, { status: 'error', message: msg }).catch(() => {});
            }
          });
          child.on('error', (err) => {
            writeSubmodulesStatus(ctx.workspacesDir, name, { status: 'error', message: err.message }).catch(() => {});
          });
        } catch {
          // No .gitmodules
        }
      } else {
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

      const meta = await getGitMetadata(ctx.workspacesDir, name);
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

      const wsPath = resolveWorkspacePath(ctx.workspacesDir, name);
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
      const wsPath = resolveWorkspacePath(ctx.workspacesDir, workspace);

      try {
        await fs.access(wsPath);
      } catch {
        throw new Error(`Workspace "${workspace}" does not exist`);
      }

      const meta = await getGitMetadata(ctx.workspacesDir, workspace);

      // Get detailed git status
      let statusOutput = '';
      let aheadBehind = '';
      let remoteUrl = '';

      try {
        const { stdout } = await execFile('git', ['status', '--porcelain'], {
          cwd: wsPath, timeout: GIT_TIMEOUT_MS,
        });
        statusOutput = stdout.trim();
      } catch { /* not a git repo */ }

      try {
        const { stdout } = await execFile('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], {
          cwd: wsPath, timeout: GIT_TIMEOUT_MS,
        });
        aheadBehind = stdout.trim();
      } catch { /* no upstream */ }

      try {
        const { stdout } = await execFile('git', ['remote', 'get-url', 'origin'], {
          cwd: wsPath, timeout: GIT_TIMEOUT_MS,
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

      const instructions = await readInstructionsFile(ctx.workspacesDir, workspace);

      const capped = capAndCollapseStatusLists(staged, unstaged, untracked);

      // Submodules status
      const submodulesStatusFile = await readSubmodulesStatus(ctx.workspacesDir, workspace);
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
        instructions: instructions ?? null,
        submodules,
      };
    },

    async clean_workspace_uploads(params) {
      const workspace = (params.workspace as string) || 'default';
      const olderThanDays = typeof params.olderThanDays === 'number' ? params.olderThanDays : 7;
      const uploadsDir = join(ctx.workspacesDir, workspace, 'uploads');
      try {
        await fs.access(uploadsDir);
      } catch {
        return { deleted: 0 };
      }
      return { deleted: await purgeUploadsByAge(uploadsDir, olderThanDays) };
    },

    async clean_all_workspace_uploads(params) {
      const olderThanDays = typeof params.olderThanDays === 'number' ? params.olderThanDays : 7;
      let totalDeleted = 0;
      let entries;
      try {
        entries = await fs.readdir(ctx.workspacesDir, { withFileTypes: true });
      } catch {
        return { deleted: 0 };
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (validateWorkspaceName(entry.name)) continue;
        const uploadsDir = join(ctx.workspacesDir, entry.name, 'uploads');
        try {
          await fs.access(uploadsDir);
        } catch {
          continue;
        }
        totalDeleted += await purgeUploadsByAge(uploadsDir, olderThanDays);
      }
      return { deleted: totalDeleted };
    },

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
      for (const [name] of checks) {
        if (!(name in runtimes)) {
          runtimes[name] = 'not installed';
        }
      }

      return { runtimes };
    },
  };
}
