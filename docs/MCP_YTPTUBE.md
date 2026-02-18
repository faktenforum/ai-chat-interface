# MCP YTPTube

Media URL (video or audio) → transcript or download link. Uses YTPTube; optional OpenAI-compatible transcription API when platform subtitles are missing (otherwise clear error). This stack: Traefik exposes only `/api/download` for YTPTube; MCP internal.

## Status & limitations

- **Local:** Works; Video-Transkripte agent is in config with `public: false`.
- **Production (e.g. Hetzner):** Server IP can be blocked (geo/bot); optional [Webshare proxy](WEBSHARE_PROXY.md) or [FlareSolverr / office proxy ideas](wip/YTPTUBE_FUTURE_WORK.md).
- **More:** [wip/YTPTUBE_FUTURE_WORK.md](wip/YTPTUBE_FUTURE_WORK.md) (production options), [WEBSHARE_PROXY.md](WEBSHARE_PROXY.md) (proxy setup), [YTPTUBE_CLEANUP.md](YTPTUBE_CLEANUP.md) (cleanup for fresh tests).

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

Without `language_hint`: responses include `language=unknown` and `language_instruction` (ask user, re-call with `language_hint`). With `language_hint`:
- **Phase 1 (subs):** Overrides preset's `--sub-langs` to prefer that language (e.g. `language_hint="de"` → `--sub-langs "de,-live_chat"`), and subtitle file resolution prefers language-matched files (e.g. `*.de.vtt`)
- **Phase 2 (audio):** Sent to transcription API for better accuracy

## Cookies

Netscape HTTP Cookie format; first line `# HTTP Cookie File` or `# Netscape HTTP Cookie File`. Not stored server-side; reuse cookie content per request. Export: browser extension or `yt-dlp --cookies-from-browser … --cookies file.txt`. [yt-dlp FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp). Prompt `cookies_usage` in MCP for user-facing instructions.

## LibreChat

No automatic MCP polling. LLM asks user to request status; then calls `get_status` and replies. Do not promise to monitor automatically.

## Dependencies

