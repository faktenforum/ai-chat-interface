# MCP YTPTube

**Video URL → transcript or download link.** MCP server that uses [YTPTube](https://github.com/ArabCoders/ytptube) and [Scaleway](https://www.scaleway.com/) STT; works with any site [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports (YouTube, Vimeo, TikTok, …). Code layout: `server.ts` wires tools and HTTP; `instructions.ts` holds LLM-facing copy; `schemas/` and `tools/` align with tool names (e.g. `request-video-transcript.schema.ts` ↔ `request_video_transcript`).

- **Transcripts** — Platform subtitles or Scaleway Whisper; optional `language_hint` and cookies.
- **Download links** — Video or audio URL; same request–poll–retrieve flow.
- **Multi-platform** — Any yt-dlp-supported site; optional cookies for age-restricted/geo-blocked.
- **Stateless HTTP** — Streamable-http transport, health check, structured logging (Pino).

---

## Tools

| Tool | What it does |
|------|----------------|
| `request_video_transcript` | Get transcript (platform subs or Scaleway). Not ready → status; poll `get_status`, then call again. |
| `request_download_link` | Get download URL (video or audio). Same flow: request → poll → call again. |
| `get_status` | Poll by `video_url` or `job_id` (UUID from a prior response). |
| `list_recent_downloads` | List last N queue/history items. |
| `get_video_info` | Metadata (title, duration) without downloading. |
| `get_thumbnail_url` | Thumbnail URL for the video. |

Optional args: **language_hint** (e.g. `de`), **cookies** (Netscape format) for age-restricted or geo-blocked videos. Details → [docs/MCP_YTPTUBE.md](../../docs/MCP_YTPTUBE.md).

---

## Quick start

```bash
npm install && npm run dev
# with local env: npm run dev:local
```

| Env | Purpose |
|-----|--------|
| `YTPTUBE_URL` | YTPTube base URL (required) |
| `SCALEWAY_BASE_URL`, `SCALEWAY_API_KEY` | Transcription (required) |
| `YTPTUBE_API_KEY` | Optional Basic auth |
| `YTPTUBE_PRESET_TRANSCRIPT` | Preset for transcript jobs (default `mcp_audio`; see below) |
| `YTPTUBE_PRESET_VIDEO` | Preset for video download jobs (default `default`) |
| `YTPTUBE_SKIP_PRESET_SYNC` | `1` or `true` to skip preset sync on startup |
| `YTPTUBE_STARTUP_MAX_WAIT_MS` | Max ms to wait for YTPTube at startup (default 5 min) |
| `PORT` / `MCP_YTPTUBE_PORT` | HTTP port (default `3010`) |

Full config, Docker, cookies, troubleshooting: **[docs/MCP_YTPTUBE.md](../../docs/MCP_YTPTUBE.md)**.

**Startup:** Waits for YTPTube, then syncs the transcript preset. `YTPTUBE_SKIP_PRESET_SYNC=1` to skip.

**Video after transcript:** Transcript jobs use a separate archive (`archive_audio.log`) so the same URL can later be requested as video. Preset JSON (Ogg Vorbis for Scaleway): see [docs/MCP_YTPTUBE.md](../../docs/MCP_YTPTUBE.md#video-after-transcript).

---

## License

MIT
