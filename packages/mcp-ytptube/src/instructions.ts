/**
 * MCP server instructions and prompt texts. Single source for LLM-facing copy.
 */

/** Server instructions (tools, flow, job_id, status, language, cookies). */
export const MCP_INSTRUCTIONS = `YTPTube MCP: media URL → transcript or download link.

Supported: Any yt-dlp URL (YouTube, SoundCloud, TikTok, Instagram, etc.). Try tools first; don't refuse links.

Flow: request_transcript (transcript) or request_download_link (file). Tools return result if exists, else start job and return status. Poll get_status(media_url=...) or get_status(job_id=<UUID>). When status=finished, call the same tool again for result.

LibreChat: No auto-polling. User asks for status → call get_status → reply. Don't promise monitoring.

job_id: Internal UUID (36-char). Use get_status(job_id=...) or get_status(media_url=...). Not platform media id. Relay relay= line to user.

status=skipped: URL in archive. User can call request_transcript/request_download_link again with same URL for existing file.

Two-phase transcript: Phase 1 (subtitles only, no download) for YouTube/captions. Phase 2 (audio transcription) if Phase 1 unavailable/empty. Video-only items auto-trigger Phase 1 or Phase 2.

Video after transcript: Phase 1 downloads nothing; Phase 2 downloads audio only. User can request video later: request_download_link(type=video, same URL) → poll get_status → call again for link.

language_hint: "de" selects subtitle language (Phase 1) and improves transcription (Phase 2). Without hint: language=unknown + instruction. If wrong, ask user for language and re-call with language_hint. Pass proactively when user indicated language.

Cookies: Netscape format for 403/age-restricted/login-only. First line "# HTTP Cookie File" or "# Netscape HTTP Cookie File". User exports from browser (extension "Get cookies.txt LOCALLY" / "cookies.txt", or yt-dlp --cookies-from-browser). In LibreChat, upload as "Upload as Text". Read file content → pass as cookies parameter. Not stored server-side; reuse in same conversation. Advise trusted chats only.

Never invent transcript text. Use get_media_info for metadata; list_recent_downloads for queue/history (job_id is UUID).`;

/** Prompt text for cookies_usage prompt (user-facing). */
export const COOKIES_USAGE_PROMPT_TEXT = [
  'Use cookies (Netscape HTTP Cookie format) with request_transcript or request_download_link when the user hits 403, age-restriction, or login-only.',
  'Format: first line "# HTTP Cookie File" or "# Netscape HTTP Cookie File"; data lines tab-separated (domain, flag, path, secure, expires, name, value).',
  'User can export from browser (extension "Get cookies.txt LOCALLY" / "cookies.txt" for Firefox, or yt-dlp --cookies-from-browser … --cookies file.txt), then paste in chat or upload the file. In LibreChat, a cookies file exported via the browser extension can be uploaded as "Upload as Text".',
  'Read file content and pass it as the cookies parameter. Cookies are not stored server-side; for multiple items in the same conversation, reuse the cookie content the user provided and pass it again in each request.',
  'Advise sharing cookies only in trusted chats. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp',
].join(' ');
