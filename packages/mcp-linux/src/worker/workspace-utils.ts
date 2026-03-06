/**
 * Workspace path resolution, plan/config I/O, and file utilities.
 */

import fs from 'node:fs/promises';
import { join } from 'node:path';
import { validateWorkspaceName } from '../utils/security.ts';
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
} from '../workspace-plan.ts';
import type { PlanData, WorkerContext } from './types.ts';

// ── Path resolution ──────────────────────────────────────────────────────────

export function resolveWorkspacePath(workspacesDir: string, workspace: string): string {
  const error = validateWorkspaceName(workspace);
  if (error) {
    throw new Error(error);
  }
  return join(workspacesDir, workspace);
}

export function getPlanDir(workspacesDir: string, workspace: string): string {
  return join(resolveWorkspacePath(workspacesDir, workspace), PLAN_DIR);
}

// ── Plan/Task I/O ────────────────────────────────────────────────────────────

export async function readPlanData(workspacesDir: string, workspace: string): Promise<PlanData> {
  const dir = getPlanDir(workspacesDir, workspace);
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

export async function readInstructionsFile(workspacesDir: string, workspace: string): Promise<string | null> {
  const path = join(resolveWorkspacePath(workspacesDir, workspace), AGENTS_MD_FILENAME);
  try {
    const raw = (await fs.readFile(path, 'utf-8')).trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export async function writePlanData(workspacesDir: string, workspace: string, data: PlanData): Promise<void> {
  const dir = getPlanDir(workspacesDir, workspace);
  await fs.mkdir(dir, { recursive: true });

  const planPath = join(dir, PLAN_MD_FILENAME);
  if (data.plan != null && data.plan.length > 0) {
    await fs.writeFile(planPath, data.plan, 'utf-8');
  } else {
    try { await fs.unlink(planPath); } catch { /* ignore */ }
  }

  await fs.writeFile(join(dir, TASKS_FILENAME), JSON.stringify({ tasks: data.tasks }, null, 2), 'utf-8');
}

// ── Workspace Config I/O ─────────────────────────────────────────────────────

export async function readWorkspaceConfig(workspacesDir: string, workspace: string): Promise<WorkspaceConfig> {
  const path = join(getPlanDir(workspacesDir, workspace), CONFIG_FILENAME);
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

export async function writeWorkspaceConfig(workspacesDir: string, workspace: string, config: WorkspaceConfig): Promise<void> {
  const dir = getPlanDir(workspacesDir, workspace);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, CONFIG_FILENAME), JSON.stringify(config, null, 2), 'utf-8');
}

// ── Submodules Status I/O ────────────────────────────────────────────────────

export async function readSubmodulesStatus(workspacesDir: string, workspace: string): Promise<SubmodulesStatus | null> {
  const path = join(getPlanDir(workspacesDir, workspace), SUBMODULES_STATUS_FILENAME);
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

export async function writeSubmodulesStatus(workspacesDir: string, workspace: string, data: SubmodulesStatus): Promise<void> {
  const dir = getPlanDir(workspacesDir, workspace);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, SUBMODULES_STATUS_FILENAME),
    JSON.stringify(data, null, 0),
    'utf-8',
  );
}

// ── Code Index Helper ────────────────────────────────────────────────────────

/** True if code index is enabled globally and not disabled for this workspace via config.json. */
export async function isCodeIndexEnabledForWorkspace(ctx: WorkerContext, workspace: string): Promise<boolean> {
  if (!ctx.getCodeIndexer().isEnabled()) return false;
  const config = await readWorkspaceConfig(ctx.workspacesDir, workspace);
  return config.code_index_enabled !== false;
}

// ── Task Updates ─────────────────────────────────────────────────────────────

export function applyTaskUpdates(
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

// ── Git Ignore ───────────────────────────────────────────────────────────────

const DEFAULT_GITIGNORE = 'uploads/\nvenv/\n.venv/\n';

export async function ensureDefaultGitignore(wsPath: string): Promise<void> {
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

// ── Status List Capping ──────────────────────────────────────────────────────

const DEFAULT_STATUS_MAX_FILES = 50;
const DEFAULT_STATUS_COLLAPSE_DIRS = 'uploads,venv,.venv';

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
 */
export function capAndCollapseStatusLists(
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

// ── Upload Purge ─────────────────────────────────────────────────────────────

/**
 * Deletes files in uploadsDir older than olderThanDays (0 = delete all).
 * Removes empty subdirs. Returns number of files deleted.
 */
export async function purgeUploadsByAge(uploadsDir: string, olderThanDays: number): Promise<number> {
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
