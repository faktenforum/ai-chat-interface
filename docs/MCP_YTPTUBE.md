# MCP YTPTube

YTPTube-backed MCP: video URL → transcript (YTPTube + Scaleway STT) or download link. Prod/dev: Traefik exposes only `/api/download` for YTPTube; MCP is internal.

## Tools

**Request pattern:** `request_video_transcript` and `request_download_link` return result if present; else start job and return status. Poll with `get_status`; when finished, call the same request tool again.

| Tool | Args | Behavior |
|------|------|----------|
| `request_video_transcript` | video_url, preset?, language_hint?, cookies? | Transcript. Resolve by URL; if finished → transcript; else status or POST + queued. **language_hint** (ISO-639-1); omit → `language=unknown` + instruction to ask user. **cookies?** Netscape format for age-restricted/login/403. |
| `request_download_link` | video_url, type? (video), preset?, cookies? | Download link (video/audio). Requires `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL`. |
| `get_status` | video_url? or job_id? (one required) | Status by **job_id** (UUID from prior response) or **video_url**. When finished, call request tool again. |
| `list_recent_downloads` | limit?, status_filter? (all\|finished\|queue) | Last N items; optional `download_url` when finished. |
| `get_video_info` | video_url | Metadata (title, duration, extractor) without downloading. |
| `get_thumbnail_url` | video_url | Thumbnail URL (yt-dlp). |

## Response format

Key=value lines. **Transcript:** metadata block (`result=transcript`, `url`, `job_id`, `transcript_source`, `language?`, `language_instruction?`, `relay`) + transcript text. **Status:** `result=status`, `status`, `job_id?`, `url?`, `progress?`, `relay`. **Error:** `result=error`, `relay=`.

## Transcript language

Without `language_hint`: responses include `language=unknown` and `language_instruction` (ask user, re-call with `language_hint`). With `language_hint`: sent to API for better accuracy.

## Cookies

Netscape HTTP Cookie format; first line `# HTTP Cookie File` or `# Netscape HTTP Cookie File`. Not stored server-side; reuse cookie content per request. Export: browser extension or `yt-dlp --cookies-from-browser … --cookies file.txt`. [yt-dlp FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp). Prompt `cookies_usage` in MCP for user-facing instructions.

## LibreChat

No automatic MCP polling. LLM asks user to request status; then calls `get_status` and replies. Do not promise to monitor automatically.

## Dependencies

