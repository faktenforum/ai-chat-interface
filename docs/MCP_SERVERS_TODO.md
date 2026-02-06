# MCP Servers to Test

TODO list of MCP servers to evaluate and integrate for specific agents.

| MCP Server / Concept | Target Agent | Status |
|----------------------|--------------|--------|
| [x-twitter-mcp-server](#1-x-twitter-mcp-server) | Social Networks (Soziale Netzwerke) | [ ] |
| [Context7](#2-context7) | Developer Support (Entwickler-Support) | [ ] |
| [Wikipedia MCP](#3-wikipedia-mcp) | Research Assistant (Recherche-Assistent) | [ ] |
| [Code execution with MCP](#4-code-execution-with-mcp-concept) | TBD (developer / data workflows) | [ ] — still searching for suitable server |

---

## 1. x-twitter-mcp-server

- **Repository:** [rafaljanicki/x-twitter-mcp-server](https://github.com/rafaljanicki/x-twitter-mcp-server)
- **Purpose:** X/Twitter MCP server — fetch tweets, post, search, manage followers, timelines, bookmarks via Twitter API v2.
- **Target agent:** Social Networks (Soziale Netzwerke)
- **Prerequisites:** Twitter Developer API credentials (API Key, Secret, Access Token, Access Token Secret, Bearer Token).
- **Transport:** Streamable HTTP (`POST /mcp`), SSE; also STDIO. Docker image available (port 8081).
- **Tasks:**
  - [ ] Obtain/evaluate Twitter API access and rate limits
  - [ ] Test Streamable HTTP vs STDIO with LibreChat
  - [ ] Add to Docker stack or document as external MCP
  - [ ] Create/update “Soziale Netzwerke” agent and assign this MCP

---

## 2. Context7

- **Repository:** [upstash/context7](https://github.com/upstash/context7/tree/master)
- **Purpose:** Up-to-date, version-specific code documentation for LLMs — resolves library IDs and fetches docs from source.
- **Target agent:** Developer Support (Entwickler-Support)
- **Transport:** Remote HTTP (`https://mcp.context7.com/mcp`) or local (`npx -y @upstash/context7-mcp --api-key KEY`). API key recommended (free at context7.com/dashboard).
- **Tasks:**
  - [ ] Get Context7 API key and test remote vs local
  - [ ] Verify compatibility with LibreChat MCP client
  - [ ] Create/update “Entwickler-Support” agent and assign this MCP
  - [ ] Document rule/prompt usage (e.g. “use context7” / library IDs)

---

## 3. Wikipedia MCP

- **Repository:** [Rudra-ravi/wikipedia-mcp](https://github.com/Rudra-ravi/wikipedia-mcp/tree/main)
- **Purpose:** Wikipedia search, article content, summaries, sections, links, related topics; optional multi-language and caching.
- **Target agent:** Research Assistant (Recherche-Assistent)
- **Transport:** STDIO or SSE. Docker image available. Optional Wikipedia access token for rate limits.
- **Tasks:**
  - [ ] Test STDIO vs SSE with LibreChat
  - [ ] Decide Docker vs external (e.g. pipx) deployment
  - [ ] Add to stack and wire to “Recherche-Assistent” agent
  - [ ] Optionally configure language/country and caching

---

## 4. Code execution with MCP (concept)

- **Concept:** [Code execution with MCP: Building more efficient agents](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1780) — agents write and execute code to call MCP tools instead of direct tool calls, so tool definitions and large results don’t always consume LLM context; better scaling for data-heavy workflows (see [Anthropic engineering post](https://www.anthropic.com/engineering/code-execution-with-mcp)).
- **Target agent:** TBD (e.g. developer or data-analysis agent).
- **Status:** We want to test this concept but are still searching for a suitable MCP server. Promising candidate to evaluate:
  - **[alfonsograziano/node-code-sandbox-mcp](https://github.com/alfonsograziano/node-code-sandbox-mcp)** — Node.js MCP server that runs arbitrary JavaScript in ephemeral Docker containers; tools: `run_js_ephemeral`, `sandbox_initialize` / `sandbox_exec` / `run_js` / `sandbox_stop`, `search_npm_packages`. Requires Docker; supports STDIO (e.g. npx) or Docker image `mcp/node-code-sandbox`.
- **Tasks:**
  - [ ] Evaluate node-code-sandbox-mcp (security, LibreChat compatibility, STDIO/Docker)
  - [ ] Compare with other code-execution MCPs (e.g. [mcp-use/mcp-use](https://github.com/mcp-use/mcp-use) code_mode, [olaservo/code-execution-with-mcp](https://github.com/olaservo/code-execution-with-mcp))
  - [ ] Decide if we adopt this pattern and which server to use
  - [ ] Define target agent and integration (sandbox limits, network access)

---

See [SERVICES.md](SERVICES.md), [create-new-mcp](../.cursor/rules/create-new-mcp.mdc), [AGENT_MCP_SUGGESTIONS.md](AGENT_MCP_SUGGESTIONS.md).
