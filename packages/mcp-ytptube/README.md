# YTPTube MCP Server

MCP server for [YTPTube](https://github.com/ArabCoders/ytptube): media URL → transcript or download link. Any [yt-dlp](https://github.com/yt-dlp/yt-dlp)-supported URL. [MCP](https://modelcontextprotocol.io/) client (Cursor, LibreChat, etc.).

Connects to YTPTube at `YTPTUBE_URL` (default `http://ytptube:8081`). Optional OpenAI-compatible transcription when platform subtitles are missing.

## Tools

| Tool | Description |
|------|-------------|
| `request_transcript` | Transcript (platform subs or transcription API). If not ready → status; poll `get_status`, then call again. |
| `request_download_link` | Download URL (video or audio). Same flow: request → poll → call again. |
| `get_status` | Poll by `media_url` or `job_id` (UUID). |
| `list_recent_downloads` | Last N queue/history items. |
| `get_media_info` | Metadata without downloading. |
| `get_thumbnail_url` | Thumbnail URL (may be empty for audio-only). |
| `get_logs` | YTPTube application logs (404 when file logging disabled). |
| `get_system_configuration` | Instance overview (version, presets, queue, folders). |
| `get_history_item` | Full item by `job_id`. |

Options: **language_hint** (e.g. `de`), **cookies** (Netscape). Full reference: [docs/MCP_YTPTUBE.md](../../docs/MCP_YTPTUBE.md).

## Quick start

```bash
npm install && npm run dev
# with local env: npm run dev:local
```

**Env:** `YTPTUBE_URL`, `TRANSCRIPTION_BASE_URL` + `TRANSCRIPTION_API_KEY` (optional), `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` (for download links), `YTPTUBE_API_KEY`, `WEBSHARE_PROXY_*` / `YTPTUBE_PROXY`. See [docs/MCP_YTPTUBE.md](../../docs/MCP_YTPTUBE.md#env).

## License

MIT
