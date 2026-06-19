# Running the stack with Podman

The local stacks run under rootless Podman as a lighter alternative to Docker. `podman compose` uses the same Docker Compose engine, pointed at Podman's Docker-API-compatible socket, so the existing compose files work unchanged. Production stays on Docker (Portainer); this is for local development.

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

These set `CONTAINER_SOCKET` automatically and add the `docker-compose.podman.yml` override. Pass service names through, e.g. `npm run podman:local:up -- traefik maildev`.

To run it by hand:
```sh
CONTAINER_SOCKET=/run/user/$(id -u)/podman/podman.sock \
  podman compose -f docker-compose.local.yml -f docker-compose.podman.yml --env-file .env.local up -d
```

## What differs from Docker

All handled by the override + env, so the Docker setup is untouched:

- **Traefik socket.** Traefik's docker provider reads the runtime socket. `CONTAINER_SOCKET` (default `/var/run/docker.sock`) points it at the Podman socket instead. Set in `docker-compose.traefik.yml`.
- **SELinux.** On SELinux hosts (Fedora etc.) confined containers cannot read host-mounted paths and fail with `permission denied` (`os error 13` / docker API). `docker-compose.podman.yml` adds `security_opt: label=disable` to the affected services - Traefik (socket mount) and Meilisearch (bind-mounted `meili_data` dir).
- **MongoDB volume ownership.** Under Docker a chown-init aligns the `mongodata` named volume to uid 1000 and mongod runs as 1000. That chown does not take effect under rootless Podman - the volume keeps the mongo image's default uid 999 - so forcing uid 1000 makes mongod fail with `Permission denied ... /data/db/journal`. The override runs mongodb as `999:999` to match the volume. Other stateful services with named volumes may need the same treatment (see Status).

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
- **MongoDB** - healthy with the `999:999` override (listens on 27017, `mongosh ping` returns 1). Fails without it (see above).
- **Meilisearch** - listens on 7700 with the `label=disable` override. Fails without it (bind-mount SELinux denial).
- **An MCP server** (`mcp-calculator`, our ghcr image) - healthy on `app-net`.

Not yet exercised wholesale (the heavy services - the locally-built LibreChat app, the Firecrawl group, `rag_api`, `vectordb`, `openwebui`): a full bring-up was skipped to avoid resource contention with other live stacks on the dev host, not because of a known issue. When running them, watch for the same two failure classes:

- Bind-mounted path → SELinux denial → add `security_opt: label=disable` to that service in `docker-compose.podman.yml` (or `:z` on the specific mount).
- Named volume whose Docker chown-init targets uid 1000 → run the service as the image-default uid in the override (as done for mongodb). Candidates: `nuq-postgres` / `vectordb` (postgres data), `rabbitmq`, `firecrawl_pgdata`.

## Troubleshooting

- `permission denied ... docker API at unix:///var/run/docker.sock` - SELinux. Use the npm scripts / the `docker-compose.podman.yml` override (adds `label=disable`).
- `rootlessport cannot expose privileged port 80` - raise `ip_unprivileged_port_start` or set `TRAEFIK_HTTP_PORT`/`TRAEFIK_HTTPS_PORT` (see above).
- mongod `Permission denied ... /data/db/journal` (exit 100) - named-volume uid mismatch under rootless Podman; the override runs mongodb as `999:999`. A stale `mongodata` volume from an earlier run can still carry the wrong owner - `podman volume rm ai-chat-interface_mongodata` and bring it up again.
- Meilisearch `Permission denied (os error 13)` - SELinux on the `meili_data` bind mount; the override adds `label=disable`.
- Socket missing - `systemctl --user start podman.socket`.
