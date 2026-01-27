# MCP Video Transcripts

MCP server: video URL → transcript (YTPTube audio + Scaleway STT).

**Tools:** `request_video_transcript` (video_url, preset?, language_hint?), `get_transcript_status` (job_id?, video_url?).

**Env:** `YTPTUBE_URL`, `SCALEWAY_BASE_URL`, `SCALEWAY_API_KEY`; optional `YTPTUBE_API_KEY` for Basic auth. `PORT` / `MCP_VIDEO_TRANSCRIPTS_PORT` (default 3010), `LOG_LEVEL`.

```bash
npm install && npm run dev
# or: npm run dev:local  (loads ../../.env.local)
```

See [docs/MCP_VIDEO_TRANSCRIPTS.md](../../docs/MCP_VIDEO_TRANSCRIPTS.md) for stack integration and future optimizations.
