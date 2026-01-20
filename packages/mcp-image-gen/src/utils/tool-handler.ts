import type { TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';
import { logger } from './logger.ts';
import { ImageGenError } from './errors.ts';

type ToolResult = { content: Array<TextContent | ImageContent>; isError?: boolean };

export function withToolErrorHandler<TArgs extends unknown[], TResult extends ToolResult>(
  toolName: string,
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<ToolResult> {
  return async (...args: TArgs): Promise<ToolResult> => {
    try {
      return await fn(...args);
    } catch (error) {
      logger.error(
        { tool: toolName, args, error: error instanceof Error ? error.message : String(error) },
        'Tool execution failed',
      );
      
      const message = error instanceof ImageGenError
        ? `Error: ${error.message}`
        : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
      
      return {
        content: [{ type: 'text', text: message }],
        isError: true,
      };
    }
  };
}
