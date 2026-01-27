# MCP YTPTube

YTPTube-backed MCP server. Video URL → transcript (YTPTube fetches audio; Scaleway transcribes). Internal only (no Traefik). Focus is on transcripts for now; more YTPTube-specific features can be added later.

## Tools

| Tool | Args | Behavior |
|------|------|----------|
| `request_video_transcript` | video_url, preset?, language_hint? | Resolve by URL. If finished → transcript (TRANSCRIPT_READY). If downloading/queued → DOWNLOAD_IN_PROGRESS or DOWNLOAD_QUEUED + job_id; no blocking. If not found → POST to YTPTube, return DOWNLOAD_QUEUED. |
| `get_transcript_status` | job_id?, video_url? (one required) | Look up by job_id or video_url (GET /api/history). Return STATUS, progress %, and "Tell the user" line. Use when user asks "status" or "progress"; if finished, tell them to request the transcript. |

## Dependencies

- **YTPTube** – queues URLs, serves audio via HTTP (no shared volume). Local: Web UI at `http://ytptube.{DOMAIN}`; prod/dev: internal only. [GitHub](https://github.com/ArabCoders/ytptube)
- **Scaleway** – `SCALEWAY_BASE_URL` + `SCALEWAY_API_KEY`, OpenAI-compatible `/audio/transcriptions` (e.g. whisper-large-v3).

## Env (MCP + Compose)

| Var | Description |
|-----|-------------|
| `YTPTUBE_URL` | Base URL (default `http://ytptube:8081`). |
| `YTPTUBE_API_KEY` | Optional; Base64(username:password) when YTPTube uses auth. |
| `SCALEWAY_BASE_URL`, `SCALEWAY_API_KEY` | Required for transcription. |
| `MCP_YTPTUBE_PORT` / `PORT` | HTTP port (default 3010). |
| `MCP_YTPTUBE_LOG_LEVEL` / `LOG_LEVEL` | Log level (default `info`). |

## Troubleshooting

- **"Item not found" / 404:** Possible causes: URL format, item not yet in queue, or wrong YTPTube URL. After adding a URL, the item id is resolved via GET /api/history?type=queue; if not in queue, the tool checks GET /api/history?type=done (already in archive). If problems persist, check YTPTube logs and queue.
- **URL matching:** URLs are matched exactly as sent; no normalization. Use the same URL the user provided when asking for status or transcript.

## Future (not in v1)

- **Stream-through:** Pipe YTPTube download → Scaleway request to avoid buffering full audio.
- **Chunking:** If model has length limits, split by silence/duration, transcribe segments, concatenate.
- **MCP progress:** Use `progressToken` / `notifications/progress` while waiting on YTPTube ([spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/progress)).
- **More YTPTube features:** Package is named mcp-ytptube to allow adding further YTPTube-specific tools later.
