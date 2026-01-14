# Portainer (CE) – Deployment Notes

## Deploy

- **Prerequisite**: external Docker network exists: `loadbalancer-net`
- **Portainer**: Stacks → **Add stack** → **Git repository**
  - Compose path: `docker-compose.yml` (for production or test environment)
- **Environment**:
  - **Production**: Locally generate `npm run setup:prod` (creates `.env.prod`)
  - **Test Environment**: Locally generate `npm run setup:dev` (creates `.env.dev`)
  - In Portainer: Stack → **Environment variables** (Advanced mode) → paste `.env.prod` or `.env.dev` contents
- **Deploy** the stack

## Why `librechat-init` exists

Portainer CE can be unreliable with bind-mounting a **single file** from a Git repo. We therefore generate `librechat.yaml` via an init container (`librechat-init`) into a **named volume** (`librechat-config`). The `librechat-init` service also handles file permissions setup and MongoDB role initialization.

## Networking (important)

- `traefik-net` (compose key) is mapped to external Docker network **`loadbalancer-net`**
- `app-net` is the internal network for service-to-service traffic (LibreChat ↔ MongoDB/Meilisearch/RAG/WebSearch)
- **MongoDB does not need to be on `loadbalancer-net`**; it must be reachable from LibreChat on `app-net`

## Quick checks

- Config present: `docker exec LibreChat cat /app/config/librechat.yaml`
- Init logs: `docker logs librechat-init`
