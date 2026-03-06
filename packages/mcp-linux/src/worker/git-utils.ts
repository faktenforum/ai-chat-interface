/**
 * Git and process utilities for the worker.
 */

import { execFile as execFileCb, spawn } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { validateWorkspaceName } from '../utils/security.ts';
import { GIT_TIMEOUT_MS, CLONE_TIMEOUT_MS } from './constants.ts';

const execFile = promisify(execFileCb);

/**
 * Escapes a path for use inside double-quoted shell string (escape \ and ").
 */
export function escapeForDoubleQuotedShell(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function getGitMetadata(
  workspacesDir: string,
  workspace: string,
): Promise<{ branch: string; dirty: boolean }> {
  const error = validateWorkspaceName(workspace);
  if (error) return { branch: 'main', dirty: false };

  const cwd = join(workspacesDir, workspace);
  let branch = 'main';
  let dirty = false;

  try {
    const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
    });
    branch = stdout.trim() || 'main';
  } catch {
    // Not a git repo or no commits
  }

  try {
    const { stdout } = await execFile('git', ['status', '--porcelain'], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
    });
    dirty = stdout.trim().length > 0;
  } catch {
    // Not a git repo
  }

  return { branch, dirty };
}

/**
 * Spawns a child process with a timeout, returning stdout/stderr.
 * Used for long-running operations like git clone.
 */
export function spawnWithTimeout(
  command: string,
  args: string[],
  options: { timeout?: number; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { timeout = CLONE_TIMEOUT_MS, cwd } = options;
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
