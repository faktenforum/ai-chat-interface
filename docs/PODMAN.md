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
CONTAINER_SOCKET=/run/user/$(id -u)/podman/podman.sock MONGODB_USER=0:0 \
  MONGODB_INIT_UID=0 MONGODB_INIT_GID=0 \
  podman compose -f docker-compose.local.yml --env-file .env.local up -d
```

## What differs from Docker

The Podman-specific bits live in the same compose files; they are no-ops under Docker or default to the Docker values, so the Docker setup is unchanged.

- **Traefik socket.** Traefik's docker provider reads the runtime socket. `CONTAINER_SOCKET` (default `/var/run/docker.sock`) points it at the Podman socket instead. Set in `docker-compose.traefik.yml`.
- **SELinux.** On SELinux hosts (Fedora etc.) confined containers cannot read host-mounted paths and fail with `permission denied` (`os error 13` / docker API). `docker-compose.local*.yml` set `security_opt: label=disable` on Traefik (socket mount) and Meilisearch (bind-mounted `meili_data` dir). On a non-SELinux Docker host this is a no-op.
- **MongoDB volume ownership.** Under Docker a chown-init aligns the `mongodata` named volume to uid 1000 and mongod runs as 1000. Under rootless Podman, non-root container uids don't have a single stable host mapping: `podman run`/`podman unshare` map container uid N (N≥1) to `524288+N-1` (from `/etc/subuid`), but containers created through the Docker-API-compat socket (what `podman compose`/the npm scripts use) resolve non-root uids differently, so a fixed non-root uid like the mongo image's default (999) ends up owned by one mapping and read by the other, and mongod fails with `Permission denied ... /data/db/journal`. Container uid 0 sidesteps this: it's a single unambiguous 1:1 mapping to the real host user on both paths. `mongodb` runs as `${MONGODB_USER:-1000:1000}`; the podman npm scripts set `MONGODB_USER=0:0`. The chown-init (`mongodb-init`) must target the *same* uid, or it re-chowns the volume back to 1000:1000 on every `up` - it runs as `UID: ${MONGODB_INIT_UID:-${UID:-1000}}` / `GID: ${MONGODB_INIT_GID:-${GID:-1000}}`, and the npm scripts set `MONGODB_INIT_UID=0 MONGODB_INIT_GID=0` to match. Both default to `1000:1000` under Docker, unchanged (no rootless remapping there). If a volume is stuck owned by a mismatched non-root uid from an earlier run, root can read/write/chown it regardless of the current owner (it's still the same host user's subuid delegation) - just bring the stack up with the `0:0` npm scripts and `mongodb-init` will realign it. Other stateful services with named volumes may need the same treatment (see Status).
- **mcp-linux source bind mount.** `docker-compose.local*.yml` bind-mount `./packages/mcp-linux/src` into the container for live-reload. Under SELinux this fails the same way as Traefik/Meilisearch (`Cannot find module '/app/src/server.ts'` - the mount resolves empty) and needs `security_opt: label=disable`, which is set on the `mcp-linux` service.

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
- **MongoDB** - healthy with `MONGODB_USER=0:0` / `MONGODB_INIT_UID=0` (listens on 27017, accepts connections). Fails as uid 1000 or uid 999 (see above).
- **Meilisearch** - listens on 7700 with `label=disable`. Fails without it (bind-mount SELinux denial).
- **mcp-linux** - healthy with `security_opt: label=disable` on its bind-mounted `src/`.
- **An MCP server** (`mcp-calculator`, our ghcr image) - healthy on `app-net`.
- **LibreChat** (`librechat-init` → `librechat`) - full bring-up on `app-net`/`traefik-net`, reachable through Traefik.

When bringing up other stateful services, watch for the same two failure classes:

- Bind-mounted path → SELinux denial → add `security_opt: label=disable` to that service in `docker-compose.local*.yml` (or `:z` on the specific mount).
- Named volume whose Docker chown-init targets uid 1000, or whose image runs as a fixed non-root uid → prefer running the service as root (`0:0`) under Podman rather than picking a specific non-root uid, since non-root uids can map differently between `podman run` and the Docker-API-compat socket (see MongoDB above). Candidates: `nuq-postgres` / `vectordb` (postgres data), `rabbitmq`, `firecrawl_pgdata`.

## Troubleshooting

- `permission denied ... docker API at unix:///var/run/docker.sock` - SELinux. Use the npm scripts; Traefik carries `label=disable` in the local compose files.
- `rootlessport cannot expose privileged port 80` - raise `ip_unprivileged_port_start` or set `TRAEFIK_HTTP_PORT`/`TRAEFIK_HTTPS_PORT` (see above).
- mongod `Permission denied ... /data/db/journal` (exit 14) - named-volume uid mismatch; the npm scripts set `MONGODB_USER=0:0` and `MONGODB_INIT_UID/GID=0` so mongod and its chown-init both run as root, which can access the volume regardless of its current owner. If it still happens, you're probably not using the npm scripts (a hand-rolled `podman compose` invocation without those env vars) - use `npm run podman:local:up` or pass the same `MONGODB_USER`/`MONGODB_INIT_UID`/`MONGODB_INIT_GID` vars by hand.
- mcp-linux `Cannot find module '/app/src/server.ts'` - SELinux denial on the bind-mounted `./packages/mcp-linux/src`; the local compose files add `label=disable` to the `mcp-linux` service.
- Meilisearch `Permission denied (os error 13)` - SELinux on the `meili_data` bind mount; the local compose files add `label=disable`.
- Socket missing - `systemctl --user start podman.socket`.
