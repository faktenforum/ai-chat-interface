---
paths:
  - "docker-compose*.yml"
  - "env.*.example"
---

# Compose conventions

Local and prod share one structure. Only the env file and the volume strategy differ.

| Concern | Local | Production |
|---|---|---|
| Env | `env_file: .env.local` in the entry point | `environment:` section only, Portainer ignores `env_file` |
| Volumes | Named volumes, prefixed `{service}_data` | Named volumes, `name: ${STACK_NAME:-prod}-{service}-data` |
| Config files | Written by an init container into a named volume | Same. Never a bind mount. |
| `traefik-net` | Bridge, created locally | External `loadbalancer-net`, must already exist |
| Container names | `{service}` | `${STACK_NAME:-prod}-{service}` |
| Images | Local build or `:latest` | Registry only, `:latest` for prod and `:dev` for the dev stack |

Networks, volumes and Traefik routers all take the same `${STACK_NAME:-prod}-` prefix in prod.

## Base file vs extension

A per-service `docker-compose.{service}.yml` holds the base definition and is never run on its own. The
four entry points (`local`, `local-dev`, `prod`, `dev`) extend it with `extends:` and add what is
environment-specific: `env_file` locally, `container_name` and Traefik TLS routers in prod.

The base file names a fallback image (`node:24-alpine`, `python:3.13-slim`). **An extension file that
adds a `build:` section must override `image:` with a unique name**, for instance
`ghcr.io/faktenforum/{service}:latest`. Reusing the base image name makes Docker layer the build on top
of itself until it hits the layer limit.

Which image strategy applies:

- A service with a GitHub Actions workflow uses the registry image in prod and dev, with no `build`
  section at all.
- A service with a custom Dockerfile and no workflow uses `build` plus a unique `image:` name.
- An official, unmodified image is referenced directly (`postgres:16`, `redis:7-alpine`).

## Service definition defaults

- Healthcheck: HTTP GET `/health` where it exists, interval 30s, timeout 10s, retries 3,
  start_period 40s. Fall back to a socket check when the service has no HTTP endpoint.
- Resource limits: 0.5 to 2.0 CPU, 256M to 2G, matched to the service.
- Logging: json-file driver, max-size 10m, max-file 3, compress true.
- Service names are kebab-case (`firecrawl-redis`, not `firecrawl_redis`).
- Init containers are wired with `depends_on` and `condition: service_completed_successfully`.

## Networks

- Reachable through Traefik: `traefik-net` plus `app-net`.
- Internal only, including every MCP server: `app-net` only.
- Databases: `app-net` only, never `traefik-net`.
- An isolated service group can have its own network, as `firecrawl-network` does.

Traefik labels always carry `traefik.enable=true`, a router rule, an entrypoint and a service port.
Locally `traefik.docker.network=ai-chat-interface_traefik-net` and entrypoint `web`. In prod
`traefik.docker.network=loadbalancer-net` plus a second `-secure` router on `websecure` with `tls=true`
and `certresolver=le`.

## Security by environment

Prod and the dev stack are both reachable from the internet and get the same treatment: HTTPS, Basic
Auth on anything exposed, `SECURE_COOKIE=true`. Local runs plain HTTP with auth disabled.

## After a change

```bash
npm run setup:yes && docker compose down -v && sleep 3 && docker compose up -d   # local, clean slate
docker compose --env-file .env.prod -f docker-compose.prod.yml up                # prod shape
```

A new service also needs its row in `docs/SERVICES.md`.
