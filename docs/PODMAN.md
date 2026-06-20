# Running the stack with Podman

The local stacks run under rootless Podman as a lighter alternative to Docker. `podman compose` uses the same Docker Compose engine, pointed at Podman's Docker-API-compatible socket, so the same `docker-compose.local*.yml` files run under both Docker and Podman - there is no separate Podman compose file. The few Podman-specific bits are either no-ops under Docker (baked into the compose files) or driven by env vars the npm scripts set. Production stays on Docker (Portainer); this is for local development.

## Prerequisites

- Podman 5.x with `podman compose` (it delegates to the Docker Compose v2 plugin).
- The rootless Podman socket running:
  ```sh
  systemctl --user enable --now podman.socket
  ```
  It appears at `/run/user/$UID/podman/podman.sock` (Docker-API compatible).
- A generated `.env.local` (`npm run setup`).

## Quick start

```sh
npm run podman:local:up        # or podman:local-dev:up to build from the dev/ submodules
npm run podman:local:down
npm run podman:local:build     # build images
```

These set `CONTAINER_SOCKET` and `MONGODB_USER` automatically. Pass service names through, e.g. `npm run podman:local:up -- traefik maildev`.

To run it by hand:
```sh
CONTAINER_SOCKET=/run/user/$(id -u)/podman/podman.sock MONGODB_USER=999:999 \
  podman compose -f docker-compose.local.yml --env-file .env.local up -d
```

## What differs from Docker

The Podman-specific bits live in the same compose files; they are no-ops under Docker or default to the Docker values, so the Docker setup is unchanged.

- **Traefik socket.** Traefik's docker provider reads the runtime socket. `CONTAINER_SOCKET` (default `/var/run/docker.sock`) points it at the Podman socket instead. Set in `docker-compose.traefik.yml`.
- **SELinux.** On SELinux hosts (Fedora etc.) confined containers cannot read host-mounted paths and fail with `permission denied` (`os error 13` / docker API). `docker-compose.local*.yml` set `security_opt: label=disable` on Traefik (socket mount) and Meilisearch (bind-mounted `meili_data` dir). On a non-SELinux Docker host this is a no-op.
- **MongoDB volume ownership.** Under Docker a chown-init aligns the `mongodata` named volume to uid 1000 and mongod runs as 1000. That chown does not take effect under rootless Podman - the volume keeps the mongo image's default uid 999 - so forcing uid 1000 makes mongod fail with `Permission denied ... /data/db/journal`. `mongodb` runs as `${MONGODB_USER:-1000:1000}`; the podman npm scripts set `MONGODB_USER=999:999` to match the volume, and it defaults to `1000:1000` under Docker. Other stateful services with named volumes may need the same treatment (see Status).

`host.docker.internal:host-gateway` (used by Firecrawl) is supported natively by Podman 5.x. The `traefik.docker.network` labels work because the Podman socket presents networks over the Docker API.

## Ports 80 / 443 (rootless)

Rootless Podman cannot bind ports below 1024 by default. Two options:

- Allow low ports once (keeps `http://chat.localhost` on port 80, matching Docker):
  ```sh
  echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-rootless-ports.conf
  sudo sysctl --system
  ```
- Or use high ports without touching sysctl (URLs become `http://chat.localhost:8080`):
  ```sh
  TRAEFIK_HTTP_PORT=8080 TRAEFIK_HTTPS_PORT=8443 npm run podman:local:up
  ```

## Status

Validated under rootless Podman on Fedora (SELinux enforcing):

- **Traefik** - the docker provider connects over the Podman socket, discovers labeled services, and routes (`maildev.localhost` returns 200).
- **MongoDB** - healthy with `MONGODB_USER=999:999` (listens on 27017, `mongosh ping` returns 1). Fails as uid 1000 (see above).
- **Meilisearch** - listens on 7700 with `label=disable`. Fails without it (bind-mount SELinux denial).
- **An MCP server** (`mcp-calculator`, our ghcr image) - healthy on `app-net`.

Not yet exercised wholesale (the heavy services - the locally-built LibreChat app, the Firecrawl group, `rag_api`, `vectordb`, `openwebui`): a full bring-up was skipped to avoid resource contention with other live stacks on the dev host, not because of a known issue. When running them, watch for the same two failure classes:

- Bind-mounted path → SELinux denial → add `security_opt: label=disable` to that service in `docker-compose.local*.yml` (or `:z` on the specific mount).
- Named volume whose Docker chown-init targets uid 1000 → run the service as the image-default uid (as done for mongodb via `MONGODB_USER`). Candidates: `nuq-postgres` / `vectordb` (postgres data), `rabbitmq`, `firecrawl_pgdata`.

## Troubleshooting

- `permission denied ... docker API at unix:///var/run/docker.sock` - SELinux. Use the npm scripts; Traefik carries `label=disable` in the local compose files.
- `rootlessport cannot expose privileged port 80` - raise `ip_unprivileged_port_start` or set `TRAEFIK_HTTP_PORT`/`TRAEFIK_HTTPS_PORT` (see above).
- mongod `Permission denied ... /data/db/journal` (exit 100) - named-volume uid mismatch; the npm scripts set `MONGODB_USER=999:999`. A stale `mongodata` volume from an earlier run can still carry the wrong owner - `podman volume rm ai-chat-interface_mongodata` and bring it up again.
- Meilisearch `Permission denied (os error 13)` - SELinux on the `meili_data` bind mount; the local compose files add `label=disable`.
- Socket missing - `systemctl --user start podman.socket`.
