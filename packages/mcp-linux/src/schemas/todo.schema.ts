/**
 * Zod schema for the in-context todo tool.
 * Replaces the former git-persisted plan/tasks handoff state: the list lives in the
 * model's context, not on disk.
 */

import { z } from 'zod';

export const TodoWriteSchema = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().min(1).describe('Short description of the task.'),
        status: z.enum(['pending', 'in_progress', 'completed']).describe('Current status of the task.'),
        id: z.string().optional().describe('Optional stable identifier for the task.'),
      }),
    )
    .describe('The full, updated todo list for the current task. Replaces the previous list.'),
});
