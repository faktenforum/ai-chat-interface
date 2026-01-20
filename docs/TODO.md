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
  - Problem: Custom roles (e.g., DEVELOPER) are created in MongoDB but not visible in AdminSettingsDialog (only USER/ADMIN hardcoded)
  - Solution: Create LibreChat PR to add `GET /api/roles` endpoint and update `AdminSettingsDialog` to load roles dynamically
  - Repository: [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat)

### Agents
- [ ] Create agents and make them available to regular users only
  - Goal: Ensure provided tools function correctly and can be used, and that underlying LLM models are tested for their intended use cases
  - Consider creating agents named after their LLM models (with the corresponding LLM behind them)
  - Create a minimal general-purpose agent with common functions like web search

- [ ] Replace Jina reranker with RAG API reranker once LibreChat PR [#10574](https://github.com/danny-avila/LibreChat/pull/10574) is merged (adds `rerankerType: "simple"` support)

### RAG API - OpenRouter Embeddings Support
- [ ] Create feature request for OpenRouter provider support in RAG API
  - Problem: OpenRouter requires `HTTP-Referer` and `X-Title` headers for embeddings API, but `langchain`'s `OpenAIEmbeddings` doesn't set them automatically
  - Current workaround: Using `openai/text-embedding-3-small` instead of `baai/bge-m3` (multilingual, open source)
  - Solution: Request RAG API to add OpenRouter-specific header support or custom client configuration
  - Repository: [danny-avila/librechat-rag-api](https://github.com/danny-avila/librechat-rag-api)

### Model Specs Improvements

- [ ] Fix vision model detection for "Upload to AI Provider" option
  - Problem: Upload option shown for all OpenRouter models (provider-level), not model-level
  - Solution: Create LibreChat issue/PR to add model-level vision detection, or use alternative provider
  - Discussion: [#11333](https://github.com/danny-avila/LibreChat/discussions/11333) - Image Upload Option Shown for Non-Vision Models
- [ ] Add multilingual support for model specifications (modelSpecs)
  - Problem: Model `label`, `description`, and `group` fields in `librechat.yaml` are single-language only (no i18n support)
  - Impact: Currently hardcoded in German (e.g., "Vision Models (Open Source)", "Höchste Qualität für Gespräche..."), not adaptable to user language
  - Solution: Create LibreChat feature request/PR for multilingual model specifications
  - Workaround: Use English as default language or maintain separate configs per language
- [ ] Add multilingual support for MCP server configuration (title, description)
  - Problem: MCP server `title` and `description` in `librechat.yaml` are single-language only
  - Impact: Currently hardcoded in German (e.g., "Rechner", "Mathematische Berechnungen"), not adaptable to user language
  - Solution: Create LibreChat feature request/PR to support i18n for MCP server metadata (similar to model descriptions)
  - Workaround: Use English as default language or maintain separate configs per language
- [ ] Fix custom icon theme support
  - Problem: Custom icons (MCP servers, model selection groups) rendered as `<img>` tags, cannot use `currentColor` for theme adaptation
  - Solution: LibreChat issue [#11442](https://github.com/danny-avila/LibreChat/issues/11442) - render SVGs inline or add CSS variable support for icon colors

### OCR (Optical Character Recognition)

- [ ] Obtain official Mistral API key
  - Status: Configuration ready (`LIBRECHAT_OCR_API_KEY` in `.env.local`), using private key temporarily
  - Required for: OCR service AND direct Mistral model usage
  - Mistral Console: https://console.mistral.ai/
  - LibreChat Docs: https://www.librechat.ai/docs/features/ocr

### MCP Tools

- [ ] Fix MCP image generation tools sending artifacts to non-vision models
  - Problem: MCP tools returning `ImageContent` are converted to artifacts and sent to LLM, causing errors for non-vision models
  - Impact: Image generation works but triggers "404 No endpoints found that support image input" errors
  - Solution: LibreChat issue [#11413](https://github.com/danny-avila/LibreChat/issues/11413) - needs fix in artifact handling logic
- [ ] Fix negative max_tokens error with Scaleway/Mistral provider
  - Problem: MCP image generation fails with "max_tokens must be at least 1, got -1271527" when using Scaleway provider
  - Solution: LibreChat issue [#11435](https://github.com/danny-avila/LibreChat/issues/11435) - add Scaleway to RECOGNIZED_PROVIDERS
- [ ] Reduce SSE stream disconnection error logs
  - Problem: LibreChat logs show repeated "SSE stream disconnected" errors (TypeError: terminated, AbortError: This operation was aborted) even though MCP tools function correctly
  - Impact: Functionality works, but error logs are noisy and may indicate unnecessary reconnection attempts
  - Solution: Investigate if this is expected LibreChat behavior or if server-side improvements can reduce connection churn

---

## Providers

### European Providers
- [ ] Integrate Mistral AI (France) as direct provider
- [ ] Integrate Black Forest Labs (Germany) for FLUX models as direct provider

### Required Providers
- [ ] Integrate ElevenLabs for TTS (Text-to-Speech)
- [ ] Keep Jina reranker until replacement is ready (currently have free tokens for API key, not urgent)
