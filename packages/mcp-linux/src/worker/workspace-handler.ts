/**
 * Workspace handler - CRUD operations, plan/task management, and account tools.
 */

import { execFile as execFileCb, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { validateWorkspaceName } from '../utils/security.ts';
import { getDefaultGitIdentity } from '../utils/git-config.ts';
import {
  type PlanTask,
  type WorkspaceConfig,
  type SubmodulesStatus,
  isTaskStatus,
  LIST_WORKSPACES_PLAN_PREVIEW_LEN,
} from '../workspace-plan.ts';
import { getGitMetadata, spawnWithTimeout } from './git-utils.ts';
import { GIT_TIMEOUT_MS, CLONE_TIMEOUT_MS } from './constants.ts';
import {
  resolveWorkspacePath,
  readPlanData,
  readInstructionsFile,
  writePlanData,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  readSubmodulesStatus,
  writeSubmodulesStatus,
  isCodeIndexEnabledForWorkspace,
  applyTaskUpdates,
  ensureDefaultGitignore,
  capAndCollapseStatusLists,
  purgeUploadsByAge,
} from './workspace-utils.ts';
import type { PlanData, Handler, WorkerContext } from './types.ts';

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

        const { plan } = await readPlanData(ctx.workspacesDir, entry.name);
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

      const defaultConfig = params.default_workspace_config as { code_index_enabled?: boolean } | undefined;
      if (defaultConfig != null && typeof defaultConfig === 'object') {
        const workspaceConfig: WorkspaceConfig = {};
        if (typeof defaultConfig.code_index_enabled === 'boolean') {
          workspaceConfig.code_index_enabled = defaultConfig.code_index_enabled;
        }
        if (Object.keys(workspaceConfig).length > 0) {
          await writeWorkspaceConfig(ctx.workspacesDir, name, workspaceConfig);
        }
      }

      if (await isCodeIndexEnabledForWorkspace(ctx, name)) {
        ctx.getCodeIndexer().indexWorkspace(wsPath).catch((err) => {
          console.error(`Code indexing failed for ${name}:`, (err as Error).message);
        });
      }

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
      const summaryOnly = (params.summary_only as boolean) === true;
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

      const { plan, tasks } = await readPlanData(ctx.workspacesDir, workspace);
      const instructions = await readInstructionsFile(ctx.workspacesDir, workspace);

      const capped = capAndCollapseStatusLists(staged, unstaged, untracked);
      const config = await readWorkspaceConfig(ctx.workspacesDir, workspace);

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

      // Code index status (enabled + index state when enabled)
      const codeIndexEnabled = await isCodeIndexEnabledForWorkspace(ctx, workspace);
      const indexer = ctx.getCodeIndexer();
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
      const wsPath = resolveWorkspacePath(ctx.workspacesDir, workspace);

      try {
        await fs.access(wsPath);
      } catch {
        throw new Error(`Workspace "${workspace}" does not exist`);
      }

      const result: Record<string, unknown> = {};

      // --- Config updates (first, so reindex sees new state) ---
      const codeIndexEnabled = params.code_index_enabled as boolean | undefined;
      if (codeIndexEnabled !== undefined) {
        const current = await readWorkspaceConfig(ctx.workspacesDir, workspace);
        const next: WorkspaceConfig = { ...current, code_index_enabled: codeIndexEnabled };
        await writeWorkspaceConfig(ctx.workspacesDir, workspace, next);
        result.config = next;
      }

      // --- Plan/tasks updates ---
      const planProvided = params.plan !== undefined && params.plan !== null;
      const tasksProvided = params.tasks !== undefined && Array.isArray(params.tasks);
      const taskUpdates = params.task_updates as Array<{ index: number; status: string }> | undefined;
      const hasTaskUpdates = taskUpdates != null && taskUpdates.length > 0;

      if (planProvided || tasksProvided || hasTaskUpdates) {
        const current = await readPlanData(ctx.workspacesDir, workspace);
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
        await writePlanData(ctx.workspacesDir, workspace, data);
        result.plan = data.plan;
        result.tasks = data.tasks;
      }

      // --- Reindex action ---
      if (params.reindex === true) {
        if (!(await isCodeIndexEnabledForWorkspace(ctx, workspace))) {
          result.reindex = { status: 'skipped', message: 'Code index is disabled for this workspace' };
        } else {
          const state = await ctx.getCodeIndexer().indexWorkspace(wsPath, { force: true });
          result.reindex = state;
        }
      }

      // If nothing was updated, return current state
      if (Object.keys(result).length === 0) {
        const config = await readWorkspaceConfig(ctx.workspacesDir, workspace);
        const { plan, tasks } = await readPlanData(ctx.workspacesDir, workspace);
        return { config, plan, tasks };
      }

      return result;
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
