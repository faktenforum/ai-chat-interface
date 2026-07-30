/**
 * Background job tools.
 *
 * `execute_command` must answer inside the MCP call timeout, so anything that takes minutes - an
 * install, a build, a long test run - either times out or forces the model to sit and wait. These
 * tools split that in two: start the command detached, then either carry on and check later, or
 * wait for it in a call that stays alive through progress notifications.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import type { UserManager } from '../user-manager.ts';
import type { WorkerManager } from '../worker-manager.ts';
import { resolveEmail, errorResult } from './helpers.ts';
import { logger } from '../utils/logger.ts';
import {
  StartJobSchema,
  ListJobsSchema,
  JobStatusSchema,
  ReadJobOutputSchema,
  WaitForJobSchema,
  KillJobSchema,
} from '../schemas/job.schema.ts';

/** How often wait_for_job checks - short enough to feel immediate, long enough not to spin. */
const POLL_INTERVAL_MS = 2_000;

interface JobStatusResult {
  state: 'running' | 'finished' | 'failed' | 'unknown';
  exit_code: number | null;
  output_chars: number;
}

export function registerJobTools(
  server: McpServer,
  userManager: UserManager,
  workerManager: WorkerManager,
): void {
  const call = async (email: string, method: string, params: Record<string, unknown>) => {
    const response = await workerManager.sendRequest(email, { id: randomUUID(), method, params });
    if (response.error) {
      throw new Error(response.error);
    }
    return response.result;
  };

  const asText = (result: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  });

  server.registerTool(
    'start_job',
    {
      description:
        'Start a shell command in the background and return immediately with a job_id. Use this for anything that takes longer than a few seconds - installs, builds, test suites, downloads, training runs - instead of blocking execute_command. ' +
        'The job keeps running after this call returns, and after the conversation turn ends. ' +
        'Then either continue working and call job_status / read_job_output later, or call wait_for_job to be handed the result as soon as it finishes. ' +
        'Returns: job_id, pid, command, workspace, started_at, state.',
      inputSchema: StartJobSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        return asText(
          await call(email, 'start_job', { command: args.command, workspace: args.workspace }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_jobs',
    {
      description:
        'List background jobs with their state (running, finished, failed, unknown), exit code, output size and timestamps. Newest first. Use it to pick up jobs started in an earlier turn.',
      inputSchema: ListJobsSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        return asText(await call(email, 'list_jobs', { workspace: args.workspace }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'job_status',
    {
      description:
        'Check one background job without reading its output: state, exit code, how much output it has produced so far, and when it finished.',
      inputSchema: JobStatusSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        return asText(await call(email, 'job_status', { job_id: args.job_id }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'read_job_output',
    {
      description:
        'Read the combined stdout and stderr of a background job. Works while it runs and after it ends. Without length the output is capped (head and tail, middle dropped); page through the full text with offset and length.',
      inputSchema: ReadJobOutputSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        return asText(
          await call(email, 'read_job_output', {
            job_id: args.job_id,
            offset: args.offset,
            length: args.length,
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'wait_for_job',
    {
      description:
        'Wait for a background job and return as soon as it finishes, with its exit code and the tail of its output. ' +
        'The call reports progress while waiting, which keeps it from timing out, so it can legitimately take minutes. ' +
        'If the timeout is reached first the job is left running and can be waited on again.',
      inputSchema: WaitForJobSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const deadline = Date.now() + args.timeout_seconds * 1000;
        /* Without a progress token the client asked for no updates, so waiting long would risk its
         * timeout; the loop still runs, it just cannot announce itself. */
        const progressToken = extra?._meta?.progressToken;
        let polls = 0;

        for (;;) {
          const status = (await call(email, 'job_status', {
            job_id: args.job_id,
          })) as JobStatusResult;

          if (status.state !== 'running') {
            const output = await call(email, 'read_job_output', { job_id: args.job_id });
            return asText({ ...status, waited_seconds: polls * (POLL_INTERVAL_MS / 1000), ...(output as object) });
          }

          if (Date.now() >= deadline) {
            return asText({
              ...status,
              timed_out: true,
              note: 'Still running. The job was left alone - wait again or check job_status later.',
            });
          }

          polls++;
          if (progressToken != null && extra?.sendNotification) {
            /* No total: the duration is unknown, and a made-up one would read as a real estimate.
             * Each notification resets the client's tool-call timeout, which is the point. */
            await extra
              .sendNotification({
                method: 'notifications/progress',
                params: {
                  progressToken,
                  progress: polls,
                  message: `Waiting for job (${status.output_chars} characters of output so far)`,
                },
              })
              .catch((err: unknown) => {
                logger.debug({ err }, 'progress notification not delivered');
              });
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'kill_job',
    {
      description:
        'Terminate a running background job (SIGTERM to its process group). Its output stays readable afterwards.',
      inputSchema: KillJobSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        return asText(await call(email, 'kill_job', { job_id: args.job_id }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
