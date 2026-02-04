# YTPTube MCP Server

MCP server for [YTPTube](https://github.com/ArabCoders/ytptube): media URL → transcript or download link. Works with any [yt-dlp](https://github.com/yt-dlp/yt-dlp)-supported URL. Use from Cursor, Claude Desktop, LibreChat, or any [MCP](https://modelcontextprotocol.io/) client.

Connects to your YTPTube instance (`YTPTUBE_URL`; default `http://ytptube:8081` for Docker). Optional: any OpenAI-compatible transcription API when platform subtitles are missing. Standalone: point `YTPTUBE_URL` at your instance (e.g. `http://localhost:8081`, `https://ytptube.example.com`).

## Features

- **Media info** — Title, duration, extractor; no download required (`get_media_info`, `get_thumbnail_url`).
- **Transcripts** — Platform subtitles (VTT) when available; else optional OpenAI-compatible transcription API. `language_hint`, cookies for age-restricted/geo-blocked. Without transcription config: platform subtitles only; audio-only without subs returns a clear error.
- **Download links** — Request → poll → retrieve (video or audio).
- **Multi-platform** — Any [yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) site (YouTube, SoundCloud, Vimeo, TikTok, etc.).
- **Webshare proxy** — Optional [Webshare](https://www.webshare.io/) proxy to bypass IP blocks; [WEBSHARE_PROXY.md](../../docs/WEBSHARE_PROXY.md). For production/server blocking and future options (FlareSolverr, office Pi): [YTPTUBE_FUTURE_WORK.md](../../docs/YTPTUBE_FUTURE_WORK.md).
- **Stateless HTTP** — Streamable-http, health check, Pino logging.

## Tools

| Tool | Description |
|------|-------------|
| `request_transcript` | Get transcript (platform subs or transcription API). If not ready → status; poll `get_status`, then call again. |
| `request_download_link` | Get download URL (video or audio). Same flow: request → poll → call again. |
| `get_status` | Poll by `media_url` or `job_id` (UUID from a prior response). |
| `list_recent_downloads` | List last N queue/history items. |
| `get_media_info` | Metadata (title, duration) without downloading. |
| `get_thumbnail_url` | Thumbnail URL (may be empty for audio-only). |
| `get_logs` | Recent YTPTube application logs (offset, limit). For debugging; 404 when file logging disabled. |
| `get_system_configuration` | Instance overview: version, presets, queue count, history_count, paused, folders. |
| `get_history_item` | Full details of one queue/history item by `job_id` (from `get_status` or `list_recent_downloads`). |

Optional: **language_hint** (e.g. `de`), **cookies** (Netscape). Details: [MCP_YTPTUBE.md](../../docs/MCP_YTPTUBE.md).

---

## Quick start

```bash
npm install && npm run dev
# with local env: npm run dev:local
```

| Env | Purpose |
|-----|--------|
| `YTPTUBE_URL` | YTPTube instance URL (default `http://ytptube:8081`). Any deployment: `http://localhost:8081`, `https://ytptube.example.com`, etc. |
| `TRANSCRIPTION_BASE_URL`, `TRANSCRIPTION_API_KEY` | Optional. Both set → audio transcription (OpenAI-compatible, e.g. Scaleway). |
| `TRANSCRIPTION_MODEL` | Optional (default `whisper-1`). e.g. `whisper-large-v3` for Scaleway. |
| `YTPTUBE_API_KEY` | Optional. YTPTube Basic auth. |
| `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` | Optional. Public URL for `request_download_link` (where clients reach YTPTube). |
| `YTPTUBE_PRESET_TRANSCRIPT`, `YTPTUBE_PRESET_VIDEO` | Preset names (defaults `mcp_audio`, `default`). |
| `YTPTUBE_SKIP_PRESET_SYNC` | `1` or `true` to skip preset sync on startup. |
| `WEBSHARE_PROXY_*`, `YTPTUBE_PROXY` | Optional proxy; [WEBSHARE_PROXY.md](../../docs/WEBSHARE_PROXY.md). When running in Docker, pass `--env-file .env.local` so these (and other) env vars are applied on up/rebuild. |
| `YTPTUBE_STARTUP_MAX_WAIT_MS` | Max ms wait for YTPTube at startup (default 5 min). |
| `PORT` / `MCP_YTPTUBE_PORT` | HTTP port (default `3010`). |

Full reference: [MCP_YTPTUBE.md](../../docs/MCP_YTPTUBE.md). Startup: waits for YTPTube, syncs transcript preset unless `YTPTUBE_SKIP_PRESET_SYNC=1`. Video after transcript: [preset JSON](../../docs/MCP_YTPTUBE.md#video-after-transcript).

---

## License

MIT
