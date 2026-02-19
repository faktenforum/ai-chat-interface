/**
 * Env and proxy helpers shared by transcript and download tools.
 * Single source for YTPTUBE_PROXY and Webshare proxy URL.
 */

function getProxyUrlRaw(): string | undefined {
  const explicit = process.env.YTPTUBE_PROXY?.trim();
  if (explicit) return explicit;

  const user = process.env.WEBSHARE_PROXY_USERNAME;
  const pass = process.env.WEBSHARE_PROXY_PASSWORD;
  if (!user || !pass) return undefined;

  const port = process.env.WEBSHARE_PROXY_PORT?.trim() || '80';
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@p.webshare.io:${port}`;
}

/**
 * True when Webshare is configured. When true, first attempt is done without proxy; on blocked-like
 * failure we retry with proxy (and optional further retries with new IP).
 */
export function shouldTryWithoutProxyFirst(): boolean {
  return isWebshareProxyActive();
}

/**
 * True when Webshare (rotating proxy) is in use. Used to decide whether to retry on blocked-like errors:
 * only with Webshare does a new job get a different IP; a fixed YTPTUBE_PROXY would not.
 */
export function isWebshareProxyActive(): boolean {
  if (process.env.YTPTUBE_PROXY?.trim()) return false;
  const user = process.env.WEBSHARE_PROXY_USERNAME;
  const pass = process.env.WEBSHARE_PROXY_PASSWORD;
  return Boolean(user && pass);
}

/**
 * Returns the proxy URL for yt-dlp when building CLI.
 * - forRetry === true: always use proxy if configured (for retry-after-blocked).
 * - forRetry === false: no proxy (first attempt when try-without-proxy is enabled).
 * - forRetry === undefined: use proxy only when we are not doing "try without proxy first"
 *   (i.e. when Webshare is configured, first attempt gets no proxy; when only YTPTUBE_PROXY, use it).
 */
export function getProxyUrl(forRetry?: boolean): string | undefined {
  const raw = getProxyUrlRaw();
  if (forRetry === false) return undefined;
  if (forRetry === true) return raw;
  return shouldTryWithoutProxyFirst() ? undefined : raw;
}

/**
 * Context for a job we just queued: whether proxy was used and 1-based attempt number.
 * Use when returning status to the LLM so it knows proxy_used and attempt.
 */
export function jobAttemptContext(useProxyForRetry?: boolean): { proxy_used: boolean; attempt: number } {
  const proxyUsed = Boolean(getProxyUrl(useProxyForRetry));
  const attempt = useProxyForRetry ? 2 : 1;
  return { proxy_used: proxyUsed, attempt };
}

/** Preset name for subtitle-only jobs (captions-first; no archive). */
export const PRESET_SUBS = process.env.YTPTUBE_PRESET_SUBS?.trim() || 'mcp_subs';

/** Preset name for audio extraction jobs (transcription fallback + audio download links; separate archive). */
export const PRESET_AUDIO =
  process.env.YTPTUBE_PRESET_AUDIO?.trim() || process.env.YTPTUBE_PRESET_TRANSCRIPT?.trim() || 'mcp_audio';

/** Preset name for video download jobs (main archive). */
export const PRESET_VIDEO = process.env.YTPTUBE_PRESET_VIDEO?.trim() || 'default';

/** Maximum file size (bytes) for transcription API. Default 25MB (OpenAI Whisper limit). */
export const TRANSCRIPTION_MAX_BYTES = parseInt(
  process.env.TRANSCRIPTION_MAX_BYTES?.trim() || String(25 * 1024 * 1024),
  10,
);