- **YTPTube** – queues URLs, serves files. Set `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` so `request_download_link` returns valid links. [GitHub](https://github.com/ArabCoders/ytptube)
- **yt-dlp** – used by YTPTube. Supported sites: [dev/yt-dlp/supportedsites.md](dev/yt-dlp/supportedsites.md). MCP canonical keys (yt-dlp-aligned): YouTube, Instagram, TikTok, Douyin, Twitter/X, Vimeo, Twitch, Facebook, Reddit, Dailymotion, Bilibili, Rumble, SoundCloud, BitChute, 9GAG, Streamable, Wistia, PeerTube, Bandcamp, Odysee/LBRY, VK, Coub, Mixcloud, Imgur, Naver TV, Youku, Zhihu; others via normalized URL or YTPTube `archive_id`.
- **Scaleway** – `SCALEWAY_BASE_URL` + `SCALEWAY_API_KEY`; OpenAI-compatible `/audio/transcriptions` (e.g. whisper-large-v3).

## Env

| Var | Description |
|-----|-------------|
| `YTPTUBE_URL` | Base URL (default `http://ytptube:8081`). |
| `YTPTUBE_API_KEY` | Optional; for YTPTube auth and download links. |
| `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` | Public base for download links (e.g. `https://ytptube.${DOMAIN}`). |
| `YTPTUBE_SUB_LANGS` | Optional. Subtitle langs for platform subs (e.g. `en,en-US`). |
| `YTPTUBE_PRESET_TRANSCRIPT` | Preset for transcript jobs (default `mcp_audio`). See "Video after transcript" below. |
| `YTPTUBE_PRESET_VIDEO` | Preset for video download jobs (default `default`). |
| `YTPTUBE_PROXY` | Optional. Proxy for yt-dlp (overrides Webshare). |
| `WEBSHARE_PROXY_USERNAME`, `WEBSHARE_PROXY_PASSWORD` | Optional. Webshare fixed proxy when `YTPTUBE_PROXY` unset. Same as mcp-youtube-transcript. [WEBSHARE_PROXY.md](WEBSHARE_PROXY.md) |
| `SCALEWAY_BASE_URL`, `SCALEWAY_API_KEY` | Required for transcription. |
| `MCP_YTPTUBE_PORT` / `PORT` | HTTP port (default 3010). |
| `MCP_YTPTUBE_LOG_LEVEL` / `LOG_LEVEL` | Log level (default `info`). |
| `MCP_YTPTUBE_DEBUG_API` | `1` or `true` to log full YTPTube API responses; use with `LOG_LEVEL=debug`. |
| `YTPTUBE_SKIP_PRESET_SYNC` | `1` or `true` to skip creating/updating the transcript preset on startup (e.g. when presets are managed elsewhere). |
| `YTPTUBE_STARTUP_MAX_WAIT_MS` | Max ms to wait for YTPTube at startup (default `300000` = 5 min). |

YTPTube compose: `YTP_OUTPUT_TEMPLATE`/`YTP_OUTPUT_TEMPLATE_CHAPTER` set to short values to avoid "File name too long".

## Startup

On start, the server waits for YTPTube (GET api/ping/), then creates or updates the transcript preset to match the canonical definition. Timeout: `YTPTUBE_STARTUP_MAX_WAIT_MS`. Set `YTPTUBE_SKIP_PRESET_SYNC=1` to skip when you manage presets yourself.

## Path resolution and video-only

Finished items: MCP uses `item.filename`/`folder` when present; else file-browser. **Video-only:** If URL was only downloaded as video, `request_video_transcript` starts a transcript job and returns `status=queued`; poll `get_status`, then call again for transcript.

## Video after transcript

Transcript jobs download only audio (saves bandwidth). To allow requesting the **video** later for the same URL, transcript jobs must use a preset that writes to a **separate archive** (e.g. `archive_audio.log`). The upstream default preset `audio_only` uses the main `archive.log` and is **not** suitable: the URL would be in the main archive and a later video request (preset `default`) would be skipped.

The MCP server ensures the preset (default `mcp_audio`) exists and is up to date on startup. To create or change it manually (e.g. `YTPTUBE_SKIP_PRESET_SYNC=1`), use **POST /api/presets** with YTPTube API auth. Body example (Ogg Vorbis for Scaleway STT):

```json
{
  "name": "mcp_audio",
  "description": "Audio-only for MCP transcript jobs. Uses archive_audio.log so the same URL can later be downloaded as video.",
  "folder": "",
  "template": "",
  "cookies": "",
  "cli": "--socket-timeout 30 --download-archive %(config_path)s/archive_audio.log\n--extract-audio --audio-format vorbis --add-chapters --embed-metadata --embed-thumbnail --format 'bestaudio/best'",
  "priority": 0
}
```

## URL matching

Match by URL, item identifiers, or **POST /api/yt-dlp/archive_id/** (any platform). Canonical keys (same URL → same key): YouTube, Instagram, TikTok, Douyin, Twitter/X, Vimeo, Twitch, Facebook, Reddit, Dailymotion, Bilibili, Rumble, SoundCloud, BitChute, 9GAG, Streamable, Wistia, PeerTube, Bandcamp, Odysee/LBRY, VK, Coub, Mixcloud, Imgur, Naver TV, Youku, Zhihu; generic URLs normalized (RFC 3986 dot-segments, no query). Protocol-relative URLs (`//...`) and typos (`httpss://`, `rmtp://`) are sanitized. Others: YTPTube `archive_id`. `get_status(video_url)` not_found → check URL form or timing; use `list_recent_downloads` and `MCP_YTPTUBE_DEBUG_API=1` + `LOG_LEVEL=debug` to inspect.

## Troubleshooting

- **After code changes:** Restart MCP server; reload MCP in Cursor.
- **Item not found:** URL format, item not in queue yet, or wrong YTPTube URL.
- **job_id:** Use internal UUID from responses, not platform video id.
- **status=error, No formats:** Geo-restricted, private, or unsupported; try cookies or another URL.
- **Transcription fetch failed / EAI_AGAIN:** Scaleway API calls are retried up to 3 times with a short delay; if it still fails, check DNS and network from the MCP container to `api.scaleway.ai`.

## Example test URLs

| Platform | URL |
|----------|-----|
| YouTube | `https://www.youtube.com/watch?v=jNQXAC9IVRw` |
| youtu.be | `https://youtu.be/jNQXAC9IVRw` |
| Vimeo | `https://vimeo.com/76979871` |

Full list and test scenarios: see repo `dev/yt-dlp`, `dev/ytptube` tests, `packages/librechat-init` agents.
