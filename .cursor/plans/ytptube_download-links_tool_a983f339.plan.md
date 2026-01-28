---
name: YTPTube Download-Links Tool
overview: "Plan für ein neues MCP-Tool, das Download-Links zu YTPTube-Videos (mit eingebetteten Zugangsdaten) zurückgibt, sowie Traefik-Konfiguration, sodass nur der Download-Pfad nach außen erreichbar ist. Inkl. Schutzempfehlung und drei weiteren Tools im Umfang: list_recent_downloads, get_video_info, get_thumbnail_url."
todos: []
isProject: false
---

# YTPTube Download Links via MCP Tool + Traefik Lockdown

## Current State

- **YTPTube** serves files at `GET /api/download/{filename}` ([ytptube.ts](packages/mcp-ytptube/src/clients/ytptube.ts) uses `downloadFile()` with `getAuthHeaders(config.apiKey)`).
- **Auth per YTPTube API:** Basic header or query parameter `?apikey=<base64_urlsafe(username:password)>`.
- **Local:** In [docker-compose.local.yml](docker-compose.local.yml) / [docker-compose.local-dev.yml](docker-compose.local-dev.yml) YTPTube is **fully** exposed via Traefik (`Host(ytptube.${DOMAIN})`) – Web UI and full API reachable from outside; **keep as is**.
- **Portainer (Prod/Dev):** In [docker-compose.prod.yml](docker-compose.prod.yml) and [docker-compose.dev.yml](docker-compose.dev.yml) YTPTube is **not** attached to Traefik (no Traefik labels, app-net only) – **not** reachable from outside; **keep as is**.
- **MCP YTPTube** talks to YTPTube internally (`YTPTUBE_URL=http://ytptube:8081`), independent of Traefik.

