# MCP YTPTube

Media URL (video or audio) → transcript or download link. Uses YTPTube; optional OpenAI-compatible transcription API when platform subtitles are missing (otherwise clear error). This stack: Traefik exposes only `/api/download` for YTPTube; MCP internal.

**Status:** Works locally. On production (e.g. Hetzner), server IP may be blocked; optional [Webshare proxy](WEBSHARE_PROXY.md) or [FlareSolverr / office proxy ideas](YTPTUBE_FUTURE_WORK.md). The **Video-Transkripte** agent is in config with `public: false` until server-side access is reliable.

## Tools

**Request pattern:** `request_transcript` and `request_download_link` return result if present; else start job and return status. Poll with `get_status`; when finished, call the same request tool again.

| Tool | Args | Behavior |
|------|------|----------|
| `request_transcript` | media_url, preset?, language_hint?, cookies? | Transcript (video or audio-only URL). Resolve by URL; if finished → transcript; else status or POST + queued. **language_hint** (ISO-639-1); omit → `language=unknown` + instruction to ask user. **cookies?** Netscape format for age-restricted/login/403. |
| `request_download_link` | media_url, type? (video), preset?, cookies? | Download link (video/audio). Requires `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL`. |
| `get_status` | media_url? or job_id? (one required) | Status by **job_id** (UUID from prior response) or **media_url**. When finished, call request tool again. |
| `list_recent_downloads` | limit?, status_filter? (all\|finished\|queue) | Last N items; optional `download_url` when finished. |
| `get_media_info` | media_url | Metadata (title, duration, extractor) without downloading. |
| `get_thumbnail_url` | media_url | Thumbnail URL (yt-dlp; may be empty for audio-only). |
| `get_logs` | offset?, limit? (max 150) | Recent YTPTube application log lines. 404 when file logging disabled. |
| `get_system_configuration` | — | Instance overview: version, presets, queue count, history_count, paused, folders. |
| `get_history_item` | job_id | Full queue/history item by job_id (UUID from get_status or list_recent_downloads). |

## Response format

Key=value lines. **Transcript:** metadata block (`result=transcript`, `url`, `job_id`, `transcript_source`, `language?`, `language_instruction?`, `relay`) + transcript text. **Status:** `result=status`, `status`, `job_id?`, `url?`, `progress?`, `proxy_used?`, `attempt?`, `relay`. When we just queued the job, `proxy_used` (true/false) and `attempt` (1 or 2) are set so the LLM knows whether proxy was used and which attempt. **Error:** `result=error`, `relay=`.

## Transcript language

Without `language_hint`: responses include `language=unknown` and `language_instruction` (ask user, re-call with `language_hint`). With `language_hint`: sent to API for better accuracy.

## Cookies

Netscape HTTP Cookie format; first line `# HTTP Cookie File` or `# Netscape HTTP Cookie File`. Not stored server-side; reuse cookie content per request. Export: browser extension or `yt-dlp --cookies-from-browser … --cookies file.txt`. [yt-dlp FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp). Prompt `cookies_usage` in MCP for user-facing instructions.

## LibreChat

No automatic MCP polling. LLM asks user to request status; then calls `get_status` and replies. Do not promise to monitor automatically.

## Dependencies

