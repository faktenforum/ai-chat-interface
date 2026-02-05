# MCP Grounded Docs

[Grounded Docs](https://github.com/arabold/docs-mcp-server) MCP server: documentation index for AI (websites, GitHub, npm, local files). External image: `ghcr.io/arabold/docs-mcp-server:latest`. Integrated as **Pattern 2** (no build).

## Configuration

| Env / Item | Description |
|------------|-------------|
| `MCP_DOCS_PORT` | MCP HTTP port (default `6280`). Must match LibreChat `url` port in `librechat.yaml`. |
| `OPENAI_API_KEY` | Optional. Enables semantic vector search (embedding model). |
| `DOCS_MCP_EMBEDDING_MODEL` | Optional. e.g. `openai:text-embedding-3-small`. See upstream [Embedding Models](https://github.com/arabold/docs-mcp-server/blob/main/docs/guides/embedding-models.md). |
| Volumes | `/data` → `docs-mcp-data`, `/config` → `docs-mcp-config`. Persist index and config. |

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
