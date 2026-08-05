---
name: add-service
description: Integrate a new Docker service into the ai-chat-interface stack. Use when adding a container to the compose stacks, wiring Traefik routing for it, giving it a GitHub Actions build workflow, or when asked to "add a service", "expose a service via Traefik", or "publish an image to ghcr". For MCP servers use add-mcp-server instead.
---

# Adding a service

Compose conventions, image strategy and network assignment are in
`.claude/rules/compose-stacks.md`; env var mechanics are in `.claude/rules/env-vars.md`. This is the
order of work.

## 1. Base definition

Create `docker-compose.{service}.yml` with the service, its `environment:` section (never rely on
`env_file`, Portainer ignores it), volumes, networks, a healthcheck, and resource limits. Name a fallback
image. Add the comment that Traefik labels live in the entry-point files.

## 2. Extension files

Add the service to all four entry points:

- `docker-compose.local.yml`: extend the base, add `env_file: .env.local`, HTTP-only Traefik labels,
  and a `build:` section if it builds locally.
- `docker-compose.local-dev.yml`: same, when the service builds from a `dev/` submodule.
- `docker-compose.prod.yml`: extend, add `container_name: ${STACK_NAME:-prod}-{service}`, HTTP and HTTPS
  Traefik labels, `${STACK_NAME:-prod}-` prefixed volumes, `:latest` image.
- `docker-compose.dev.yml`: same as prod with the `:dev` tag.

## 3. Environment variables

Add every variable to `env.local.example`, `env.prod.example` and `env.dev.example`. Secrets go into
`AUTO_GENERATED` in `scripts/setup-env.ts`, user-supplied values into `PROMPTS`. See
`.claude/rules/env-vars.md`.

## 4. Traefik labels

Local:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.docker.network=ai-chat-interface_traefik-net"
  - "traefik.http.routers.{service}.rule=Host(`{service}.${DOMAIN:-localhost}`)"
  - "traefik.http.routers.{service}.entrypoints=web"
  - "traefik.http.services.{service}.loadbalancer.server.port={port}"
```

Production adds the prefixed router names and a second `-secure` router:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.docker.network=loadbalancer-net"
  - "traefik.http.routers.${STACK_NAME:-prod}-{service}.rule=Host(`{service}.${DOMAIN:-localhost}`)"
  - "traefik.http.routers.${STACK_NAME:-prod}-{service}.entrypoints=web"
  - "traefik.http.services.${STACK_NAME:-prod}-{service}.loadbalancer.server.port={port}"
  - "traefik.http.routers.${STACK_NAME:-prod}-{service}-secure.rule=Host(`{service}.${DOMAIN:-localhost}`)"
  - "traefik.http.routers.${STACK_NAME:-prod}-{service}-secure.entrypoints=websecure"
  - "traefik.http.routers.${STACK_NAME:-prod}-{service}-secure.tls=true"
  - "traefik.http.routers.${STACK_NAME:-prod}-{service}-secure.tls.certresolver=le"
```

An internal service gets no Traefik labels and `app-net` only.

## 5. Build workflow

Required for any service with a custom or modified Dockerfile in this repo, directly or through a
submodule. Create `.github/workflows/build-{service}.yml` from an existing one:

- trigger on pushes touching `{service-path}/**` and the workflow file
- `submodules: true` in the checkout when the service lives in `dev/`
- build context `./{service-path}`, image `ghcr.io/faktenforum/{service}` (lowercase, hyphens)
- tags: `latest` on the default branch, `dev` on feature branches, plus the branch name
- platform `linux/amd64`, GitHub Actions cache, permissions `contents: read` and `packages: write`

A service with a workflow then uses the registry image in prod and dev with **no** `build` section.

## 6. Document and verify

Add the service to the matrix table and a details section in `docs/SERVICES.md`, and create
`docs/{SERVICE}.md` if it needs real setup notes (linked from `docs/README.md`).

```bash
npm run setup:yes
docker compose -f docker-compose.local.yml up -d {service}
curl http://localhost:{PORT}/health
docker compose logs {service}
```

Then check the Traefik route at `http://{service}.${DOMAIN:-localhost}`.
