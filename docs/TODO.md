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

- [ ] Fix vision model detection for "Upload to AI Provider" option
  - LibreChat discussion [#11333](https://github.com/danny-avila/LibreChat/discussions/11333)
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

### MCP Tools

- [ ] Fix MCP image generation tools sending artifacts to non-vision models
  - LibreChat issue [#11413](https://github.com/danny-avila/LibreChat/issues/11413)
- [ ] Fix negative max_tokens error with Scaleway/Mistral provider
  - LibreChat issue [#11435](https://github.com/danny-avila/LibreChat/issues/11435)
- [ ] Reduce SSE stream disconnection error logs
  - Known issue: `streamable-http` MCP servers use stateless HTTP POST while LibreChat's `StreamableHTTPClientTransport` attempts SSE streams, causing "Bad Request" errors. Servers function correctly. Log rotation configured.
  - Related: [LibreChat Discussion #11230](https://github.com/danny-avila/LibreChat/discussions/11230)
- [ ] Re-enable Firecrawl MCP server after connection stability is fixed
  - Status: Currently disabled due to unstable connection to MCP server
  - The tool is very helpful for reading special URLs, but connection issues prevent reliable usage
  - Waiting for fix before re-enabling in `librechat.yaml` and `agents.json`
  - Related to SSE stream disconnection issue above

---

## Providers

### European Providers
- [ ] Integrate Mistral AI (France) as direct provider
- [ ] Integrate Black Forest Labs (Germany) for FLUX models as direct provider

### Required Providers
- [ ] Integrate ElevenLabs for TTS (Text-to-Speech)
- [ ] Keep Jina reranker until replacement is ready (currently have free tokens for API key, not urgent)
