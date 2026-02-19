/**
 * Shared helpers for MCP tool handlers
 */

import { sessionEmailMap } from './workspace.ts';

/**
 * Resolves the user email from the MCP request context.
 *
 * With multiple users and one app-level connection (shared session), the same session ID
 * is used by all users. We must use the **current request's** headers, not a session-scoped
 * map that gets overwritten on every request (last-writer-wins would run commands in the
 * wrong user's home). The SDK passes requestInfo.headers (from the HTTP request) in extra.
 */
export function resolveEmail(extra: unknown): string {
  const ctx = extra as Record<string, unknown> | undefined;

  const headers = ctx?.requestInfo && typeof ctx.requestInfo === 'object' && 'headers' in ctx.requestInfo
    ? (ctx.requestInfo as { headers?: Record<string, string> }).headers
    : undefined;
  if (headers && typeof headers === 'object') {
    const email = headers['x-user-email'] ?? headers['X-User-Email'];
    if (email && typeof email === 'string') return email;
  }

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
