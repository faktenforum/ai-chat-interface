# Services Overview

This document provides an overview of all services in the AI Chat Interface stack: application and infrastructure **Services**, and **MCP Services** (Model Context Protocol servers used by LibreChat agents). Availability and access methods are described for each.

---

## Services

Application servers, databases, and infrastructure (excluding MCP servers).

### Service Availability Matrix

| Service | Description | Local (via Traefik) | Production (via Traefik) | Internal Only |
|---------|-------------|---------------------|--------------------------|---------------|
| **LibreChat** | Main AI chat interface | ✅ `http://chat.localhost` | ✅ `https://chat.{DOMAIN}` | ❌ |
| **Spend Monitor** | Read-only org cost dashboard (reads LibreChat MongoDB) | ✅ `http://spend.localhost` | ✅ `https://spend.{DOMAIN}` (basic auth) | ❌ |
| **SearXNG** | Meta search engine for web search | ✅ `http://searxng.localhost` | ❌ Not exposed | ✅ Internal only |
| **Firecrawl API** | Web scraping service | ✅ `http://firecrawl.localhost` | ❌ Not exposed | ✅ Internal only (prod/dev) |
| **MailDev** | Development mail server | ✅ `http://maildev.localhost` | ❌ Not in production | ❌ |
| **Traefik** | Reverse proxy and load balancer | ✅ `http://localhost:8080` (API) | External (separate container) | ❌ |
| **MongoDB** | LibreChat database | ❌ | ❌ | ✅ Internal only |
| **Meilisearch** | LibreChat search index | ❌ | ❌ | ✅ Internal only |
| **VectorDB** | RAG vector database (PostgreSQL + pgvector) | ❌ | ❌ | ✅ Internal only |
| **RAG API** | Retrieval-Augmented Generation API | ❌ | ❌ | ✅ Internal only |
| **YTPTube** | Web UI for yt-dlp (audio/video downloads); used by MCP YTPTube | ✅ Local: `http://ytptube.{DOMAIN}` | ✅ Prod/dev: only `https://ytptube.{DOMAIN}/api/download/*` (download-only router) | ✅ Web UI and rest of API internal in prod/dev |
| **Firecrawl Services** | Internal Firecrawl dependencies | ❌ | ❌ | ✅ Internal only |
| **playwright-service** | Browser automation | ❌ | ❌ | ✅ Internal only |
| **redis** | Firecrawl cache/queue | ❌ | ❌ | ✅ Internal only |
| **nuq-postgres** | Firecrawl database | ❌ | ❌ | ✅ Internal only |
| **rabbitmq** | Firecrawl message queue | ❌ | ❌ | ✅ Internal only |

### Service Details

#### External Services (Exposed via Traefik)

**LibreChat**
- **Local**: `http://chat.localhost`
- **Production**: `https://chat.{DOMAIN}`
- **Purpose**: Main AI chat interface with support for multiple AI models
- **Network**: `traefik-net` + `app-net`
- **Internal Dependencies**: MongoDB, Meilisearch, RAG API, SearXNG, Firecrawl

**SearXNG**
- **Local**: `http://searxng.localhost`
- **Production**: ❌ **Not exposed externally** (internal only)
- **Purpose**: Meta search engine for web search functionality in LibreChat
- **Network**: `traefik-net` (local) + `app-net`, only `app-net` (production)
- **Note**: Bot detection is disabled as it's only used internally

**Firecrawl API**
- **Local**: `http://firecrawl.localhost` (exposed for debugging)
- **Production / Dev (Portainer)**: ❌ **Not exposed** (internal only)
- **Purpose**: Web scraping and content extraction; used by LibreChat (scraper) via `http://firecrawl-api:3002`
- **Network**: `firecrawl-network` + `app-net` (prod/dev); local also has `traefik-net` for firecrawl.localhost
- **Internal Dependencies**: playwright-service, redis, nuq-postgres, rabbitmq
- **Note**: No need to expose publicly; all consumers use the internal hostname.

**MailDev**
- **Local**: `http://maildev.localhost`
- **Production**: ❌ Not in production stack
- **Purpose**: Development mail server for testing email functionality
- **Network**: `traefik-net`
- **Note**: Only available in local development environment

#### Internal Services (Not Exposed)

**MongoDB** — LibreChat's primary database. Network: `app-net`. Access: LibreChat API only.

**Meilisearch** — Search index for LibreChat conversations and messages. Network: `app-net`. Access: LibreChat API only.

**VectorDB (PostgreSQL + pgvector)** — Vector database for RAG. Network: `app-net`. Access: RAG API only.