**Auth (YTPTube API, [API.md](https://github.com/arabcoders/ytptube/blob/dev/API.md)):** When `YTP_AUTH_USERNAME` and `YTP_AUTH_PASSWORD` are set, **every** request (all endpoints including `/api/download`, `/api/history`, `/api/yt-dlp/archive_id/`) must send credentials – via `Authorization: Basic base64(username:password)` or query `?apikey=<base64_urlsafe(username:password)>`. Without valid credentials YTPTube responds with `401 Unauthorized`.  
**Implication for MCP:** When YTPTube runs with auth, the MCP **must** use the same API key. The MCP already does: [server.ts](packages/mcp-ytptube/src/server.ts) reads `YTPTUBE_API_KEY` or `YTPTUBE_BASIC_AUTH` and passes them to the client; [ytptube.ts](packages/mcp-ytptube/src/clients/ytptube.ts) sets `getAuthHeaders(config.apiKey)` on every request. For the new download-link tool: the same credentials are used to build the link (`?apikey=...`) so the returned link works without further login. Document clearly in docs and env examples: **YTPTUBE_API_KEY** (or YTPTUBE_BASIC_AUTH) must be set as soon as YTPTube has auth enabled – same value as YTPTube (Base64 of `username:password` or already as apikey).

---

## 1. New MCP Tool: Download Link with Credentials

**Goal:** A tool that returns a **directly usable download link** (audio or video) for a video URL (or job_id), with credentials embedded – so the link works in the browser or with `wget`, while bots without the link cannot access it.

**Approach:**

- **Tool name:** `get_video_download_link`
- **Inputs:** `video_url` (or optional `job_id`), optional `type: 'audio' | 'video'` (default: audio, since transcript flow primarily uses audio).
- **Flow:**
  1. Resolve item in YTPTube by `video_url` (or `job_id`) – same logic as in [request-video-transcript.ts](packages/mcp-ytptube/src/tools/request-video-transcript.ts) / [get-transcript-status.ts](packages/mcp-ytptube/src/tools/get-transcript-status.ts) (`findItemByUrlInAll` / `findItemByUrlWithArchiveIdFallback`).
  2. Only when status is `finished`: determine the file path (audio: as today `getFileBrowser(transcripts)` + `resolveAudioPathFromBrowser`; video: analog via appropriate folder/file type if YTPTube exposes video files in the browser).
  3. **Public base URL** from configuration (see below).
  4. Build link: `{publicBase}/api/download/{encodedPath}?apikey={base64_urlsafe(credentials)}`.
    - Credentials = **same** as for all MCP→YTPTube requests: `YTPTUBE_API_KEY` / `YTPTUBE_BASIC_AUTH`. When YTPTube has auth, the MCP must use this key anyway (see current state); for the download link the same key is embedded as `?apikey=` so the link works without further login. Base64-URL-safe for query (YTPTube supports `apikey`).
  5. Response: structured text (e.g. key=value like other tools) with `download_url=...`, optional `expires=` (if time-limited tokens are added later), `relay=` for the user.

**Configuration:**

- **New env variable:** `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` (e.g. `https://ytptube.${DOMAIN}`). Only set when offering download links externally; if missing, the tool can return a clear error (“Download links not configured”).
- **Existing env:** `YTPTUBE_API_KEY` (or `YTPTUBE_BASIC_AUTH`) **must** be set when YTPTube uses Basic Auth – otherwise the MCP gets 401 on all YTPTube requests. For the download-link tool: the same key is embedded in the link; when auth is on and the key is missing, the tool must return a clear error (“YTPTube auth enabled, YTPTUBE_API_KEY required”).
- In [docker-compose.mcp-ytptube.yml](docker-compose.mcp-ytptube.yml) (and local/local-dev if applicable) pass through `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL`; in Prod/Dev derive value from Traefik host (e.g. from existing `DOMAIN`).

**Security / Bots:**

- The link contains the secret (`apikey`). Mitigations:
  - **No public directory** of links – output only in chat / via tool.
  - **Traefik** (if you only expose download, Section 2): Only `/api/download` reachable; Web UI, POST, etc. not.
  - **Portainer:** Via the download-only router (Section 2) only `/api/download` is reachable from outside; the MCP tool returns links with this base URL.
- Optional later: time-limited tokens if YTPTube or a custom proxy supports it (out of scope for this plan).

---

## 2. Traefik: Download-only Router (Portainer)

**Goal:** In Portainer (Prod/Dev) expose YTPTube **only** for the download path – no Web UI, no other API paths. So the download links returned by the MCP tool work from outside without exposing the rest of the YTPTube instance.

**Implementation:**

- In [docker-compose.prod.yml](docker-compose.prod.yml) and [docker-compose.dev.yml](docker-compose.dev.yml) extend the **YTPTube service** with:
  - **Network:** Attach YTPTube to `traefik-net` (in addition to app-net).
  - **Traefik labels (download path only):**
    - `traefik.enable=true`
    - `traefik.docker.network=<traefik-net-name>` (or `loadbalancer-net`)
    - **Router:** one rule `Host(ytptube.${DOMAIN}) && PathPrefix(/api/download)` (Traefik v3: `PathPrefix(/api/download)`).
    - **Service:** Backend port 8081.
  - No second router for Web UI or other paths – only this one router, so from outside **only** `GET /api/download/*`.
- **Local** ([docker-compose.local.yml](docker-compose.local.yml) / [docker-compose.local-dev.yml](docker-compose.local-dev.yml)): **no** change – YTPTube stays fully exposed (Host without PathPrefix).

**Result:** In Portainer, YTPTube is reachable from outside only at `https://ytptube.${DOMAIN}/api/download/...`; Web UI and e.g. POST /api/history are not reachable from outside. Internally (MCP YTPTube etc.) `http://ytptube:8081` is unchanged – full API including download with auth header.

**Documentation:** Record in [docs/MCP_YTPTUBE.md](docs/MCP_YTPTUBE.md) and [docs/SERVICES.md](docs/SERVICES.md): In Prod/Dev Traefik exposes only the download-only router for YTPTube; set `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` in Portainer to `https://ytptube.${DOMAIN}` so the MCP tool returns valid links.

---

## 3. Security: Platform (YTPTube) vs Traefik


| Layer   | Measure                                                        | Rationale                                                                                                               |
| ------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Traefik | Expose only `PathPrefix(/api/download)` for YTPTube            | Reduces attack surface: Web UI and other API (POST, History, etc.) are not reachable from outside.                      |
| YTPTube | Auth on every request (already supported: Basic or `?apikey=`) | Every download request must have valid credentials; the link contains `apikey`, so only holders of the link can access. |


**Recommendation:** Use both – **Traefik** for path whitelist, **YTPTube** for authentication. No extra auth middleware in Traefik needed as long as YTPTube enforces auth (YTP_AUTH_USERNAME/PASSWORD set). Traefik could later add rate limiting or IP allowlist for the download router only.

---

## 4. Implementation Building Blocks (Overview)

- **Client:** In [packages/mcp-ytptube/src/clients/ytptube.ts](packages/mcp-ytptube/src/clients/ytptube.ts) no new API needed; optional helper `buildPublicDownloadUrl(relativePath, publicBaseUrl, apiKey)` (build link + apikey, mind encoding).
- **Tool:** New module e.g. [packages/mcp-ytptube/src/tools/get-video-download-link.ts](packages/mcp-ytptube/src/tools/get-video-download-link.ts) – resolve item, get path (audio/video), build public URL, response format (key=value + relay).
- **Schema:** Zod schema for `video_url` / optional `job_id`, optional `type`.
- **Server:** Register tool in [packages/mcp-ytptube/src/server.ts](packages/mcp-ytptube/src/server.ts); read env `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL`.
- **Compose/Env:** Document `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` in [docker-compose.mcp-ytptube.yml](docker-compose.mcp-ytptube.yml) and [env.*.example](env.local.example).
- **Traefik (download-only router):** In [docker-compose.prod.yml](docker-compose.prod.yml) and [docker-compose.dev.yml](docker-compose.dev.yml) attach YTPTube to traefik-net and add one router with `Host(ytptube.${DOMAIN}) && PathPrefix(/api/download)` (Section 2). No Traefik change locally (stay fully exposed).

---

## 5. Additional Tools (In Scope)

The following three tools are **explicit deliverables** of this plan (not “optional later”). Short spec:

### 5.1 `list_recent_downloads`

- **Purpose:** Last N history items (queue/done) with title, status, optional download link when finished. For “show me recent downloads”.
- **Inputs:** `limit` (optional, e.g. default 10), optional filter (e.g. only finished).
- **YTPTube API:** History endpoint (e.g. `GET /api/history` or existing client call); for finished items optionally reuse `get_video_download_link` logic for the link.
- **Output:** List (key=value or structured) with per item: title, status, video URL/job ID, optional `download_url` when finished; plus relay text for the user.

### 5.2 `get_video_info`

- **Purpose:** Metadata (title, duration, extractor) for a URL **without** downloading – preview before download.
- **Inputs:** `video_url` (required).
- **YTPTube API:** `GET /api/yt-dlp/url/info` (or equivalent in YTPTube client).
- **Output:** Structured text with title, duration, extractor, optionally other yt-dlp info fields; plus relay text for the user.

### 5.3 `get_thumbnail_url`

- **Purpose:** Return link to the video thumbnail (for preview/UI).
- **Inputs:** `video_url` (required); optionally use `get_video_info` result if thumbnail URL is included there.
- **YTPTube API:** Check whether YTPTube/yt-dlp returns thumbnail URL in info response (`GET /api/yt-dlp/url/info`) or a dedicated endpoint; if served via YTPTube, same protection as download links (only reachable via Traefik path or public URL with apikey).
- **Output:** `thumbnail_url=...` (direct URL to image); if not available, clear error message; plus relay text for the user.

