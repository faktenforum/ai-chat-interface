# Portainer (CE) – Deployment Notes

## Deploy

- **Prerequisite**: external Docker network exists: `loadbalancer-net`
- **Portainer**: Stacks → **Add stack** → **Git repository**
  - Compose path: `docker-compose.prod.yml` (for production or test environment)
- **Environment**:
  - **Production**: Locally generate `npm run setup:prod` (creates `.env.prod`)
  - **Test Environment**: Locally generate `npm run setup:dev` (creates `.env.dev`)
  - In Portainer: Stack → **Environment variables** (Advanced mode) → paste `.env.prod` or `.env.dev` contents
  - **Important**: The `STACK_NAME` variable in `.env.prod` (set to `prod`) and `.env.dev` (set to `dev`) ensures that container names, volumes, and networks are prefixed to avoid conflicts when running multiple stacks on the same host
- **Deploy** the stack

## Why `librechat-init` exists

Portainer CE can be unreliable with bind-mounting a **single file** from a Git repo. We therefore generate `librechat.yaml` via an init container (`librechat-init`) into a **named volume** (`librechat-config`). The `librechat-init` service also handles file permissions setup and MongoDB role initialization.

## Networking (important)

- `traefik-net` (compose key) is mapped to external Docker network **`loadbalancer-net`**
- `app-net` is the internal network for service-to-service traffic (LibreChat ↔ MongoDB/Meilisearch/RAG/WebSearch)
- **MongoDB does not need to be on `loadbalancer-net`**; it must be reachable from LibreChat on `app-net`

## Quick checks

- Config present: `docker exec <STACK_NAME>-librechat cat /app/config/librechat.yaml` (e.g., `prod-librechat` or `dev-librechat`)
- Init logs: `docker logs <STACK_NAME>-librechat-init` (e.g., `prod-librechat-init` or `dev-librechat-init`)