**RAG API** — Retrieval-Augmented Generation service for document search. Network: `app-net`. Access: LibreChat API only.

**Faktenforum Search (external, optional)** — LibreChat optionally connects to an **external** Faktenforum Search instance via MCP. Search is no longer deployed by this stack; it is hosted as part of Faktenforum (prod `https://api.faktenforum.org/search/`, dev `https://dev-api.faktenforum.org/search/`). The integration is opt-in: it activates only when `SEARCH_MCP_URL` is set. Leave it empty to disable - the Search MCP server and the Faktencheck agent are then omitted at init time. Configure `SEARCH_MCP_URL`, `SEARCH_MCP_API_KEY`, and `SEARCH_MCP_DOMAIN` in env (e.g. `SEARCH_MCP_URL=https://dev-api.faktenforum.org/search/mcp`, `SEARCH_MCP_DOMAIN=dev-api.faktenforum.org`).

**YTPTube** — yt-dlp Web UI; queues downloads. MCP YTPTube uses it for audio/transcripts. Network: `app-net` + `traefik-net` (prod/dev: download-only router `PathPrefix(/api/download)` at `https://ytptube.{DOMAIN}/api/download/*`); local/local-dev: full host `http://ytptube.{DOMAIN}`. Image: `ghcr.io/arabcoders/ytptube:latest`

**Firecrawl Internal Services** — playwright-service (browser automation), redis (cache/queue), nuq-postgres (database), rabbitmq (message queue). Network: `firecrawl-network` only (firecrawl-api also has `traefik-net` and `app-net`). If Docker returns 502 when creating `firecrawl-rabbitmq`, reduce startup load: increase Docker resources or start infra first (`redis`, `nuq-postgres`, `rabbitmq`, `playwright-service`), then the rest.

---

## MCP Services

MCP (Model Context Protocol) servers provide tools for LibreChat agents. All MCP servers used in this stack are configured in `packages/librechat-init/config/librechat.yaml` and listed in `mcpServers` / `mcpSettings.allowedDomains`.

### MCP Server Availability Matrix

Internal Docker MCP servers are exposed on localhost when running the stack locally so they can be used directly from Cursor for testing (see `.cursor/mcp.json`). The `/mcp` endpoint is always internal (Docker network only). Some servers expose additional routes publicly via Traefik.

| MCP Server | Hosting | Port | MCP Endpoint (internal) | Public Routes (via Traefik) | Local (Cursor) |
|------------|---------|------|-------------------------|-----------------------------|----------------|
| **Calculator** | Internal Docker | 3012 | `http://mcp-calculator:3012/mcp` | — | ✅ `localhost:3012` |
| **Image Generation** | Internal Docker | 3013 | `http://mcp-image-gen:3013/mcp` | — | ✅ `localhost:3013` |
| **OpenStreetMap** | Internal Docker | 3004 | `http://mcp-openstreetmap:3004/mcp` | — | ✅ `localhost:3004` |
| **Weather** | Internal Docker | 3005 | `http://mcp-weather:3005/mcp` | — | ✅ `localhost:3005` |
| **DB Timetable** | Internal Docker | 3007 | `http://mcp-db-timetable:3007/mcp` | — | ✅ `localhost:3007` |
| **StackOverflow** | Internal Docker | 3008 | `http://mcp-stackoverflow:3008/mcp` | — | ✅ `localhost:3008` |
| **npm Search** | Internal Docker | 3009 | `http://mcp-npm-search:3009/mcp` | — | ✅ `localhost:3009` |
| **Chefkoch** | Internal Docker | 3014 | `http://mcp-chefkoch:3014/mcp` | — | ✅ `localhost:3014` |
| **Linux** | Internal Docker | 3015 | `http://mcp-linux:3015/mcp` | ✅ `https://mcp-linux.{DOMAIN}/upload/*`, `/download/*` | ✅ `localhost:3015` |
| **YTPTube** | Internal Docker | 3010 | `http://mcp-ytptube:3010/mcp` | — | ✅ `localhost:3010` |
| **Grounded Docs** | Internal Docker | 6280 | `http://mcp-docs:6280/mcp` | — | ✅ `localhost:6280` |
| **Wikipedia** | Internal Docker | 3017 | `http://mcp-wikipedia:3017/mcp` | — | ✅ `localhost:3017` |
| **GitHub** | Remote | — | `https://api.githubcopilot.com/mcp/` | N/A (external) | — |
| **Mapbox** | Remote | — | `https://mcp.mapbox.com/mcp` | N/A (external) | — |

