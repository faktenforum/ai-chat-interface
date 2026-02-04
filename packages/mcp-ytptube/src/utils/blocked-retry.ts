/**
 * Detection of "blocked" / bot / rate-limit errors from yt-dlp or YTPTube.
 * When such an error occurs and a proxy is configured, we retry once with a new job (with proxy).
 * With Webshare, the first attempt is without proxy; only the retry uses proxy (and rotating IP).
 */

/** Substrings that indicate the request was likely blocked (bot check, rate limit, geo, etc.). */
const BLOCKED_LIKE_PATTERNS = [
  'sign in to confirm',
  'not a bot',
  'confirm you\'re not a bot',
  'no video formats found',
  'no formats',
  'requested format is not available',
  'unable to extract',
  'rate limit',
  'rate_limit',
  '429',
  'blocked',
  'bot',
  'captcha',
  'geo-restricted',
  'geo restricted',
  'video unavailable',
  'sign in',
  'login',
];

/**
 * Returns true if the error message looks like a platform block (bot, rate limit, geo, etc.).
 * Used to decide whether to retry once with a new job (new IP) when using a rotating proxy.
 */
export function isBlockedLikeError(message: string): boolean {
  if (!message || typeof message !== 'string') return false;
  const lower = message.toLowerCase();
  return BLOCKED_LIKE_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}
