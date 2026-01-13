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
  - Issue: [#11321](https://github.com/danny-avila/LibreChat/issues/11321) - Image Upload Option Shown for Non-Vision Models
- [ ] Add multilingual support for model descriptions
  - Problem: Descriptions are single-language only (no i18n support)
  - Solution: Create LibreChat feature request/PR for multilingual model descriptions
- [ ] Fix custom icon theme support
  - Problem: Custom icons (Data URIs/URLs) rendered as `<img>` tags, cannot use `currentColor` for theme adaptation
  - Solution: Create LibreChat PR to render SVGs inline or add CSS variable support for icon colors

---

## Providers

### European Providers
- [ ] Integrate Mistral AI (France) as direct provider
- [ ] Integrate Black Forest Labs (Germany) for FLUX models as direct provider

### Required Providers
- [ ] Integrate ElevenLabs for TTS (Text-to-Speech)
- [ ] Keep Jina reranker until replacement is ready (currently have free tokens for API key, not urgent)