### MCP Server Details

**Calculator** — Calculator tools for LibreChat agents. Network: `app-net`. URL: `http://mcp-calculator:3012/mcp`.

**Image Generation** — Image generation via OpenRouter API. Tools: `generate_image`, `list_known_models`, `list_available_models`, `check_model`. Network: `app-net`. URL: `http://mcp-image-gen:3013/mcp`.

**OpenStreetMap** — Geo search, routing, location information. Network: `app-net`. URL: `http://mcp-openstreetmap:3004/mcp`.

**Weather** — Weather, air quality, timezone tools. Uses free Open-Meteo API (no key). Tools: `get_current_weather`, `get_weather_by_datetime_range`, `get_weather_details`, `get_air_quality`, `get_air_quality_details`, `get_current_datetime`, `get_timezone_info`, `convert_time`. Network: `app-net`. URL: `http://mcp-weather:3005/mcp`. Image: `dog830228/mcp_weather_server:latest`

**DB Timetable** — Deutsche Bahn schedules, station search, connections. Network: `app-net`. URL: `http://mcp-db-timetable:3007/mcp`.

**StackOverflow** — Programming solutions and debugging. Network: `app-net`. URL: `http://mcp-stackoverflow:3008/mcp`.

**npm Search** — npm package search. Network: `app-net`. URL: `http://mcp-npm-search:3009/mcp`.

**Chefkoch** — Recipes from chefkoch.de. Tools: `get_recipe`, `search_recipes`, `get_random_recipe`, `get_daily_recipes`. Network: `app-net`. URL: `http://mcp-chefkoch:3014/mcp`. Env: `MCP_CHEFKOCH_PORT` (3014), `MCP_CHEFKOCH_LOG_LEVEL`. [MCP Chefkoch](MCP_CHEFKOCH.md)

**Linux** — Per-user isolated Linux terminal with persistent git workspaces, first-class file tools, file upload/download, and structured file reading. Tools: `execute_command`, `read_terminal_output`, `write_terminal`, `list_terminals`, `kill_terminal`, `list_workspaces`, `create_workspace`, `delete_workspace`, `get_workspaces`, `clean_workspace_uploads`, `get_status`, `reset_account`, `create_upload_session`, `list_upload_sessions`, `close_upload_session`, `create_download_link`, `list_download_links`, `close_download_link`, `read_workspace_file`, `list_workspace_files`, `write`, `edit`, `grep`, `glob`, `todowrite`. Network: `app-net`. URL: `http://mcp-linux:3015/mcp`. Env: `MCP_LINUX_PORT` (3015), `MCP_LINUX_LOG_LEVEL`, `MCP_LINUX_WORKER_IDLE_TIMEOUT`, `MCP_LINUX_SESSION_IDLE_TIMEOUT_MIN`, `MCP_LINUX_GIT_SSH_KEY`, `MCP_LINUX_GIT_USER_NAME`, `MCP_LINUX_GIT_USER_EMAIL`, `MCP_LINUX_UPLOAD_BASE_URL`, `MCP_LINUX_DOWNLOAD_BASE_URL`. Volumes: `mcp_linux_homes`, `mcp_linux_data`. Traefik: `/upload/*` and `/download/*` exposed publicly. Account management (`get_status`) and the upload widget render inline in chat as MCP-UI resources. [MCP Linux](MCP_LINUX.md)

**YTPTube** — Media URL → transcript or download link. Tools: `request_transcript`, `get_status`, `request_download_link`, `get_media_info`, `get_thumbnail_url`, `list_recent_downloads`. Optional: `TRANSCRIPTION_BASE_URL` + `TRANSCRIPTION_API_KEY` for audio transcription; omit for platform-subtitles-only. Network: `app-net`. URL: `http://mcp-ytptube:3010/mcp`. [MCP YTPTube](MCP_YTPTUBE.md)

**Grounded Docs** — Documentation index (websites, GitHub, npm, local files). Optional semantic search via embeddings (`MCP_DOCS_*`). Volumes: `docs-mcp-data`, `docs-mcp-config`. Network: `app-net`. URL: `http://mcp-docs:6280/mcp`. Image: `ghcr.io/faktenforum/mcp-docs:latest`. Port: `MCP_DOCS_PORT` (default 6280). [MCP Grounded Docs](MCP_DOCS.md)

