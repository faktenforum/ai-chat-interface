# MCP YTPTube

MCP server that turns **video URLs into transcripts** and **download links**. Uses [YTPTube](https://github.com/ArabCoders/ytptube) for fetching and [Scaleway](https://www.scaleway.com/) for speech-to-text; supports any site [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports (YouTube, Vimeo, TikTok, etc.).

## What it does

- **Transcripts** – Send a video URL; get platform subtitles or transcribed audio (Scaleway Whisper).
- **Download links** – Request a video or audio download URL for the same backends.
- **Metadata & thumbnails** – `get_video_info` and `get_thumbnail_url` without starting a job.
- **Status** – Poll job status by `video_url` or `job_id`; when finished, call the same request tool again for transcript or link.

Ideal for AI assistants that need to read or reference video content, or to hand users direct download links.

## Tools

| Tool | Purpose |
|------|--------|
| `request_video_transcript` | Get transcript (subs or transcription). If not ready → returns status; poll with `get_status`, then call again. |
| `request_download_link` | Get download URL (video or audio). Same request-then-poll pattern. |
| `get_status` | Poll by `video_url` or `job_id` (UUID from a prior response). |
| `list_recent_downloads` | List recent queue/history items. |
| `get_video_info` | Metadata (title, duration, extractor) without downloading. |
| `get_thumbnail_url` | Thumbnail URL for the video. |

Optional: **language_hint** (e.g. `de`) and **cookies** (Netscape format) for better accuracy and age-restricted/login/geo-blocked videos. See [docs/MCP_YTPTUBE.md](../../docs/MCP_YTPTUBE.md) for details.

## Quick start

```bash
npm install
npm run dev
# or with local env: npm run dev:local
```

**Required env:** `YTPTUBE_URL`, `SCALEWAY_BASE_URL`, `SCALEWAY_API_KEY`.  
**Optional:** `YTPTUBE_API_KEY` (Basic auth), `PORT` / `MCP_YTPTUBE_PORT` (default `3010`), `MCP_YTPTUBE_LOG_LEVEL` / `LOG_LEVEL`.

Full env and stack integration (Docker, cookies, platforms, troubleshooting): **[docs/MCP_YTPTUBE.md](../../docs/MCP_YTPTUBE.md)**.

## Features

- Stateless HTTP transport (streamable-http)
- Unified status for transcript and download jobs
- Multi-platform URLs via YTPTube/yt-dlp
- Optional cookies for 403 / age-restricted / geo-blocked
- Structured logging (Pino), health check, graceful shutdown

## License

MIT
