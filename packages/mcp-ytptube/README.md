# MCP YTPTube

MCP server for YTPTube: video URL → transcript (YTPTube audio + Scaleway STT). Focus is on transcripts for now; more YTPTube-specific features can be added later.

**Tools:** `request_video_transcript` (video_url, preset?, language_hint?), `get_transcript_status` (job_id?, video_url?).

**Env:** `YTPTUBE_URL`, `SCALEWAY_BASE_URL`, `SCALEWAY_API_KEY`; optional `YTPTUBE_API_KEY` for Basic auth. `PORT` / `MCP_YTPTUBE_PORT` (default 3010), `MCP_YTPTUBE_LOG_LEVEL` / `LOG_LEVEL`.

```bash
npm install && npm run dev
# or: npm run dev:local  (loads ../../.env.local)
```

See [docs/MCP_YTPTUBE.md](../../docs/MCP_YTPTUBE.md) for stack integration and future optimizations.
