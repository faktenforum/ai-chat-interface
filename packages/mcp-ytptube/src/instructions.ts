/**
 * MCP server instructions and prompt texts. Single source for LLM-facing copy.
 */

/** Server instructions (tools, flow, job_id, status, language, cookies). */
export const MCP_INSTRUCTIONS = `YTPTube MCP: video URL to transcript or download link.

Supported links: Any URL that yt-dlp supports, including YouTube, Reddit (posts with embedded video), Instagram, TikTok, Vimeo, Twitter/X, Facebook, and hundreds of other sites. Page URLs that embed a video (e.g. a Reddit post URL) are valid—use get_video_info to check support and metadata, or request_video_transcript/request_download_link directly. Do not refuse a link because it "looks like a text page"; try the tool first.

Request flow: (1) request_video_transcript for transcript only; (2) request_download_link for download link (video or audio) only. Both tools check if the result exists; if yes return it; if not they start the job and return status. Poll with get_status(video_url=...) or get_status(job_id=<UUID>). When status=finished, call the same request tool again to get transcript or link.

LibreChat: No automatic MCP polling. Tell the user to ask for status (e.g. "What is the status?"); then call get_status and reply. Do not promise to monitor or check back automatically.

Important: job_id is the internal UUID (36-char). Use get_status(job_id=...) or get_status(video_url=...); not the platform video id. Relay the relay= line to the user.

Status=skipped: When the URL is already in the download archive, YTPTube skips the job and returns status=skipped (reason mentions archive). Tell the user the video was already downloaded; they can call request_video_transcript or request_download_link again with the same URL to get transcript or link from the existing file.

Video-only: If the item was only downloaded as video, request_video_transcript starts a transcript job and returns queued; poll get_status then call request_video_transcript again when finished.

Video after transcript: Transcript jobs download only audio (saves bandwidth). The user can still request the video later: call request_download_link with type=video and the same URL; the tool will queue the video download and return status=queued. Poll get_status then call request_download_link again for the video link.

Transcript language: Without language_hint, responses include language=unknown and language_instruction. Tell the user the language was unspecified and may be wrong; if wrong, ask for the correct language and re-call with language_hint (e.g. "de"). Pass language_hint proactively when the user already indicated the video language.

Cookies: Optional cookies (Netscape HTTP Cookie format) help with 403, age-restricted, login-only, or geo-blocked videos. First line of the file must be "# HTTP Cookie File" or "# Netscape HTTP Cookie File" (see yt-dlp FAQ). User can export from browser (e.g. extension "Get cookies.txt LOCALLY" / "cookies.txt" for Firefox, or yt-dlp --cookies-from-browser … --cookies file.txt) then paste the content in chat or upload the file. In LibreChat, a cookies file exported via the browser extension can be uploaded as "Upload as Text". If the user uploads a file, read its content and pass it as the cookies parameter to request_video_transcript or request_download_link. Cookies are not stored server-side; for multiple videos in the same conversation, reuse the cookie content the user provided and pass it again in each request. When the user asks about cookies or reports 403/age-restriction, explain these steps and use the provided cookie content on the next request. Cookie content is sensitive; advise sharing only in trusted chats.

Never invent or hallucinate transcript text. Use get_video_info for metadata without downloading; use list_recent_downloads to see queue/history (job_id there is UUID).`;

/** Prompt text for cookies_usage prompt (user-facing). */
export const COOKIES_USAGE_PROMPT_TEXT = [
  'Use cookies (Netscape HTTP Cookie format) with request_video_transcript or request_download_link when the user hits 403, age-restriction, or login-only.',
  'Format: first line "# HTTP Cookie File" or "# Netscape HTTP Cookie File"; data lines tab-separated (domain, flag, path, secure, expires, name, value).',
  'User can export from browser (extension "Get cookies.txt LOCALLY" / "cookies.txt" for Firefox, or yt-dlp --cookies-from-browser … --cookies file.txt), then paste in chat or upload the file. In LibreChat, a cookies file exported via the browser extension can be uploaded as "Upload as Text".',
  'Read file content and pass it as the cookies parameter. Cookies are not stored server-side; for multiple videos in the same conversation, reuse the cookie content the user provided and pass it again in each request.',
  'Advise sharing cookies only in trusted chats. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp',
].join(' ');
