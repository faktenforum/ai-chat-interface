/**
 * Shared helpers for MCP tool handlers
 */

import { sessionEmailMap } from './workspace.ts';

/**
 * Resolves the user email from the MCP request context.
 * Checks session-based lookup first, then falls back to direct email property.
 */
export function resolveEmail(extra: unknown): string {
  const ctx = extra as Record<string, unknown> | undefined;

  if (ctx?.sessionId && typeof ctx.sessionId === 'string') {
    const email = sessionEmailMap.get(ctx.sessionId);
    if (email) return email;
  }

  if (ctx && typeof (ctx as Record<string, unknown>).email === 'string') {
    return (ctx as Record<string, unknown>).email as string;
  }

  throw new Error('User email not found in request context. Ensure X-User-Email header is sent.');
}

/**
 * Wraps an error into a standard MCP tool error result.
 */
export function errorResult(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}
