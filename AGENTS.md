# ai-chat-interface

Company AI infrastructure: LibreChat, Firecrawl, SearXNG, the RAG API, a set of MCP servers, and Traefik
in front. Docker Compose throughout, deployed through Portainer. When this repo sits inside the
Faktenforum workspace, the `AGENTS.md` one level up carries the shared conventions: commits, PRs, tone,
submodules.

Service inventory and per-service notes: [docs/SERVICES.md](docs/SERVICES.md), index in
[docs/README.md](docs/README.md).

## One structure, four entry points

The compose structure is identical for local and production. What differs is the env file and the volume
strategy, nothing else.

| Entry point | For | Images |
|---|---|---|
| `docker-compose.local.yml` | local dev | official images or `:latest` |
| `docker-compose.local-dev.yml` | local dev, built from `dev/` submodules | local builds |
| `docker-compose.prod.yml` | Portainer prod | registry `:latest` |
| `docker-compose.dev.yml` | Portainer dev and test | registry `:dev` |

The per-service files (`docker-compose.librechat.yml`, `docker-compose.mcp-*.yml`, `docker-compose.rag.yml`,
…) hold the base definition and are never run standalone. The four entry points extend them.

```bash
npm run setup                     # write .env.local; setup:prod / setup:dev for the others, :yes skips prompts
npm run build:local               # build the local stack
npm run rebuild:local <service>   # rebuild one service
npm run update:submodules
```

## Footguns

Each of these has cost someone real time.

- **Portainer ignores `env_file`.** Every service has to accept its configuration through the
  `environment:` section, or it starts unconfigured in prod without complaining.
- **Never bind-mount a config file in prod.** Portainer CE creates an empty directory in its place. Use
  an init container that writes into a named volume, the way `librechat-init` and `searxng-config-init`
  do.
- **`traefik-net` is external in prod** (`loadbalancer-net`) and must exist before the deploy. A prod
  compose file must not create it.
- **Prod and dev on one host need different `STACK_NAME`.** They share the external network, so without
  it both stacks register the same service name, Docker DNS returns two IPs, and connections alternate
  between stacks. It shows up as 404s and lost sessions, not as an obvious error.
- **List `app-net` before `traefik-net` for LibreChat.** Docker resolves in network order, so app-net
  first means `mcp-*` names resolve on the isolated per-stack network rather than the shared one.
- **An extension file with a `build` section needs a unique `image:` name**, different from the base
  file's fallback image. Otherwise Docker layers the build on top of itself and you run into the layer
  limit.
- **No `localhost` or `127.0.0.1` in a service URL.** Use the service name.
- **Build only the service you need.** A full `docker compose build` covers a dozen images and BuildKit
  caches every layer per context, which grows past 100 GB. Reclaim with `docker builder prune -af`,
  check with `docker system df`.

## dev/ submodules

`dev/` holds upstream repos and our forks. Only `docker-compose.local-dev.yml` builds from them. Do not
modify one unless it is a Faktenforum fork and the change is going upstream as a PR. The fork registry
is `scripts/submodules-upstream.yaml`; `npm run update:submodules` syncs them and sets up the upstream
remotes.

## Documentation

Minimal, scannable, precise: decisions, constraints, non-obvious behaviour, integration points. No
restatements of code, one source of truth per topic, concrete paths and commands over description. A new
`.md` file needs a link in `docs/README.md`.

## Scoped rules and skills

| Task | Where |
|---|---|
| Editing compose files or env examples | [.claude/rules/compose-stacks.md](.claude/rules/compose-stacks.md) |
| Adding, renaming or auto-generating an env var | [.claude/rules/env-vars.md](.claude/rules/env-vars.md) |
| Adding a service to the stack | skill `add-service` |
| Adding an MCP server | skill `add-mcp-server` |
| Working on a fork submodule or publishing its image | skill `fork-submodule` |
