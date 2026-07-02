/**
 * Shared helpers for Express route handlers.
 */

/**
 * Extracts a route param as a single string (Express 5 params may be string | string[]).
 */
export function paramString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
