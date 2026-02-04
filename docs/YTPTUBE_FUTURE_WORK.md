# YTPTube / Video Transcripts – Future Work

Current status and options for improving video transcripts and downloads in production (e.g. on a Hetzner server).

## Current status

- **Local:** YTPTube and MCP YTPTube work; the **Video-Transkripte** agent is in the codebase but **not public** (`public: false` in `agents.yaml`).
- **Server:** On production (e.g. Hetzner), requests from the server IP can be blocked (geo, rate limits, bot detection). Optional [Webshare proxy](WEBSHARE_PROXY.md) helps; not all cases are covered.
- **Agent:** Intentionally kept non-public until server-side access is reliable; can be enabled per-role or made public later.

## Optional: FlareSolverr

[FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) is a proxy that bypasses Cloudflare (and similar) protection using a headless browser. YTPTube supports it via env (see `dev/ytptube/FAQ.md`):

| Env | Purpose |
|-----|--------|
| `YTP_FLARESOLVERR_URL` | FlareSolverr endpoint (e.g. `http://flaresolverr:8191/v1`) |
| `YTP_FLARESOLVERR_MAX_TIMEOUT` | Challenge timeout (default 120 s) |
| `YTP_FLARESOLVERR_CLIENT_TIMEOUT` | HTTP client timeout |
| `YTP_FLARESOLVERR_CACHE_TTL` | Cache TTL for solutions (default 600 s) |

Worth trying if Cloudflare blocks YTPTube; add FlareSolverr to the stack and set `YTP_FLARESOLVERR_URL` for the YTPTube service.

## Future ideas (not implemented)

Ideas for using a **user or office IP** for video requests so the server is not blocked:

1. **Office Raspberry Pi (or small server) as proxy**
   - Pi in the office runs a browser (reachable on the internal network). Users log in to YouTube etc. in that browser.
   - Scripts export cookies (Netscape format) from the browser; optionally the Pi also runs a **reverse SSH SOCKS** tunnel to the Hetzner server (`ssh -R 6666: user@server`). The server uses `127.0.0.1:6666` as SOCKS proxy for yt-dlp so traffic egresses via the Pi’s (office) IP.
   - No single existing project does this end-to-end; it is a combination of: cookie-export scripts (e.g. Chromium SQLite → Netscape), reverse SSH, and YTPTube/yt-dlp proxy config.

2. **YTPTube (or transcript service) directly on the Pi**
   - Run YTPTube (or a transcript-only MCP) on the Pi. The Pi has the office IP and can use the same browser for cookies. LibreChat on the server would call the Pi’s YTPTube/MCP via tunnel or VPN.

3. **FlareSolverr** (see above) as an alternative when the blocker is Cloudflare rather than IP/geo.

Documentation rules: minimal, scannable. Details (reverse SSH steps, cookie export tools) are in prior research; this file only anchors the ideas for later work.
