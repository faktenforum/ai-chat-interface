/**
 * Env and proxy helpers shared by transcript and download tools.
 * Single source for YTPTUBE_PROXY and Webshare proxy URL.
 */

/**
 * Returns the proxy URL for yt-dlp: YTPTUBE_PROXY if set, else Webshare fixed proxy from env.
 * Used when building POST /api/history cli (--proxy <url>).
 */
export function getProxyUrl(): string | undefined {
  const explicit = process.env.YTPTUBE_PROXY?.trim();
  if (explicit) return explicit;

  const user = process.env.WEBSHARE_PROXY_USERNAME;
  const pass = process.env.WEBSHARE_PROXY_PASSWORD;
  if (!user || !pass) return undefined;

  const port = process.env.WEBSHARE_PROXY_PORT?.trim() || '80';
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@p.webshare.io:${port}`;
}

/** CLI fragment for extracting audio (mp3) for transcription. */
export const CLI_AUDIO = '--extract-audio --audio-format mp3';

/** CLI fragment for subtitles only (no download). */
export const CLI_SUBS = '--skip-download --write-subs';

/** Preset name for transcript jobs (audio-only; separate archive so video can be requested later). */
export const PRESET_TRANSCRIPT =
  process.env.YTPTUBE_PRESET_TRANSCRIPT?.trim() || 'mcp_audio';

/** Preset name for video download jobs (main archive). */
export const PRESET_VIDEO = process.env.YTPTUBE_PRESET_VIDEO?.trim() || 'default';
