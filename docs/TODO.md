# TODO

## Security

### LDAP/Active Directory Integration
- [ ] Configure LDAP server connection
- [ ] Set up user authentication via LDAP
- [ ] Test LDAP login flow
- [ ] Document LDAP configuration

**Resources:** [LibreChat LDAP Documentation](../dev/librechat-doc/content/docs/configuration/authentication/ldap.mdx)

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

- [ ] Replace Jina reranker with RAG API reranker (see [Upstream Contributions](#upstream-contributions))

### RAG API - OpenRouter Embeddings Support
- [ ] Create feature request for OpenRouter provider support in RAG API
  - OpenRouter requires `HTTP-Referer` and `X-Title` headers for embeddings API
  - Repository: [danny-avila/librechat-rag-api](https://github.com/danny-avila/librechat-rag-api)

### Model Specs Improvements

- [x] Fix vision model detection for "Upload to AI Provider" option
  - LibreChat discussion [#11333](https://github.com/danny-avila/LibreChat/discussions/11333)
  - Handled in our fork; clean upstream re-attempt: [LibreChat #13860](https://github.com/danny-avila/LibreChat/pull/13860) + [agents #257](https://github.com/danny-avila/agents/pull/257) (see [Upstream Contributions](#upstream-contributions))
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
  - Status: Works locally; Video Transcripts agent is in code with `public: false`. On Hetzner, optional Webshare proxy or FlareSolverr; see [YTPTUBE_FUTURE_WORK.md](wip/YTPTUBE_FUTURE_WORK.md) for FlareSolverr and office Pi / reverse-SSH-proxy ideas for later.

### MCP Memory Service

- [ ] Test [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) (persistent context memory for AI sessions; MCP-compatible, semantic search, optional Cloudflare sync)
  - May replace or complement the docs MCP (Grounded Docs) depending on use case; evaluate after testing.

### MCP Docs (Grounded Docs)

- [ ] Open PR for configurable embedding dimension (see [Upstream Contributions](#upstream-contributions))
- [ ] Reuse Firecrawl playwright-service for docs-mcp-server browser rendering
  - Optional remote Playwright mode (e.g. `MCP_DOCS_PLAYWRIGHT_URL`): docs-mcp calls playwright-service `POST /scrape`, feed HTML into existing pipeline. Single browser pool, no Chromium in docs-mcp image. Risk: Firecrawl contract may change. Ref: [MCP_DOCS.md](MCP_DOCS.md), `dev/firecrawl/apps/playwright-service-ts`.

### MCP Tools

- [x] Fix MCP image generation tools sending artifacts to non-vision models
  - LibreChat issue [#11413](https://github.com/danny-avila/LibreChat/issues/11413)
  - Handled in our fork (vision feature); clean upstream re-attempts: [agents #257](https://github.com/danny-avila/agents/pull/257) + [LibreChat #13860](https://github.com/danny-avila/LibreChat/pull/13860) (see [Upstream Contributions](#upstream-contributions))
- [ ] Reduce SSE stream disconnection error logs
  - Known issue: `streamable-http` MCP servers use stateless HTTP POST while LibreChat's `StreamableHTTPClientTransport` attempts SSE streams, causing "Bad Request" errors. Servers function correctly. Log rotation configured.
  - Related: [LibreChat Discussion #11230](https://github.com/danny-avila/LibreChat/discussions/11230)
- [ ] Re-enable Firecrawl MCP server after connection stability is fixed
  - Status: Currently disabled due to unstable connection to MCP server
  - The tool is very helpful for reading special URLs, but connection issues prevent reliable usage
  - Waiting for fix before re-enabling in `librechat.yaml` and `agents.yaml`
  - Related to SSE stream disconnection issue above
- [ ] Update OpenStreetMap MCP server to official version once upstream PRs are merged (see [Upstream Contributions](#upstream-contributions))
  - Currently using fork `faktenforum/open-streetmap-mcp` with merged `bump-fastmcp` branch
- [ ] Find alternative to passing cookies.txt via LLM for MCP (e.g. YTPTube/YouTube)
  - Current approach of sending cookies.txt through the LLM (as prompt/content) is inefficient and error-prone: the file is already very long for YouTube alone, blows up context and can break or truncate.
  - Goal: support file upload and pass file content directly to the tool/LLM (e.g. as attachment or tool resource) instead of in the user prompt.
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

### danny-avila/LibreChat

Status verified and customizations decided during the 2026-06 upstream sync (forks merged up to upstream/main); PR statuses refreshed 2026-06-20.

| Status | Branch | PR | Description / sync decision |
|--------|--------|----|-------------|
| Open (draft) | `feat/vision-capability` | [#13860](https://github.com/danny-avila/LibreChat/pull/13860) | Optional `vision` flag on the OpenAI LLM config, forwarded onto the chat-client options so image content is stripped for non-vision models. **Clean minimal re-attempt** off upstream/main; depends on [agents#257](https://github.com/danny-avila/agents/pull/257). Pairs with the load-bearing fork vision feature (non-vision Scaleway/OpenRouter models error on image input). |
| Open | `fix/mcp-parser` | [#12103](https://github.com/danny-avila/LibreChat/pull/12103) | Auto-detect OpenAI-compatible custom endpoints in formatToolContent. **Kept** (Scaleway depends on it); merged with upstream's new MCP image-size validation. |
| Open | `feat/stt` | [#11528](https://github.com/danny-avila/LibreChat/pull/11528) | Prefer ogg/wav in external STT recording. Not affected by the sync. |
| Open | — | depends on [#10574](https://github.com/danny-avila/LibreChat/pull/10574) | Replace Jina reranker with RAG API reranker (`rerankerType: "simple"`); not our PR. |
| Open | `feat/custom-reranker-provider` | [#12121](https://github.com/danny-avila/LibreChat/pull/12121) | Custom reranker provider (configurable URL + model, e.g. Scaleway). **Kept** — depends on [agents#66](https://github.com/danny-avila/agents/pull/66). |

### danny-avila/agents

| Status | Branch | PR | Description / sync decision |
|--------|--------|----|-------------|
| Open | `feat/vision-capability` | [#257](https://github.com/danny-avila/agents/pull/257) | Optional vision gating: a `vision` constructor flag + `stripImagesFromMessages()` that strips `image_url` parts before `super._streamResponseChunks` when the model lacks vision support. **Clean minimal re-attempt** (3 files, with tests); supersedes the closed #48. Consumed by LibreChat [#13860](https://github.com/danny-avila/LibreChat/pull/13860). |
| Open | `feat/custom-reranker-provider` | [#66](https://github.com/danny-avila/agents/pull/66) | Custom reranker provider (configurable URL + model). **Kept.** |

### arabold/docs-mcp-server

| Status | Branch | PR | Description |
|--------|--------|----|-------------|
| TODO | `vector-dimension` | — | Configurable embedding dimension (`documents_vec` for Scaleway 3584, OpenRouter 1536) |

### jagan-shanmugam/open-streetmap-mcp

| Status | Branch | PR | Description |
|--------|--------|----|-------------|
| Open | — | [#11](https://github.com/jagan-shanmugam/open-streetmap-mcp/pull/11) | Docker port configuration and FastMCP 0.2.0+ compatibility |
| Waiting | — | depends on [#10](https://github.com/jagan-shanmugam/open-streetmap-mcp/pull/10) | HTTP transport support and Dockerfile (not our PR) |

### Notes

- Vision is re-enabled in `packages/librechat-init/config/librechat.yaml` as **experimental/WIP**. Requires the vision customizations in the `dev/librechat` and `dev/agents` forks (merged into fork main during the 2026-06 sync). Clean upstream re-attempts: [agents#257](https://github.com/danny-avila/agents/pull/257) + [LibreChat#13860](https://github.com/danny-avila/LibreChat/pull/13860). See [WIP Documentation](wip/README.md).