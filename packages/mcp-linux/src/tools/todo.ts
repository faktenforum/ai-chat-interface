/**
 * In-context todo tool.
 *
 * Replaces the former git-persisted plan/tasks handoff state. The list lives in the
 * model's context: the tool echoes the current list back so it stays salient across
 * a multi-step task. Stateless by design (no per-user server state, no cross-chat bleed).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorResult } from './helpers.ts';
import { TodoWriteSchema } from '../schemas/todo.schema.ts';

const STATUS_MARK: Record<string, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
};

export function registerTodoTools(server: McpServer): void {
  server.registerTool(
    'todowrite',
    {
      description:
        'Create and maintain a structured todo list for the current multi-step task. Call it to record your plan and to update statuses as you go (pending, in_progress, completed). Keep exactly one item in_progress at a time. The list is kept in context; there is no separate persistence.',
      inputSchema: TodoWriteSchema.shape,
    },
    async (args) => {
      try {
        const todos = args.todos;
        const rendered = todos.length
          ? todos.map((t) => `${STATUS_MARK[t.status] ?? '[ ]'} ${t.content}`).join('\n')
          : '(empty)';
        const done = todos.filter((t) => t.status === 'completed').length;
        return {
          content: [
            { type: 'text' as const, text: `Todo list updated (${done}/${todos.length} completed):\n${rendered}` },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
