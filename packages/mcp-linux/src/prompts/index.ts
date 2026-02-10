/**
 * MCP Prompt Registration
 *
 * Registers all prompts on the MCP server. Prompts provide terminal usage
 * examples so the LLM knows how to use the terminal for common tasks.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FILE_OPERATIONS_PROMPT } from './file-operations.ts';
import { SEARCH_FILES_PROMPT } from './search.ts';
import { GIT_WORKFLOW_PROMPT } from './git-workflow.ts';
import { RUNTIME_MANAGEMENT_PROMPT } from './runtime-management.ts';
import { WORKSPACE_SETUP_PROMPT } from './workspace-setup.ts';

const ALL_PROMPTS = [
  FILE_OPERATIONS_PROMPT,
  SEARCH_FILES_PROMPT,
  GIT_WORKFLOW_PROMPT,
  RUNTIME_MANAGEMENT_PROMPT,
  WORKSPACE_SETUP_PROMPT,
];

/**
 * Registers all prompts on the MCP server
 */
export function registerPrompts(server: McpServer): void {
  for (const prompt of ALL_PROMPTS) {
    server.registerPrompt(
      prompt.name,
      { description: prompt.description },
      async () => ({
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: prompt.content,
            },
          },
        ],
      }),
    );
  }
}