- **YTPTube** – queues URLs, serves files. `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` required for `request_download_link` links. [GitHub](https://github.com/ArabCoders/ytptube)
- **yt-dlp** – used by YTPTube. Supported sites: [dev/yt-dlp/supportedsites.md](dev/yt-dlp/supportedsites.md). MCP matches by canonical key (platform-specific or normalized URL) and YTPTube `archive_id`.
- **Transcription (optional)** – OpenAI-compatible `/audio/transcriptions`. Set both `TRANSCRIPTION_BASE_URL` and `TRANSCRIPTION_API_KEY`; else platform subtitles only, with clear error when transcription would be needed (e.g. [Scaleway](https://www.scaleway.com/) whisper-large-v3).

## Standalone / other setups

Works with any YTPTube instance. Set `YTPTUBE_URL` (e.g. `http://localhost:8081`, `https://ytptube.example.com`). For `request_download_link`: `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL`. Other preset names: `YTPTUBE_PRESET_TRANSCRIPT`, `YTPTUBE_PRESET_VIDEO`, `YTPTUBE_SKIP_PRESET_SYNC=1`. Auth: `YTPTUBE_API_KEY`.

## Env

| Var | Description |
|-----|-------------|
| `YTPTUBE_URL` | YTPTube instance URL (default `http://ytptube:8081`). Any deployment. |
| `YTPTUBE_API_KEY` | Optional. YTPTube Basic auth. |
| `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` | Optional. Public base for download links (`request_download_link`). |
| `YTPTUBE_PRESET_SUBS` | Subtitle-only preset (default `mcp_subs`). Auto-synced at startup. |
| `YTPTUBE_PRESET_AUDIO` | Audio extraction preset (default `mcp_audio`). Backward-compatible with `YTPTUBE_PRESET_TRANSCRIPT`. Auto-synced at startup. |
| `YTPTUBE_PRESET_VIDEO` | Video preset (default `default`). Not managed by MCP. |
| `TRANSCRIPTION_MAX_BYTES` | Max file size for transcription API (default `26214400` = 25MB, OpenAI Whisper limit). |
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

The HTTP server listens on port 3010 **immediately** so the container becomes healthy quickly and LibreChat is not blocked. YTPTube reachability (GET api/ping/) and transcript preset sync run **in the background**; on failure they are logged only (no exit). Tools return normal errors until YTPTube is up. Timeout for background wait: `YTPTUBE_STARTUP_MAX_WAIT_MS`. `YTPTUBE_SKIP_PRESET_SYNC=1` to skip preset sync.

## Transcript: two-phase flow (subtitles-first)

**Phase 1: Subtitles-only (preferred)**  
The MCP determines transcript mode by calling YTPTube/yt-dlp `url/info`. If `subtitles`/`automatic_captions` are present, or if the extractor is `youtube` (even without explicit subtitle fields), or if the URL canonical key starts with `youtube:`, it starts a **subtitle-only job** using the `mcp_subs` preset:
- `--skip-download --write-subs --write-auto-subs --sub-format vtt --convert-subs vtt --sub-langs "all,-live_chat"`
- **No archive** (so the same URL can later be downloaded as audio/video)
- When finished: finds `.vtt` or `.srt` files, parses, returns `transcript_source=platform_subtitles`
- If `language_hint` is provided, prefers subtitle files matching that language (e.g. `*.de.vtt` when `language_hint="de"`)

**Phase 2: Audio transcription (fallback)**  
If Phase 1 fails (no subtitle file found, empty, or unparseable), or if subtitles are not available, the MCP starts an **audio extraction job** using the `mcp_audio` preset:
- `--extract-audio --audio-format vorbis` (Scaleway-compatible) + `archive_audio.log` (separate archive)
- When finished: checks file size against `TRANSCRIPTION_MAX_BYTES` (default 25MB); if too large, returns clear error
- If size OK: calls transcription API when configured (`transcript_source=transcription`), else clear error

**Path resolution:** Finished items use `item.filename`/`folder` when present, else file-browser; subtitle/audio paths from same folder, matched by title slug, video_id, archive_id, or language hint. **Video-only:** If the URL was only downloaded as video, `request_transcript` starts Phase 1 (subs) and returns `status=queued`; poll `get_status`, then call again for transcript.

## Presets (auto-synced at startup)

The MCP ensures three presets exist and match their canonical definitions:

**`mcp_subs`** (subtitle-only, Phase 1)
- CLI: `--skip-download --write-subs --write-auto-subs --sub-format vtt --convert-subs vtt --sub-langs "all,-live_chat"`
- **No archive** (so subtitle-only jobs don't mark URLs as "downloaded")
- Used for captions-first transcript jobs

**`mcp_audio`** (audio extraction, Phase 2 fallback + audio download links)
- CLI: `--socket-timeout 30 --download-archive %(config_path)s/archive_audio.log --extract-audio --audio-format vorbis --add-chapters --embed-metadata --format 'bestaudio/best'`
- **Separate archive** (`archive_audio.log`) so the same URL can later be downloaded as video
- Used for transcription fallback and `request_download_link type=audio`

**`default`** (video downloads)
- Not managed by MCP (YTPTube built-in)
- Used for `request_download_link type=video`

**Preset sync:** On startup, the MCP calls `ensureAllMcpPresets()` which creates `mcp_subs` and `mcp_audio` if missing, or updates them if CLI/description/priority differ. Set `YTPTUBE_SKIP_PRESET_SYNC=1` to skip. The `cli` field in `POST /api/history` is **proxy-only** (`--proxy URL` or empty); all yt-dlp configuration lives in the preset to avoid User > Preset > Default priority conflicts.

## URL matching

Match by URL, item identifiers, or **POST /api/yt-dlp/archive_id/** (any platform). Canonical keys: major platforms (YouTube, Instagram, TikTok, Vimeo, etc.) plus normalized URL fallback; protocol-relative and typos sanitized. Not found → check URL form/timing; debug: `list_recent_downloads`, `MCP_YTPTUBE_DEBUG_API=1`, `LOG_LEVEL=debug`.

## Troubleshooting

- **After code changes:** Restart MCP server; reload MCP in Cursor.
- **Item not found:** URL format, item not in queue yet, or wrong YTPTube URL.
- **job_id:** Use internal UUID from responses, not platform video id.
- **status=error, No formats:** Geo-restricted, private, or unsupported; try cookies or another URL.
- **Transcription failed / EAI_AGAIN:** Retried 3×; check DNS/network to transcription API host.
- **Transcription not configured:** No platform subs and TRANSCRIPTION_* unset → clear error; set both vars or use media with subtitles.
- **Audio file too large for transcription:** File exceeds `TRANSCRIPTION_MAX_BYTES` (default 25MB); try a shorter video or use media with platform subtitles.

### LibreChat: "fetch failed" / "Failed to connect to MCP server ytptube" (Portainer dev/prod)

LibreChat reaches the MCP at `http://mcp-ytptube:3010/mcp` over Docker network `app-net`. If you see **fetch failed** or **Failed to connect after 3 attempts**:

1. **Start order**  
   mcp-ytptube listens on port 3010 immediately (YTPTube wait and preset sync run in the background) and becomes healthy within ~10s. In **dev** and **prod** compose, `api` has `depends_on: mcp-ytptube: condition: service_healthy` so LibreChat starts only after mcp-ytptube is healthy. That avoids "fetch failed" at startup (LibreChat's MCP client can race with mcp-ytptube if both start in parallel).

2. **Container running and healthy**  
   In Portainer → Stack → your stack → check that the **mcp-ytptube** container (e.g. `dev-mcp-ytptube`) is **Running** and **healthy**. If it is **Exited** or **Unhealthy**, open its logs and fix the cause (e.g. env, YTPTube not reachable at `ytptube:8081`).

3. **Dev stack: image tag**  
   Dev compose uses `ghcr.io/faktenforum/mcp-ytptube:dev`. That image is built by GitHub Actions on **non-default branches** (see `.github/workflows/build-mcp-ytptube.yml`). Ensure the workflow has run for your branch and the `:dev` image exists; otherwise the container may fail to start or be missing.

4. **Same network**  
   Both LibreChat (`api`) and `mcp-ytptube` must be on **app-net** (in dev/prod the network is named `${STACK_NAME}-app-net`). The compose files set this explicitly; if you use a custom compose, keep `networks: - app-net` for both services.

### Debugging connectivity (Portainer / CLI)

Run these from the **host** (replace `dev` with your stack name if different, e.g. `prod`).

**1. From LibreChat container: can it reach mcp-ytptube?**

```bash
# Health (run and note the output: status code + body, or "Error: ...")
docker exec dev-librechat node -e "require('http').get('http://mcp-ytptube:3010/health', (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>console.log(r.statusCode, d)); }).on('error', e => console.error('Error:', e.message));"
```

- If you see **`200 { ... "status":"ok" ... }`**: connectivity from LibreChat to mcp-ytptube works; the "fetch failed" in LibreChat may be due to how/when the MCP client connects (e.g. timing or the `/mcp` request).
- If you see **`Error: getaddrinfo ENOTFOUND mcp-ytptube`**: DNS resolution failed; check step 4 (same network).
- If you see **`Error: connect ECONNREFUSED`**: mcp-ytptube is not listening on 3010 or is on a different network.
- If the command hangs or times out: firewall or mcp-ytptube not responding.

**2. From LibreChat container: DNS and network**

```bash
# Resolve hostname (should list the mcp-ytptube container IP)
docker exec dev-librechat getent hosts mcp-ytptube

# Or with Node (LibreChat has Node)
docker exec dev-librechat node -e "require('http').get('http://mcp-ytptube:3010/health', (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>console.log(r.statusCode, d)); }).on('error', e => console.error('Error:', e.message));"
```

**3. From mcp-ytptube container: is it listening?**

```bash
# Process listening on 3010
docker exec dev-mcp-ytptube netstat -tlnp 2>/dev/null || docker exec dev-mcp-ytptube ss -tlnp
```

**4. Both containers on the same network?**

```bash
# Network name (e.g. dev-app-net)
docker network ls | grep app-net

# Inspect network: both dev-librechat and dev-mcp-ytptube should be listed
docker network inspect dev-app-net --format '{{range .Containers}}{{.Name}} {{end}}'
```

**5. From host: direct health check**

```bash
# Only works if mcp-ytptube publishes port 3010 to host (dev/prod typically do not)
curl -s http://localhost:3010/health
```

If step 1 fails and step 4 shows both containers on the same network, restart the mcp-ytptube container and retry; if it still fails, check mcp-ytptube logs for bind errors or early exit.

**Other MCP log messages:** "SSE stream disconnected" / "SSE stream not available (404)" for other MCPs (e.g. db-timetable, weather, stackoverflow, npm-search) are a known LibreChat/client behaviour; see [TODO.md](TODO.md) (SSE stream disconnection). Servers that only support streamable-http may log 404 for SSE; LibreChat continues with POST. If a specific MCP keeps failing, check that its container is running and on **app-net** as above.

## Example test URLs

| Platform | URL |
|----------|-----|
| YouTube | `https://www.youtube.com/watch?v=jNQXAC9IVRw` |
| youtu.be | `https://youtu.be/jNQXAC9IVRw` |
| Vimeo | `https://vimeo.com/76979871` |

Full list and test scenarios: see repo `dev/yt-dlp`, `dev/ytptube` tests, `packages/librechat-init` agents.
