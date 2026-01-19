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

**Important:** If you modify `packages/librechat-init/config/librechat.yaml` (e.g., MCP server configuration, title, description, iconPath) or add MCP server icons to `packages/librechat-init/assets/`, the `librechat-init` image must be rebuilt. In Portainer, this happens automatically when you redeploy the stack from Git, but you may need to manually trigger a rebuild if using GitOps updates.

## Networking (important)

- `traefik-net` (compose key) is mapped to external Docker network **`loadbalancer-net`**
- `app-net` is the internal network for service-to-service traffic (LibreChat ↔ MongoDB/Meilisearch/RAG/WebSearch)
- **MongoDB does not need to be on `loadbalancer-net`**; it must be reachable from LibreChat on `app-net`

## GitOps Updates (Automatic Updates via Webhooks)

Enable automatic stack updates from GitHub using webhooks for immediate deployment when changes are pushed.

### Setup

1. **Enable GitOps in Portainer:**
   - Go to **Stacks** → Select your stack → **Editor**
   - Scroll to **GitOps updates** section
   - Enable **Automatic updates**
   - Select **Webhook** as update mechanism
   - **Copy the webhook URL** (e.g., `https://portainer.example.com/api/webhooks/<webhook-id>`)

2. **Configure GitHub Webhook:**
   - Go to your GitHub repository → **Settings** → **Webhooks** → **Add webhook**
   - **Payload URL**: Paste the webhook URL from Portainer
   - **Content type**: `application/json`
   - **Events**: Select **Just the push event**
   - **Active**: ✓ Enabled
   - Click **Add webhook**

When changes are pushed to the repository, Portainer automatically pulls the latest code and updates the stack. All volumes are preserved (data is not lost).

## Quick checks

- Config present: `docker exec <STACK_NAME>-librechat cat /app/config/librechat.yaml` (e.g., `prod-librechat` or `dev-librechat`)
- Init logs: `docker logs <STACK_NAME>-librechat-init` (e.g., `prod-librechat-init` or `dev-librechat-init`)
