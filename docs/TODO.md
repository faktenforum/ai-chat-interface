# TODO

## Security

### LDAP/Active Directory Integration
- [ ] Configure LDAP server connection
- [ ] Set up user authentication via LDAP
- [ ] Test LDAP login flow
- [ ] Document LDAP configuration

**Resources:** [LibreChat LDAP Documentation](dev/librechat-doc/pages/docs/configuration/authentication/ldap.mdx)

### Firecrawl API Security
- [ ] Remove public Traefik exposure for Firecrawl API (only internal Docker network access needed)

---

## Infrastructure

- [ ] Define backup strategy for MongoDB and PostgreSQL
- [ ] Set up monitoring and alerting
- [ ] Configure log rotation

---

## Features

### LibreChat

- [ ] Enable `execute_code` (Code Interpreter) on production once the backing service is available again
  - The main LibreChat developer had disabled it; it is an external service used for LibreChat funding. Currently disabled in prod via `librechat.prod.yaml` (capabilities override); local/dev keep it enabled.

### Custom Roles Support
- [ ] Add API endpoint and frontend support for custom roles
  - Custom roles created in MongoDB not visible in AdminSettingsDialog (only USER/ADMIN hardcoded)
  - Repository: [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat)

### Agents
- [ ] Create agents and make them available to regular users only
  - Goal: Ensure provided tools function correctly and can be used, and that underlying LLM models are tested for their intended use cases
  - Consider creating agents named after their LLM models (with the corresponding LLM behind them)
  - Create a minimal general-purpose agent with common functions like web search

