/**
 * Schemas for background job tools.
 */

import { z } from 'zod';

export const StartJobSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe('Shell command to run in the background, e.g. "npm install" or "pytest -q"'),
  workspace: z.string().default('default').describe('Workspace name (default: "default")'),
});

export const ListJobsSchema = z.object({
  workspace: z.string().optional().describe('Only list jobs started in this workspace'),
});

export const JobStatusSchema = z.object({
  job_id: z.string().min(1).describe('Job id returned by start_job'),
});

export const ReadJobOutputSchema = z.object({
  job_id: z.string().min(1).describe('Job id returned by start_job'),
  offset: z.number().int().min(0).optional().describe('Character offset to start reading from'),
  length: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Characters to read. Without it the output is capped and the middle is dropped.'),
});

export const WaitForJobSchema = z.object({
  job_id: z.string().min(1).describe('Job id returned by start_job'),
  timeout_seconds: z
    .number()
    .int()
    .min(1)
    .max(1800)
    .default(300)
    .describe('How long to wait before giving up on this call (default 300, max 1800)'),
});

export const KillJobSchema = z.object({
  job_id: z.string().min(1).describe('Job id returned by start_job'),
});
