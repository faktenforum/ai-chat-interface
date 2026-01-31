# MCP YTPTube

MCP server for YTPTube: video URL → transcript (YTPTube audio + Scaleway STT). Focus is on transcripts for now; more YTPTube-specific features can be added later.

**Tools:** `request_video_transcript`, `request_download_link`, `get_status`, `list_recent_downloads`, `get_video_info`, `get_thumbnail_url`. Both request tools return result or status; use `get_status` to poll; when finished call the same request tool again for transcript or link.

**Env:** `YTPTUBE_URL`, `SCALEWAY_BASE_URL`, `SCALEWAY_API_KEY`; optional `YTPTUBE_API_KEY` for Basic auth. `PORT` / `MCP_YTPTUBE_PORT` (default 3010), `MCP_YTPTUBE_LOG_LEVEL` / `LOG_LEVEL`.

```bash
npm install && npm run dev
# or: npm run dev:local  (loads ../../.env.local)
```

See [docs/MCP_YTPTUBE.md](../../docs/MCP_YTPTUBE.md) for stack integration and future optimizations.
