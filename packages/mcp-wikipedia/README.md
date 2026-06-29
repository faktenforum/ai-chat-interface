# Wikipedia MCP Server

Wikipedia retrieval MCP for LibreChat agents. Wraps the upstream
[`wikipedia-mcp`](https://pypi.org/project/wikipedia-mcp/) pip package, pinned to `2.0.1`.

Provides search, article content, summaries, sections, links, and related topics from Wikipedia.

## Runtime

- Transport: `streamable-http` on port `3017`, path `/mcp`.
- Internal only - reachable on `app-net`, not exposed via Traefik.
- Used by the Research agent.

## Environment Variables

- `MCP_WIKIPEDIA_PORT`: Server port (default: `3017`).
- `WIKIPEDIA_ACCESS_TOKEN`: Optional. Raises Wikipedia API rate limits when set.

The image installs the pinned pip package and runs the server directly; there is no `/health`
endpoint, so the container healthcheck is a TCP connect on the port.
