---
name: add-mcp-server
description: Integrate a new MCP server into ai-chat-interface and LibreChat. Use when adding an MCP server (self-written package, third-party image, upstream or forked submodule, or a remote hosted HTTPS service), wiring it into librechat.yaml, or when asked to "add an MCP", "register an MCP server", "add a tool to LibreChat".
---

# Adding an MCP server

General service conventions are in `.claude/rules/compose-stacks.md` and the `add-service` skill. This
covers what is MCP-specific.

## Ask first which pattern applies

**Do not assume.** If the approach is not already decided, present these and let the user pick:

| Pattern | What it is | Compose | Package or submodule | We publish an image |
|---|---|---|---|---|
| 1. Self-written | Our package in `packages/mcp-{name}/` with our Dockerfile and workflow | yes | `packages/mcp-{name}/` | `ghcr.io/faktenforum/mcp-{name}` |
| 2. External image | A third-party image used as-is | yes | no | no |
| 3. Submodule, upstream | Upstream repo in `dev/`, their published image | yes | submodule only | no |
| 4. Submodule, fork | Our fork in `dev/`, we build and publish | yes | submodule only | `ghcr.io/faktenforum/mcp-{name}` |
| 5. Remote hosted | An HTTPS service such as GitHub MCP or Mapbox | no | no | not applicable |

## Common to patterns 1-4

`app-net` only and **no Traefik labels** - MCP servers are internal. Expose the port, never publish it,
except for the local IDE testing case below. Healthcheck on HTTP GET `/health` where the server has one,
socket check otherwise; interval 30s, timeout 10s, retries 3, start_period 40s. Resource limits 0.5 CPU
and 256M. Environment pattern `MCP_{NAME}_PORT`, `MCP_{NAME}_LOG_LEVEL`, optionally
`MCP_{NAME}_API_KEYS`, added to all three env example files.

Base file `docker-compose.mcp-{name}.yml` plus entries in the four entry points. In prod set
`container_name: ${STACK_NAME:-prod}-mcp-{name}`.

### Pattern 1 specifics

`packages/mcp-{name}/` with:

- `package.json` as `@ai-chat-interface/mcp-{name}`, `type: "module"`, dependencies
  `@modelcontextprotocol/sdk`, `zod`, `express`, `pino`, `dotenv`, and `"start": "./src/server.ts"`.
  Run `npx npm-check-updates -u` then `npm install`. `chmod +x ./src/server.ts` or the start script fails.
- Local dev scripts through `dotenv-cli`: `start:local`, `dev:local`, `test:integration:local`,
  `test:http:local`, each as `dotenv -e ../../.env.local -- …`.
- `tsconfig.json`: ES2022, NodeNext, strict, `noEmit` - the TS runs directly.
- `src/server.ts` Express with `/mcp` and `/health`, `src/tools/` with Zod schemas,
  `src/utils/logger.ts` (pino, `LOG_LEVEL`), `src/utils/errors.ts`.
- `Dockerfile` on Node 24-alpine, non-root user, `--experimental-strip-types`, healthcheck.

Session handling is required for streamable-http:

```typescript
const transports = new Map<string, StreamableHTTPServerTransport>();

function getSessionId(headers: Request['headers']): string | undefined {
  const header = headers['mcp-session-id'] || headers['Mcp-Session-Id'];
  return typeof header === 'string' ? header : undefined;
}
```

### Patterns 3 and 4 specifics

Add the submodule under `dev/{name}-mcp/` with its `path`, `url` and `branch` in `.gitmodules`, run
`git submodule update --init --recursive dev/<path>`, and update `dev/README.md`. For a fork, also add
the entry in `scripts/submodules-upstream.yaml` and follow the `fork-submodule` skill: base compose
carries the registry image with no `build`, local entry points add `build: { context: ./dev/{name}-mcp }`
under the same image name, prod and dev pull only.

## LibreChat configuration

Every pattern ends here, in `packages/librechat-init/config/librechat.yaml`.

Add the host to `mcpSettings.allowedDomains` - the Docker service name for patterns 1-4, the exact
external domain with no wildcard for pattern 5. Then:

```yaml
mcpServers:
  {name}:
    type: streamable-http
    url: http://mcp-{name}:{PORT}/mcp    # or https://mcp.{name}.com/mcp for remote
    title: {Display Name}
    description: {short, user-facing, no jargon}
    iconPath: /images/mcp-{name}-icon.svg
    initTimeout: 120000
    chatMenu: true                        # false for agent-only servers
    startup: true
    serverInstructions: true
```

A remote server adds `headers:` with its auth, usually
`Authorization: "Bearer ${MCP_{NAME}_ACCESS_TOKEN}"`. Document in the env examples where the token comes
from and which scopes it needs.

The description is what a user reads in the UI. Say what the tool does; avoid "MCP server", "API",
"endpoint".

## Icon

`packages/librechat-init/assets/mcp-{name}-icon.svg`, 24x24, Lucide-compatible, and the filename must
match exactly. `librechat-init` copies `mcp-*-icon.svg` into `/images/`, so no code change is needed.
After an icon change, rebuild `librechat-init` and restart the stack.

## Local testing from an IDE

Add `ports: ["127.0.0.1:{PORT}:{PORT}"]` in `docker-compose.local.yml` with a comment marking it
local-only, and register the server in the local MCP client config (`.cursor/mcp.json`) as
`"{name}": { "url": "http://localhost:{PORT}/mcp" }`. Tool or schema changes are not picked up until the
MCP connection is refreshed, and a code change needs the container rebuilt first. Watch
`docker logs -f mcp-{name}` and the logs of whatever upstream service the tool calls - failures usually
surface there first. Add `logger.debug` at tool entry, around external calls and on error, and include a
request or task ID so the two log streams can be lined up.

Finally verify in the LibreChat UI: the server shows up in agent config and the chat menu if enabled, and
the tools work in a conversation.
