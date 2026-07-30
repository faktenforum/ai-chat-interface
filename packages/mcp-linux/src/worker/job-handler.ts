/**
 * Background jobs: commands that outlive the tool call that started them.
 *
 * `execute_command` has to return within the MCP call timeout, which rules out installs, builds,
 * long test runs and anything else that takes minutes. A job is started detached, so it keeps
 * running while the agent does something else - or while the user is not even in the chat - and its
 * output is collected in the user's home for later reading.
 *
 * State lives in files rather than in memory so a worker restart does not lose track of a running
 * job: `<id>.json` holds the metadata, `<id>.log` the combined output, `<id>.exit` the exit code
 * once the command is done. The exit file is what makes "finished" observable without a parent
 * process watching.
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Handler, WorkerContext } from './types.ts';
import { capOutput } from '../utils/cap-output.ts';
import { escapeForDoubleQuotedShell } from './git-utils.ts';

const JOBS_DIR_NAME = '.mcp_jobs';
/** Keeps `list_jobs` readable and the directory from growing without bound. */
const MAX_LISTED_JOBS = 50;

interface JobMeta {
  job_id: string;
  command: string;
  workspace: string;
  pid: number;
  started_at: string;
}

type JobState = 'running' | 'finished' | 'failed' | 'unknown';

export interface JobStatus extends JobMeta {
  state: JobState;
  exit_code: number | null;
  finished_at: string | null;
  output_chars: number;
}

function jobsDir(ctx: WorkerContext): string {
  return join(ctx.homeDir, JOBS_DIR_NAME);
}

function validateJobId(jobId: unknown): string {
  if (typeof jobId !== 'string' || !/^[0-9a-f-]{36}$/.test(jobId)) {
    throw new Error('job_id is required and must be a job id returned by start_job');
  }
  return jobId;
}

async function readMeta(ctx: WorkerContext, jobId: string): Promise<JobMeta> {
  try {
    return JSON.parse(await fs.readFile(join(jobsDir(ctx), `${jobId}.json`), 'utf-8')) as JobMeta;
  } catch {
    throw new Error(`Job not found: ${jobId}`);
  }
}

function processAlive(pid: number): boolean {
  try {
    /* Signal 0 only checks for existence and permission, it does not touch the process. */
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function statusOf(ctx: WorkerContext, meta: JobMeta): Promise<JobStatus> {
  const dir = jobsDir(ctx);
  let exitCode: number | null = null;
  let finishedAt: string | null = null;

  try {
    const exitFile = join(dir, `${meta.job_id}.exit`);
    const raw = await fs.readFile(exitFile, 'utf-8');
    const parsed = parseInt(raw.trim(), 10);
    exitCode = Number.isFinite(parsed) ? parsed : null;
    finishedAt = (await fs.stat(exitFile)).mtime.toISOString();
  } catch {
    /* No exit file yet: either still running, or killed before it could write one. */
  }

  let outputChars = 0;
  try {
    outputChars = (await fs.stat(join(dir, `${meta.job_id}.log`))).size;
  } catch {
    /* No output yet. */
  }

  let state: JobState;
  if (exitCode !== null) {
    state = exitCode === 0 ? 'finished' : 'failed';
  } else if (processAlive(meta.pid)) {
    state = 'running';
  } else {
    /* Gone without an exit code - killed, or the container restarted under it. */
    state = 'unknown';
  }

  return { ...meta, state, exit_code: exitCode, finished_at: finishedAt, output_chars: outputChars };
}

export function createJobHandlers(ctx: WorkerContext): Record<string, Handler> {
  return {
    async start_job(params) {
      const command = params.command as string;
      const workspace = (params.workspace as string) || 'default';
      if (typeof command !== 'string' || !command.trim()) {
        throw new Error('command is required');
      }

      const dir = jobsDir(ctx);
      await fs.mkdir(dir, { recursive: true });

      const jobId = randomUUID();
      const logPath = join(dir, `${jobId}.log`);
      const exitPath = join(dir, `${jobId}.exit`);
      const workspaceRoot = join(ctx.workspacesDir, workspace);

      /* The wrapper is what makes completion observable: whatever the command does, the exit code
       * lands in a file the status check can read without supervising the process.
       * A subshell, not a brace group - a command containing `exit` would otherwise end the whole
       * wrapper and the exit code would never be written. */
      const wrapped = `( ${command} ) > "${escapeForDoubleQuotedShell(logPath)}" 2>&1; echo $? > "${escapeForDoubleQuotedShell(exitPath)}"`;

      const child = spawn('bash', ['-lc', wrapped], {
        cwd: workspaceRoot,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      if (child.pid == null) {
        throw new Error('Failed to start the job');
      }

      const meta: JobMeta = {
        job_id: jobId,
        command,
        workspace,
        pid: child.pid,
        started_at: new Date().toISOString(),
      };
      await fs.writeFile(join(dir, `${jobId}.json`), JSON.stringify(meta), 'utf-8');

      return { ...meta, state: 'running' as const };
    },

    async list_jobs(params) {
      const workspace = params.workspace as string | undefined;
      const dir = jobsDir(ctx);

      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return { jobs: [], total: 0 };
      }

      const jobIds = entries.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
      const all: JobStatus[] = [];
      for (const jobId of jobIds) {
        try {
          all.push(await statusOf(ctx, await readMeta(ctx, jobId)));
        } catch {
          /* Half-written or removed while listing - not worth failing the whole list over. */
        }
      }

      const filtered = workspace ? all.filter((j) => j.workspace === workspace) : all;
      filtered.sort((a, b) => b.started_at.localeCompare(a.started_at));
      return { jobs: filtered.slice(0, MAX_LISTED_JOBS), total: filtered.length };
    },

    async job_status(params) {
      return statusOf(ctx, await readMeta(ctx, validateJobId(params.job_id)));
    },

    async read_job_output(params) {
      const jobId = validateJobId(params.job_id);
      const offset = (params.offset as number) || 0;
      const length = params.length as number | undefined;
      const status = await statusOf(ctx, await readMeta(ctx, jobId));

      let full = '';
      try {
        full = await fs.readFile(join(jobsDir(ctx), `${jobId}.log`), 'utf-8');
      } catch {
        /* Nothing written yet. */
      }

      const slice = length ? full.slice(offset, offset + length) : full.slice(offset);
      return {
        job_id: jobId,
        state: status.state,
        exit_code: status.exit_code,
        total_chars: full.length,
        ...(length ? { output: slice } : capOutput(slice)),
      };
    },

    async kill_job(params) {
      const jobId = validateJobId(params.job_id);
      const meta = await readMeta(ctx, jobId);
      const status = await statusOf(ctx, meta);

      if (status.state !== 'running') {
        return { job_id: jobId, killed: false, state: status.state };
      }

      try {
        /* Negative pid targets the process group, so a pipeline dies with its parent. */
        process.kill(-meta.pid, 'SIGTERM');
      } catch {
        try {
          process.kill(meta.pid, 'SIGTERM');
        } catch {
          return { job_id: jobId, killed: false, state: 'unknown' as const };
        }
      }

      return { job_id: jobId, killed: true, state: 'unknown' as const };
    },
  };
}
