# MCP Grounded Docs

[Grounded Docs](https://github.com/arabold/docs-mcp-server) MCP server: documentation index for AI (websites, GitHub, npm, local files). External image: `ghcr.io/arabold/docs-mcp-server:latest`. Integrated as **Pattern 2** (no build).

## Configuration

| Env / Item | Description |
|------------|-------------|
| `MCP_DOCS_PORT` | MCP HTTP port (default `6280`). Must match LibreChat `url` port in `librechat.yaml`. |
| `MCP_DOCS_OPENAI_API_KEY` | Optional. API key for embeddings (Scaleway or OpenRouter). |
| `MCP_DOCS_OPENAI_API_BASE` | Optional. Base URL for OpenAI-compatible embeddings API. |
| `MCP_DOCS_EMBEDDING_MODEL` | Optional. Model name (e.g. `bge-multilingual-gemma2`, `openai/text-embedding-3-small`). |
| `MCP_DOCS_EMBEDDINGS_VECTOR_DIMENSION` | Optional. Vector dimension; required for Scaleway (3584). Omit for OpenRouter (1536 default). |
| Volumes | `/data` → `docs-mcp-data`, `/config` → `docs-mcp-config`. Persist index and config. |

## Embeddings

Embeddings are **optional**. Without them, the server uses full-text search only. With an OpenAI-compatible embeddings API (key + base URL + model), vector search is enabled for better semantic results. The server reads `OPENAI_API_KEY`, `OPENAI_API_BASE`, and embedding model from config; in this project we set these via the `MCP_DOCS_*` env vars (see [docker-compose.mcp-docs.yml](../docker-compose.mcp-docs.yml)). Upstream: [Embedding Models](https://github.com/arabold/docs-mcp-server/blob/main/docs/guides/embedding-models.md).

**Scaleway** (EU, reuse existing Scaleway vars):

- `MCP_DOCS_OPENAI_API_KEY` = `${SCALEWAY_API_KEY}` (or same value as `SCALEWAY_API_KEY`).
- `MCP_DOCS_OPENAI_API_BASE` = `${SCALEWAY_BASE_URL}` (e.g. `https://api.scaleway.ai/v1`).
- `MCP_DOCS_EMBEDDING_MODEL` = `bge-multilingual-gemma2`.
- `MCP_DOCS_EMBEDDINGS_VECTOR_DIMENSION` = `3584` (required; model output dimension).

**OpenRouter** (e.g. OpenAI embedding models):

- `MCP_DOCS_OPENAI_API_BASE` = `https://openrouter.ai/api/v1`.
- `MCP_DOCS_OPENAI_API_KEY` = your OpenRouter API key (e.g. same as `OPENROUTER_KEY`).
- `MCP_DOCS_EMBEDDING_MODEL` = e.g. `openai/text-embedding-3-small` or `openai/text-embedding-3-large`.
- Do not set `MCP_DOCS_EMBEDDINGS_VECTOR_DIMENSION` (default 1536).

## LibreChat

- **URL**: `http://mcp-docs:6280/mcp` (streamable-http).
- **allowedDomains**: `mcp-docs`.
- **Title**: Grounded Docs. **Description**: Aktuelle Dokumentation durchsuchen – Websites, GitHub, npm, lokale Dateien.

## Local / Cursor IDE

- Local stack exposes `127.0.0.1:${MCP_DOCS_PORT:-6280}`. `.cursor/mcp.json`: `"docs": { "url": "http://localhost:6280/mcp" }`.
- Web UI (add docs via browser) is not exposed by default; add a port mapping to the docs-mcp-server Web port (e.g. 6281 in upstream) if needed.

## Out of scope

- Distributed mode (worker + mcp + web) from upstream docker-compose is not used; single-container standalone only.
- Traefik exposure for Web UI: not configured; internal only.
