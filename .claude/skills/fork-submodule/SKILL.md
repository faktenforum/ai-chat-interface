---
name: fork-submodule
description: Work with a Faktenforum fork submodule in dev/ - sync it with upstream, open a PR against the upstream project, or build and publish its image to ghcr. Use when asked to "update the submodules", "send this upstream", "open a PR to the upstream repo", or when a service builds from a repo under dev/.
---

# Fork submodules

Applies to a submodule that is a Faktenforum fork, meaning it has both `fork_url` and `upstream_url` in
[scripts/submodules-upstream.yaml](../../../scripts/submodules-upstream.yaml). Branch strategy and
conflict resolution are in `docs/SUBMODULE_SYNC.md`.

## Registering a new fork

1. Add an entry in `scripts/submodules-upstream.yaml` with `path`, `fork_url`, `upstream_url`,
   `upstream_branch`, `fork_branch`, `upstream_tracking_branch` and an optional `description`.
2. In `.gitmodules`, point the submodule `url` at the fork and set its `branch`.
3. Run `npm run update:submodules`, which checks the fork out and adds the upstream remote and tracking
   branch.

## Day to day

```bash
npm run update:submodules                                  # all of them
./scripts/update-submodules.sh --submodule dev/<name>      # one
npm run update:submodules:status
npm run update:submodules:dry-run
```

Build a service from its submodule with `docker compose -f docker-compose.local-dev.yml build <service>`.
Submodules with a post-init step use `npm run build:dev` or `npm run prepare:dev`.

## Sending a change upstream

```bash
cd dev/<submodule>
git remote -v                          # confirm an `upstream` remote exists
git fetch upstream
git checkout -b fix/short-description upstream/main
# implement, commit
git push origin fix/short-description
```

Open the PR **from** `faktenforum/<repo>:fix/short-description` **to** the upstream default branch. Once
upstream merges it, run `npm run update:submodules` to merge upstream back into the fork's main, then in
this repo `git add dev/<submodule>` and commit the pointer on its own.

## Building and publishing the image

Only when we publish, which is the case for `mcp-docs`, `mcp-db-timetable`, `mcp-stackoverflow`,
`mcp-npm-search`, `mcp-openstreetmap` and `mcp-youtube-transcript`.

| File | `build:` | `image:` |
|---|---|---|
| Base `docker-compose.mcp-<name>.yml` | no | `ghcr.io/faktenforum/mcp-<name>:latest` |
| `docker-compose.local.yml` / `local-dev.yml` | yes, `./dev/<name>` | the same name, built locally |
| `docker-compose.prod.yml` | no | `ghcr.io/faktenforum/mcp-<name>:latest` |
| `docker-compose.dev.yml` | no | `ghcr.io/faktenforum/mcp-<name>:dev` |

The base file has no `build` so Portainer only ever pulls. The local override adds `build` under the same
image name, so a local stack runs what the submodule currently contains.

Workflow at `.github/workflows/build-mcp-<name>.yml`: trigger on `push` paths `dev/<name>` and
`dev/<name>/**` plus the workflow file, and on `workflow_dispatch`. Check out with `submodules: true`,
build context `./dev/<name>`, push `ghcr.io/faktenforum/mcp-<name>` tagged `latest` on the default
branch, `dev` on other branches, plus the branch name. Platform `linux/amd64` with the GitHub Actions
cache. Copy `build-mcp-docs.yml` or `build-mcp-db-timetable.yml` and adjust the name and paths.
