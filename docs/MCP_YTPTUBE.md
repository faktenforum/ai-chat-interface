# MCP YTPTube

YTPTube-backed MCP server. Video URL → transcript (YTPTube fetches audio; Scaleway transcribes). Prod/dev: Traefik exposes only `/api/download` for YTPTube; MCP is internal.

## Tools

| Tool | Args | Behavior |
|------|------|----------|
| `request_video_transcript` | video_url, preset?, language_hint? | Resolve by URL. If finished → result=transcript (metadata + transcript block). If not → result=status (queued\|downloading). If not found → POST to YTPTube, return queued. Optional: `YTPTUBE_PROXY` appends `--proxy` to yt-dlp. |
| `get_transcript_status` | video_url?, job_id? (one required) | Look up by video_url (preferred) or job_id. Returns result=status, relay. Use video_url from prior response for reliable lookup. |
| `get_video_download_link` | video_url?, job_id?, type? (default audio) | Direct download link for a **finished** item. Requires `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL`. Returns `download_url=` with `?apikey=` when YTPTube uses auth. |
| `list_recent_downloads` | limit? (default 10), status_filter? (all\|finished\|queue) | Last N history items (queue/done) with title, status, optional `download_url` when finished. |
| `get_video_info` | video_url | Metadata (title, duration, extractor) for a URL without downloading – preview before download. |
| `get_thumbnail_url` | video_url | Link to the video thumbnail (from yt-dlp info; for preview/UI). |

## Response format

Key=value header lines; high information density:

- **Transcript:** Two content blocks: (1) metadata `result=transcript`, `url`, `job_id`, `status_url?`, `relay`; (2) transcript text.
- **Status:** `result=status`, `status=queued|downloading|finished|error|not_found`, `job_id?`, `url?`, `status_url?`, `progress?`, `reason?`, `relay`. Use **url** or **status_url** as `video_url` in `get_transcript_status`; do not use `job_id` for status (often a video id, lookup fails).
- **Error:** `result=error`, `relay=`.

## Dependencies

- **YTPTube** – queues URLs, serves audio via HTTP (no shared volume). Local: Web UI at `http://ytptube.{DOMAIN}`; prod/dev: only `https://ytptube.{DOMAIN}/api/download/*` exposed via Traefik (download-only router). Set `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL=https://ytptube.${DOMAIN}` in Portainer so `get_video_download_link` returns valid links. [GitHub](https://github.com/ArabCoders/ytptube)
- **Scaleway** – `SCALEWAY_BASE_URL` + `SCALEWAY_API_KEY`, OpenAI-compatible `/audio/transcriptions` (e.g. whisper-large-v3).

## Env (MCP + Compose)

| Var | Description |
|-----|-------------|
| `YTPTUBE_URL` | Base URL (default `http://ytptube:8081`). |
| `YTPTUBE_API_KEY` | Optional; Base64(username:password) when YTPTube uses auth. Required for download links when YTPTube has auth. |
| `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` | Optional. Public base URL for download links (e.g. `https://ytptube.${DOMAIN}`). Set in prod/dev so `get_video_download_link` returns working links. |
| `YTPTUBE_PROXY` | Optional. Proxy URL for yt-dlp (e.g. for Hetzner IP blocking). Appended as `--proxy <value>` to POST /api/history cli. Store in env only. |
| `SCALEWAY_BASE_URL`, `SCALEWAY_API_KEY` | Required for transcription. |
| `MCP_YTPTUBE_PORT` / `PORT` | HTTP port (default 3010). |
| `MCP_YTPTUBE_LOG_LEVEL` / `LOG_LEVEL` | Log level (default `info`). |
| `MCP_YTPTUBE_DEBUG_API` | Set to `1` or `true` to log full YTPTube API responses and **each item's keys/sample**. Set **`MCP_YTPTUBE_LOG_LEVEL=debug`** (or `LOG_LEVEL=debug`) so those logs appear. Use to see which fields YTPTube returns (e.g. `archive_id`, `id`, `url`). |

## URL matching

Items are matched by URL, by YTPTube identifiers on the item, or by **archive_id** from the YTPTube API so that **all platforms** (including those without MCP canonical key rules) work:

- **From item (queue/history):** `archive_id` (e.g. `"youtube jNQXAC9IVRw"`, `"Facebook 1678716196448181"`) → normalized to `extractor:video_id`. Fallbacks: `extractor_key`, then `extractor` + `video_id`/`id`.
- **From request URL:** Canonical key for known platforms (YouTube, Instagram, TikTok, Facebook); otherwise normalized origin+pathname (www stripped).
- **Fallback for any URL:** If URL/item match fails, MCP calls **POST /api/yt-dlp/archive_id/** with the video URL. YTPTube returns the canonical `archive_id` for that URL (any platform). MCP normalizes it and matches items by that key. No platform-specific rules needed; works for Facebook, Vimeo, etc.

POST /api/history may return the existing item when the video is already in YTPTube; MCP uses that (and single-item fallback) to return transcript or status without failing.

## Troubleshooting

- **Item not found / 404:** URL format, item not in queue yet, or wrong YTPTube URL. Tool resolves via queue then done; check YTPTube logs if it persists.
- **POST ok but item not in queue yet:** Tool still returns `result=status` with `url=` (the video URL you sent); use that as `video_url` in `get_transcript_status` to poll until the download appears.
- **get_transcript_status(job_id) not_found:** Use `video_url` (exact `url` or `status_url` from prior response); `job_id` is often the platform video id, not internal id.
- **URL mismatch:** Set `MCP_YTPTUBE_DEBUG_API=1` and `LOG_LEVEL=debug`, then inspect `docker logs mcp-ytptube` for API item keys/sample to extend `canonicalKeyFromItem()` if needed.

## Future (not in v1)

- **Stream-through:** Pipe YTPTube download → Scaleway request to avoid buffering full audio.
- **Chunking:** If model has length limits, split by silence/duration, transcribe segments, concatenate.
- **MCP progress:** Use `progressToken` / `notifications/progress` while waiting on YTPTube ([spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/progress)).
- **More YTPTube features:** Package is named mcp-ytptube to allow adding further YTPTube-specific tools later.
