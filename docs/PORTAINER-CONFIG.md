# Portainer Configuration (CE)

## Why bind-mounting a single config file fails

Portainer CE can create **empty directories** for bind-mounted files before the Git repo is available. Example:

```yaml
volumes:
  - ./config/librechat.yaml:/app/config/librechat.yaml # do not do this in Portainer CE
```

Directory mounts work reliably (e.g. `./config/searxng:/etc/searxng`).

## Our solution: `config-init` + named volume

We generate `/app/config/librechat.yaml` into a **named volume** (`librechat-config`) via an init container (`config-init`).

Important: **No `envsubst`**. The generated YAML contains escaped placeholders like `$${OPENROUTER_KEY}` and LibreChat resolves them at runtime from the container environment (`process.env`).

## Deploy in Portainer

1. Create/ensure the external Traefik network exists (on the host):
   - `loadbalancer-net`
2. In Portainer: Stack → Git repository
   - Compose path: `docker-compose.prod.yml`
3. Paste the full `.env.prod` content into Stack → **Environment variables** (advanced mode)
4. Deploy the stack

## Troubleshooting

### Networking (most common)

- Production uses `traefik-net` as an external network named `loadbalancer-net` (see `docker-compose.prod.yml`).
- If services suddenly cannot resolve each other: fully redeploy the stack (Portainer may not reconnect networks on update).

### Verify generated config

```bash
docker exec LibreChat cat /app/config/librechat.yaml
```

### Check init logs

```bash
docker logs librechat-config-init
```
