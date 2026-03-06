/**
 * MCP Prompt Registration
 *
 * Registers all prompts on the MCP server. Prompts provide terminal usage
 * examples so the LLM knows how to use the terminal for common tasks.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FILE_OPERATIONS_PROMPT } from './file-operations.ts';
import { SEARCH_FILES_PROMPT } from './search.ts';
import { WORKSPACES_PROMPT } from './workspaces.ts';
import { RUNTIME_MANAGEMENT_PROMPT } from './runtime-management.ts';
import { CODE_SEARCH_PROMPT } from './code-search.ts';
import { ACCOUNT_STATUS_PROMPT } from './account-status.ts';

const ALL_PROMPTS = [
  FILE_OPERATIONS_PROMPT,
  SEARCH_FILES_PROMPT,
  CODE_SEARCH_PROMPT,
  WORKSPACES_PROMPT,
  RUNTIME_MANAGEMENT_PROMPT,
  ACCOUNT_STATUS_PROMPT,
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
