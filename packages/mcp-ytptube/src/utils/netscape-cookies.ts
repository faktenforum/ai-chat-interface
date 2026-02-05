/**
 * Netscape HTTP Cookie file format validation (cookies.txt).
 * Format: tab-separated lines; first line must be "# HTTP Cookie File" or "# Netscape HTTP Cookie File";
 * data lines: domain, flag (TRUE/FALSE), path, secure (TRUE/FALSE), expiration (unix ts), name, value.
 * See: https://curl.se/rfc/cookie_spec.html, yt-dlp FAQ.
 * Logic inspired by https://github.com/naseif/Netscape-Cookies-Parser (no dependency).
 */

const VALID_HEADERS = ['# HTTP Cookie File', '# Netscape HTTP Cookie File'];

/** Message for InvalidCookiesError when validation fails. Single source of truth for tools. */
export const INVALID_COOKIES_MESSAGE =
  'Cookies must be in Netscape HTTP Cookie format: first line "# HTTP Cookie File" or "# Netscape HTTP Cookie File"; data lines tab-separated (domain, flag, path, secure, expires, name, value). See https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp';

/**
 * Validates that a string is in Netscape HTTP Cookie file format.
 * - First non-empty line must be "# HTTP Cookie File" or "# Netscape HTTP Cookie File".
 * - Data lines (non-comment, non-empty) must have exactly 7 tab-separated fields:
 *   domain, flag (TRUE/FALSE), path, secure (TRUE/FALSE), expires (unix timestamp), name, value.
 *
 * @param content - Raw cookie file content (e.g. pasted or from file).
 * @returns True if the content is valid Netscape cookie format; false otherwise.
 */
export function isValidNetscapeCookieFormat(content: string): boolean {
  if (typeof content !== 'string') return false;
  const trimmed = content.trim();
  if (trimmed.length === 0) return false;

  const lines = trimmed.split('\n');
  let seenHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    // #HttpOnly_.domain is a domain prefix in data lines, not a comment
    const isComment = line.startsWith('#') && !line.startsWith('#HttpOnly_');
    if (isComment) {
      if (!seenHeader) {
        if (!VALID_HEADERS.includes(line)) return false;
        seenHeader = true;
      }
      continue;
    }
    // Data line: 7 tab-separated fields
    const parts = line.split('\t');
    if (parts.length !== 7) return false;
    const [, flag, , secure, expires] = parts;
    const flagOk = flag === 'TRUE' || flag === 'FALSE';
    const secureOk = secure === 'TRUE' || secure === 'FALSE';
    const expiresOk =
      expires === '' || (expires !== undefined && /^\d+$/.test(expires));
    if (!flagOk || !secureOk || !expiresOk) return false;
  }

  return seenHeader;
}
