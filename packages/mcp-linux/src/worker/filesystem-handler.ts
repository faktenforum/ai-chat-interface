/**
 * Filesystem handler - first-class file tools that run as the workspace user.
 *
 * write_file / edit_file mutate files, so they run in the worker (as the user)
 * to keep correct ownership. grep / glob shell out to ripgrep in the workspace.
 */

import fs from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateWorkspaceName } from '../utils/security.ts';
import type { Handler, WorkerContext } from './types.ts';

const execFileAsync = promisify(execFile);

/** Resolve a workspace-relative path to an absolute path, rejecting traversal outside the workspace. */
function safeResolve(workspacesDir: string, workspace: string, relativePath: string): { root: string; abs: string } {
  const wsError = validateWorkspaceName(workspace);
  if (wsError) throw new Error(wsError);
  const root = join(workspacesDir, workspace);
  const abs = resolve(root, relativePath);
  if (abs !== root && !abs.startsWith(root + '/')) {
    throw new Error('Path traversal denied: path must be within the workspace');
  }
  return { root, abs };
}

const RG_TIMEOUT_MS = 30000;
const RG_MAX_BUFFER = 16 * 1024 * 1024;

export function createFilesystemHandlers(ctx: WorkerContext): Record<string, Handler> {
  return {
    async write_file(params) {
      const workspace = (params.workspace as string) || 'default';
      const filePath = params.file_path as string;
      const content = params.content as string;
      if (typeof filePath !== 'string' || !filePath) throw new Error('file_path is required');
      if (typeof content !== 'string') throw new Error('content is required');

      const { abs } = safeResolve(ctx.workspacesDir, workspace, filePath);
      await fs.mkdir(dirname(abs), { recursive: true });
      let existed = true;
      try {
        await fs.access(abs);
      } catch {
        existed = false;
      }
      await fs.writeFile(abs, content, 'utf-8');
      return {
        workspace,
        file_path: filePath,
        bytes_written: Buffer.byteLength(content, 'utf-8'),
        created: !existed,
      };
    },

    async edit_file(params) {
      const workspace = (params.workspace as string) || 'default';
      const filePath = params.file_path as string;
      const oldString = params.old_string as string;
      const newString = params.new_string as string;
      const replaceAll = Boolean(params.replace_all);
      if (typeof filePath !== 'string' || !filePath) throw new Error('file_path is required');
      if (typeof oldString !== 'string' || typeof newString !== 'string') {
        throw new Error('old_string and new_string are required');
      }
      if (oldString === newString) throw new Error('old_string and new_string must differ');

      const { abs } = safeResolve(ctx.workspacesDir, workspace, filePath);
      let content: string;
      try {
        content = await fs.readFile(abs, 'utf-8');
      } catch {
        throw new Error(`File not found: ${filePath}`);
      }

      const occurrences = content.split(oldString).length - 1;
      if (occurrences === 0) throw new Error('old_string not found in file');
      if (occurrences > 1 && !replaceAll) {
        throw new Error(
          `old_string is not unique (${occurrences} matches). Add surrounding context to make it unique, or set replace_all=true.`,
        );
      }

      const updated = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
      await fs.writeFile(abs, updated, 'utf-8');
      return { workspace, file_path: filePath, replacements: replaceAll ? occurrences : 1 };
    },

    async grep(params) {
      const workspace = (params.workspace as string) || 'default';
      const pattern = params.pattern as string;
      const searchPath = (params.path as string) || '.';
      const glob = params.glob as string | undefined;
      const limit = (params.limit as number) || 100;
      if (typeof pattern !== 'string' || !pattern) throw new Error('pattern is required');

      const { root, abs } = safeResolve(ctx.workspacesDir, workspace, searchPath);
      const rel = relative(root, abs);

      const args = ['--line-number', '--no-heading', '--color=never', '--max-columns=300', '-e', pattern];
      if (glob) args.push('-g', glob);
      // Always pass an explicit path so ripgrep searches the tree, never stdin.
      args.push(rel && rel !== '.' ? rel : '.');

      let stdout = '';
      try {
        const res = await execFileAsync('rg', args, { cwd: root, timeout: RG_TIMEOUT_MS, maxBuffer: RG_MAX_BUFFER });
        stdout = res.stdout;
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
        // ripgrep exits 1 when there are no matches; that is not an error.
        if (e.code === 1) return { workspace, pattern, matches: [], truncated: false };
        if (typeof e.stdout === 'string' && e.stdout) stdout = e.stdout;
        else throw new Error(`grep failed: ${e.stderr || e.message || String(err)}`);
      }

      const lines = stdout.split('\n').filter((l) => l.length > 0);
      const truncated = lines.length > limit;
      const matches = lines.slice(0, limit).map((line) => {
        const m = /^(.*?):(\d+):(.*)$/.exec(line);
        if (!m) return { file: null, line: null, text: line };
        return { file: m[1].replace(/^\.\//, ''), line: Number(m[2]), text: m[3] };
      });
      return { workspace, pattern, matches, truncated };
    },

    async glob(params) {
      const workspace = (params.workspace as string) || 'default';
      const pattern = params.pattern as string;
      const searchPath = (params.path as string) || '.';
      const limit = (params.limit as number) || 100;
      if (typeof pattern !== 'string' || !pattern) throw new Error('pattern is required');

      const { root, abs } = safeResolve(ctx.workspacesDir, workspace, searchPath);
      const rel = relative(root, abs);

      const args = ['--files', '-g', pattern];
      args.push(rel && rel !== '.' ? rel : '.');

      let stdout = '';
      try {
        const res = await execFileAsync('rg', args, { cwd: root, timeout: RG_TIMEOUT_MS, maxBuffer: RG_MAX_BUFFER });
        stdout = res.stdout;
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
        if (e.code === 1) return { workspace, pattern, files: [], truncated: false };
        if (typeof e.stdout === 'string' && e.stdout) stdout = e.stdout;
        else throw new Error(`glob failed: ${e.stderr || e.message || String(err)}`);
      }

      const files = stdout
        .split('\n')
        .filter((l) => l.length > 0)
        .map((f) => f.replace(/^\.\//, ''));
      const truncated = files.length > limit;
      return { workspace, pattern, files: files.slice(0, limit), truncated };
    },
  };
}