- [ ] Replace Jina reranker with RAG API reranker once LibreChat PR [#10574](https://github.com/danny-avila/LibreChat/pull/10574) is merged (adds `rerankerType: "simple"` support)

### RAG API - OpenRouter Embeddings Support
- [ ] Create feature request for OpenRouter provider support in RAG API
  - OpenRouter requires `HTTP-Referer` and `X-Title` headers for embeddings API
  - Repository: [danny-avila/librechat-rag-api](https://github.com/danny-avila/librechat-rag-api)

### Model Specs Improvements

- [x] Fix vision model detection for "Upload to AI Provider" option
  - LibreChat discussion [#11333](https://github.com/danny-avila/LibreChat/discussions/11333)
  - Fixed by: [LibreChat PR #11501](https://github.com/danny-avila/LibreChat/pull/11501) (vision capability flag to modelSpecs)
- [ ] Add multilingual support for custom titles, labels, and descriptions
  - LibreChat discussion [#7666](https://github.com/danny-avila/LibreChat/discussions/7666) - multilingual support for user-defined content (model specs, MCP servers, interface config, agents)
  - Related: [#10183](https://github.com/danny-avila/LibreChat/issues/10183) (model fields)
- [ ] Fix custom icon theme support
  - LibreChat issue [#11442](https://github.com/danny-avila/LibreChat/issues/11442) - custom icons don't adapt to theme colors

### OCR (Optical Character Recognition)

- [ ] Obtain official Mistral API key
  - Status: Configuration ready (`LIBRECHAT_OCR_API_KEY` in `.env.local`), using private key temporarily
  - Required for: OCR service AND direct Mistral model usage
  - Mistral Console: https://console.mistral.ai/
  - LibreChat Docs: https://www.librechat.ai/docs/features/ocr

### YTPTube / Video transcripts (production)

- [ ] Improve server-side video access (geo/bot blocking)
  - Status: Works locally; Video-Transkripte agent is in code with `public: false`. On Hetzner, optional Webshare proxy or FlareSolverr; see [YTPTUBE_FUTURE_WORK.md](wip/YTPTUBE_FUTURE_WORK.md) for FlareSolverr and office Pi / reverse-SSH-proxy ideas for later.

### MCP Docs (Grounded Docs)

- [ ] Open PR for configurable embedding dimension (fork branch `vector-dimension`)
  - **Goal:** Upstream [arabold/docs-mcp-server](https://github.com/arabold/docs-mcp-server) should support configurable `documents_vec` dimension so Scaleway (3584), OpenRouter (1536), and other providers work without DB mismatch.
  - **Fork:** [faktenforum/docs-mcp-server](https://github.com/faktenforum/docs-mcp-server), branch `vector-dimension`. Create PR from `vector-dimension` → `arabold/docs-mcp-server:main`.
- [ ] Reuse existing playwright-service for docs-mcp-server browser rendering
  - **Goal:** docs-mcp-server uses shared Firecrawl playwright-service instead of in-process Chromium for `scrapeMode` playwright/auto.
  - **Benefit:** Single browser pool (Firecrawl + docs-mcp), less resources in docs-mcp container, no Chromium in docs-mcp image.
  - **Approach:** Add optional "remote Playwright" mode: when configured (e.g. env `PLAYWRIGHT_MICROSERVICE_URL` or `MCP_DOCS_PLAYWRIGHT_URL`), HtmlPlaywrightMiddleware (or equivalent) calls `POST /scrape` with `{ url, timeout?, headers?, ... }` and feeds returned HTML into existing HTML pipeline (Cheerio, sanitization, markdown, splitter). Default remains in-process Playwright for standalone deployments.
  - **Risk:** playwright-service is Firecrawl’s internal contract; API may change with Firecrawl releases. Document the contract or pin a compatible version.
  - **Ref:** [MCP_DOCS.md](MCP_DOCS.md), Firecrawl `dev/firecrawl/apps/playwright-service-ts` (POST `/scrape`).

### MCP Tools

- [x] Fix MCP image generation tools sending artifacts to non-vision models
  - LibreChat issue [#11413](https://github.com/danny-avila/LibreChat/issues/11413)
  - Fixed by: [LibreChat PR #11504](https://github.com/danny-avila/LibreChat/pull/11504) (vision toggle for agents) and [agents PR #48](https://github.com/danny-avila/agents/pull/48) (filter base64 image artifacts)
- [ ] Fix negative max_tokens error with Scaleway/Mistral provider
  - LibreChat issue [#11435](https://github.com/danny-avila/LibreChat/issues/11435)
- [ ] Reduce SSE stream disconnection error logs
  - Known issue: `streamable-http` MCP servers use stateless HTTP POST while LibreChat's `StreamableHTTPClientTransport` attempts SSE streams, causing "Bad Request" errors. Servers function correctly. Log rotation configured.
  - Related: [LibreChat Discussion #11230](https://github.com/danny-avila/LibreChat/discussions/11230)
- [ ] Re-enable Firecrawl MCP server after connection stability is fixed
  - Status: Currently disabled due to unstable connection to MCP server
  - The tool is very helpful for reading special URLs, but connection issues prevent reliable usage
  - Waiting for fix before re-enabling in `librechat.yaml` and `agents.yaml`
  - Related to SSE stream disconnection issue above
- [ ] Update OpenStreetMap MCP server to use official version after PR merge
  - Status: Currently using fork `faktenforum/open-streetmap-mcp` with merged `bump-fastmcp` branch
  - Fork includes HTTP transport support and Dockerfile from PR [#10](https://github.com/jagan-shanmugam/open-streetmap-mcp/pull/10)
  - Our improvements submitted as PR [#11](https://github.com/jagan-shanmugam/open-streetmap-mcp/pull/11): Docker port configuration and FastMCP 0.2.0+ compatibility
  - Once PRs #10 and #11 are merged upstream, consider switching to official version
- [ ] Find alternative to passing cookies.txt via LLM for MCP (e.g. YTPTube/YouTube)
  - Current approach of sending cookies.txt through the LLM (as prompt/content) is inefficient and error-prone: the file is already very long for YouTube alone, blows up context and can break or truncate.
  - Goal: support file upload and pass file content directly to the tool/LLM (e.g. as attachment or tool resource) instead of in the user prompt.
- [x] Fix MCP tools returning malformed responses mixing text and JSON
  - Issue: [LibreChat #11494](https://github.com/danny-avila/LibreChat/issues/11494) - MCP image responses with mixed text content are not displayed
  - Fixed by: [LibreChat PR #11499](https://github.com/danny-avila/LibreChat/pull/11499) (automatic detection of OpenAI-compatible endpoints for MCP formatting)
  - Affected tools:
    - Mapbox MCP: [mapbox/mcp-server#103](https://github.com/mapbox/mcp-server/issues/103) - Tool responses mix text and JSON instead of using structured content arrays
    - Playwright MCP: [microsoft/playwright-mcp#1324](https://github.com/microsoft/playwright-mcp/issues/1324) - Screenshot responses mix Markdown/JSON format
  - Workaround: Using `--image-responses omit` for Playwright (removes images from responses)
  - Root cause: Tools return responses that mix plain text with embedded JSON objects instead of using proper MCP specification format with structured content arrays

---

## Providers

### European Providers
- [ ] Integrate Mistral AI (France) as direct provider
- [ ] Integrate Black Forest Labs (Germany) for FLUX models as direct provider

### Required Providers
- [ ] Integrate ElevenLabs for TTS (Text-to-Speech)
- [ ] Keep Jina reranker until replacement is ready (currently have free tokens for API key, not urgent)

---

## Upstream Contributions

### Vision (WIP / draft PRs, not merged)

- [ ] Add vision capability flag to modelSpecs configuration (draft PR, WIP) – [LibreChat PR #11501](https://github.com/danny-avila/LibreChat/pull/11501)
- [ ] Filter base64 image artifacts based on agent vision capability (draft PR, WIP) – [agents PR #48](https://github.com/danny-avila/agents/pull/48)

Vision is re-enabled in `packages/librechat-init/config/librechat.yaml` as **experimental/WIP**. Requires `feat/vision` in `dev/librechat` and `dev/agents`. See [WIP Documentation](wip/README.md).