# MCP Grounded Docs

[Grounded Docs](https://github.com/arabold/docs-mcp-server) MCP server: documentation index for AI (websites, GitHub, npm, local files). We use the [Faktenforum fork](https://github.com/faktenforum/docs-mcp-server) at `dev/docs-mcp-server` and build the image from the submodule (Pattern 3). The fork adds a configurable embedding dimension so Scaleway (3584) and OpenRouter (1536) work without DB mismatch.

## Configuration

| Env / Item | Description |
|------------|-------------|
| `MCP_DOCS_PORT` | MCP HTTP port (default `6280`). Must match LibreChat `url` in `librechat.yaml`. |
| `MCP_DOCS_OPENAI_API_KEY` | Optional. API key for embeddings. |
| `MCP_DOCS_OPENAI_API_BASE` | Optional. Base URL for OpenAI-compatible embeddings API. |
| `MCP_DOCS_EMBEDDING_MODEL` | Optional. Model name (e.g. `bge-multilingual-gemma2`, `openai/text-embedding-3-small`). |
| `MCP_DOCS_EMBEDDINGS_VECTOR_DIMENSION` | Optional. Vector dimension; required for Scaleway (`3584`). Omit for OpenRouter (1536 default). |
| Volumes | `/data` → `docs-mcp-data`, `/config` → `docs-mcp-config`. |

## Embeddings

Optional. Without them the server uses full-text search only. We map `MCP_DOCS_*` to the server’s `OPENAI_API_*` / `DOCS_MCP_*` in [docker-compose.mcp-docs.yml](../docker-compose.mcp-docs.yml). Upstream: [Embedding Models](https://github.com/arabold/docs-mcp-server/blob/main/docs/guides/embedding-models.md).

- **Scaleway:** `MCP_DOCS_OPENAI_API_KEY` / `MCP_DOCS_OPENAI_API_BASE` (e.g. `${SCALEWAY_API_KEY}`, `${SCALEWAY_BASE_URL}`), `MCP_DOCS_EMBEDDING_MODEL=bge-multilingual-gemma2`, `MCP_DOCS_EMBEDDINGS_VECTOR_DIMENSION=3584`.
- **OpenRouter:** Base `https://openrouter.ai/api/v1`, key (e.g. `${OPENROUTER_KEY}`), model e.g. `openai/text-embedding-3-small`; do not set `MCP_DOCS_EMBEDDINGS_VECTOR_DIMENSION`.

## LibreChat & local

- **LibreChat:** URL `http://mcp-docs:6280/mcp`, allowedDomains `mcp-docs`. Title: Grounded Docs. Description: Aktuelle Dokumentation durchsuchen – Websites, GitHub, npm, lokale Dateien.
- **Local / Cursor:** Local stack exposes `127.0.0.1:${MCP_DOCS_PORT:-6280}`. `.cursor/mcp.json`: `"docs": { "url": "http://localhost:6280/mcp" }`. Web UI not exposed by default.

Not used: upstream distributed mode (worker + mcp + web); Traefik exposure (internal only).