- **YTPTube** – queues URLs, serves files. Set `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` so `request_download_link` returns valid links. [GitHub](https://github.com/ArabCoders/ytptube)
- **yt-dlp** – used by YTPTube. Supported sites: [dev/yt-dlp/supportedsites.md](dev/yt-dlp/supportedsites.md). MCP canonical keys (yt-dlp-aligned): YouTube, Instagram, TikTok, Douyin, Twitter/X, Vimeo, Twitch, Facebook, Reddit, Dailymotion, Bilibili, Rumble, SoundCloud, BitChute, 9GAG, Streamable, Wistia, PeerTube, Bandcamp, Odysee/LBRY, VK, Coub, Mixcloud, Imgur, Naver TV, Youku, Zhihu; others via normalized URL or YTPTube `archive_id`.
- **Transcription (optional)** – OpenAI-compatible `/audio/transcriptions`. Set `TRANSCRIPTION_BASE_URL` + `TRANSCRIPTION_API_KEY` to enable; else platform-subtitles-only and clear error when transcription would be needed. e.g. [Scaleway](https://www.scaleway.com/) `whisper-large-v3`.

## Standalone / other setups

Works with any YTPTube instance. Set `YTPTUBE_URL` (e.g. `http://localhost:8081`, `https://ytptube.example.com`). For `request_download_link`: `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL`. Other preset names: `YTPTUBE_PRESET_TRANSCRIPT`, `YTPTUBE_PRESET_VIDEO`, `YTPTUBE_SKIP_PRESET_SYNC=1`. Auth: `YTPTUBE_API_KEY`.

## Env

| Var | Description |
|-----|-------------|
| `YTPTUBE_URL` | YTPTube instance URL (default `http://ytptube:8081`). Any deployment. |
| `YTPTUBE_API_KEY` | Optional. YTPTube Basic auth. |
| `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` | Optional. Public base for download links (`request_download_link`). |
| `YTPTUBE_SUB_LANGS` | Optional. Subtitle langs (e.g. `en,en-US`). |
| `YTPTUBE_PRESET_TRANSCRIPT` | Transcript preset (default `mcp_audio`). See "Video after transcript". |
| `YTPTUBE_PRESET_VIDEO` | Video preset (default `default`). |
| `YTPTUBE_PROXY` | Optional. Proxy for yt-dlp (overrides Webshare). |
| `WEBSHARE_PROXY_USERNAME`, `WEBSHARE_PROXY_PASSWORD` | Optional. [WEBSHARE_PROXY.md](WEBSHARE_PROXY.md) |
| `TRANSCRIPTION_BASE_URL`, `TRANSCRIPTION_API_KEY` | Optional. Both set → audio transcription (OpenAI-compatible). |
| `TRANSCRIPTION_MODEL` | Optional (default `whisper-1`). e.g. `whisper-large-v3`. |
| `MCP_YTPTUBE_PORT` / `PORT` | HTTP port (default 3010). |
| `MCP_YTPTUBE_LOG_LEVEL` / `LOG_LEVEL` | Log level (default `info`). |
| `MCP_YTPTUBE_DEBUG_API` | `1` or `true` to log full YTPTube API responses. |
| `YTPTUBE_SKIP_PRESET_SYNC` | `1` or `true` to skip preset sync on startup. |
| `YTPTUBE_STARTUP_MAX_WAIT_MS` | Max ms wait for YTPTube at startup (default 5 min). |

YTPTube compose: `YTP_OUTPUT_TEMPLATE`/`YTP_OUTPUT_TEMPLATE_CHAPTER` set to short values to avoid "File name too long".

## Startup

Waits for YTPTube (GET api/ping/), then syncs transcript preset. Timeout: `YTPTUBE_STARTUP_MAX_WAIT_MS`. `YTPTUBE_SKIP_PRESET_SYNC=1` to skip.

## Transcript: subtitles vs audio

**Preferred:** Platform subtitles (VTT). When starting a transcript job, the MCP calls YTPTube/yt-dlp `url/info`; if `subtitles` or `automatic_captions` are present, it uses `--skip-download --write-subs --write-auto-subs` so manual and auto-generated captions (e.g. YouTube Shorts) are downloaded. No audio needed.

**Fallback:** No subtitles in yt-dlp info → transcript preset (audio). After download: prefer `.vtt`; if none or empty → transcription API when configured (`transcript_source=transcription`), else clear error (set `TRANSCRIPTION_BASE_URL`/`TRANSCRIPTION_API_KEY` or use media with subs). VTT with empty text → fallback to audio + transcription when configured.

**Path resolution:** Finished items: `item.filename`/`folder` when present; else file-browser. Subtitle/audio paths are resolved from the same folder; multiple candidates are matched by item (title slug, video_id, archive_id).

## Path resolution and video-only

Finished items: MCP uses `item.filename`/`folder` when present; else file-browser. **Video-only:** If URL was only downloaded as video, `request_transcript` starts a transcript job and returns `status=queued`; poll `get_status`, then call again for transcript.

## Video after transcript

Transcript jobs download only audio (saves bandwidth). To allow requesting the **video** later for the same URL, transcript jobs must use a preset that writes to a **separate archive** (e.g. `archive_audio.log`). The upstream default preset `audio_only` uses the main `archive.log` and is **not** suitable: the URL would be in the main archive and a later video request (preset `default`) would be skipped.

MCP ensures preset `mcp_audio` exists on startup. Manual: **POST /api/presets** with YTPTube auth. Body (Ogg Vorbis):

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

Match by URL, item identifiers, or **POST /api/yt-dlp/archive_id/** (any platform). Canonical keys (same URL → same key): YouTube, Instagram, TikTok, Douyin, Twitter/X, Vimeo, Twitch, Facebook, Reddit, Dailymotion, Bilibili, Rumble, SoundCloud, BitChute, 9GAG, Streamable, Wistia, PeerTube, Bandcamp, Odysee/LBRY, VK, Coub, Mixcloud, Imgur, Naver TV, Youku, Zhihu; generic URLs normalized (RFC 3986 dot-segments, no query). Protocol-relative URLs (`//...`) and typos (`httpss://`, `rmtp://`) are sanitized. Others: YTPTube `archive_id`. `get_status(media_url)` not_found → check URL form or timing; use `list_recent_downloads` and `MCP_YTPTUBE_DEBUG_API=1` + `LOG_LEVEL=debug` to inspect.

## Troubleshooting

- **After code changes:** Restart MCP server; reload MCP in Cursor.
- **Item not found:** URL format, item not in queue yet, or wrong YTPTube URL.
- **job_id:** Use internal UUID from responses, not platform video id.
- **status=error, No formats:** Geo-restricted, private, or unsupported; try cookies or another URL.
- **Transcription failed / EAI_AGAIN:** Retried 3×; check DNS/network to transcription API host.
- **Transcription not configured:** No platform subs and TRANSCRIPTION_* unset → clear error; set both vars or use media with subtitles.

## Example test URLs

| Platform | URL |
|----------|-----|
| YouTube | `https://www.youtube.com/watch?v=jNQXAC9IVRw` |
| youtu.be | `https://youtu.be/jNQXAC9IVRw` |
| Vimeo | `https://vimeo.com/76979871` |

Full list and test scenarios: see repo `dev/yt-dlp`, `dev/ytptube` tests, `packages/librechat-init` agents.
