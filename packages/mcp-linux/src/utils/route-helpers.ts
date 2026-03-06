/**
 * Shared helpers for Express route handlers.
 */

import type { Response } from 'express';

/**
 * Extracts a route param as a single string (Express 5 params may be string | string[]).
 */
export function paramString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Redirects to an SPA error page with encoded title/message query params.
 * @param basePath - The route prefix (e.g. "upload" or "download")
 */
export function spaErrorRedirect(
  res: Response,
  basePath: string,
  status: number,
  title: string,
  message: string,
): void {
  const t = encodeURIComponent(title);
  const m = encodeURIComponent(message);
  res.status(status).redirect(`/${basePath}/error?title=${t}&message=${m}`);
}