**Wikipedia** — Wikipedia search, article content, summaries, sections, links, related topics. Wraps the upstream `wikipedia-mcp` pip package (pinned `2.0.1`); no `/health` endpoint, so the healthcheck is a TCP connect. Used by the Assistant. Internal only. Network: `app-net`. URL: `http://mcp-wikipedia:3017/mcp`. Image: `ghcr.io/faktenforum/mcp-wikipedia:latest`. Env: `MCP_WIKIPEDIA_PORT` (3017), `WIKIPEDIA_ACCESS_TOKEN` (optional, raises API rate limits).

**GitHub** — Repository management, issues, pull requests, code search; write access (create issue/PR/review) when not read-only. Remote; requires `MCP_GITHUB_PAT` (shared machine user recommended). URL: `https://api.githubcopilot.com/mcp/`. See [GitHub Machine User](GITHUB_MACHINE_USER.md).

**Mapbox** — Geo search, routing, geocoding, map visualisation. Remote; requires `MCP_MAPBOX_ACCESS_TOKEN`. URL: `https://mcp.mapbox.com/mcp`

### Testing internal MCPs from Cursor IDE

When using the **local** stack (`docker-compose -f docker-compose.local.yml …` or `-f docker-compose.local-dev.yml`), internal MCP servers are bound to `127.0.0.1:PORT` and are **not** exposed in production or Portainer. Calculator, image-gen, chefkoch and linux use the same port internally and on the host: **3012**, **3013**, **3014** and **3015** by default (`MCP_CALCULATOR_PORT`, `MCP_IMAGE_GEN_PORT`, `MCP_CHEFKOCH_PORT`, `MCP_LINUX_PORT`) so they don’t clash with other projects using 3000–3002; `.cursor/mcp.json` uses these ports. To test them from the Cursor code assistant:

1. **Start the MCP servers** so something is listening on the ports used in `.cursor/mcp.json`:
   - Full stack: `docker compose -f docker-compose.local.yml up -d` (or `docker-compose.local-dev.yml`).
   - **YTPTube only**: `docker compose -f docker-compose.local.yml up -d ytptube mcp-ytptube`. `.env.local`: `YTPTUBE_URL`; optional `TRANSCRIPTION_BASE_URL`/`TRANSCRIPTION_API_KEY` (e.g. `${SCALEWAY_BASE_URL}`/`${SCALEWAY_API_KEY}`).
   - Other MCPs: start the service and any dependencies it has (e.g. `mcp-docs` may need its embeddings env configured).
2. Use the URL-based entries in `.cursor/mcp.json` (`http://localhost:PORT/mcp`). Cursor loads these from the project config and uses the tools when the agent considers them relevant.

**If Cursor shows `ECONNREFUSED`** for an internal MCP URL, no process is listening on that port. Start the corresponding container(s) with the **local** compose file (see above).

---

## Network Architecture

### Networks

1. **`traefik-net`** (Local: bridge, Production: external `loadbalancer-net`)
   - Services with external HTTP/HTTPS: LibreChat, SearXNG (local only), Firecrawl API, MailDev (local only)

2. **`app-net`** (Bridge)
   - LibreChat and related services: LibreChat, MongoDB, Meilisearch, VectorDB, RAG API, SearXNG, Firecrawl API, YTPTube
   - All internal MCP servers: mcp-calculator, mcp-image-gen, mcp-openstreetmap, mcp-weather, mcp-db-timetable, mcp-stackoverflow, mcp-npm-search, mcp-chefkoch, mcp-linux, mcp-ytptube, mcp-docs

3. **`firecrawl-network`** (Bridge)
   - Firecrawl only: firecrawl-api, playwright-service, redis, nuq-postgres, rabbitmq

---

## Security Notes

- **SearXNG**: Not exposed in production; bot detection disabled for internal use.
- **Internal services**: MongoDB, Meilisearch, and other internal services are not exposed.
- **Production**: External Traefik with SSL/TLS (e.g. Let's Encrypt).
- **Local**: Traefik in stack, HTTP only.

---

## Access Patterns

### Local Development
- Services: `http://{service}.localhost`
- Traefik: `http://localhost:8080`
- Container access via service names on shared networks

### Production
- External: `https://{service}.{DOMAIN}`
- Internal: by service name on `app-net` or `firecrawl-network`
- SearXNG: internal only

---

## Development Facilities

### LibreChat Test Stack

Dedicated Docker stack (MongoDB + Meilisearch only) for running LibreChat tests from the host. Required for E2E; API unit tests use in-memory MongoDB and do not use this stack. Tests run via Node 20 in `dev/librechat`; the stack provides backing services on fixed ports (MongoDB 27018, Meilisearch 7701).

See **[LibreChat Testing](LIBRECHAT_TESTING.md)** for setup and usage.
