# Submodule Scripts

Scripts and one shared config for the dev submodule stack (local and local-dev).

## Config

**`submodules-upstream.yaml`** — Registry of dev submodules. Each script uses the fields it needs:

| Script | Uses | Purpose |
|--------|------|---------|
| update-submodules.sh | all paths, `upstream_url`, `fork_url` | Bring all up to date: pull all, then forks: upstream + merge |
| build-dev-submodules.sh | `post_init` | Build submodules required for local/local-dev stacks |
| create-faktenforum-branches.sh | entries with `upstream_url` | Create upstream tracking branch (optional) |

## Scripts

**update-submodules.sh** — Brings all submodules up to date. (1) `git submodule update --init --remote` for all. (2) For entries with `upstream_url`: upstream remote, tracking branch; for forks: merge into main.  
→ `npm run update:submodules` \| `update:submodules:status` \| `update:submodules:dry-run`

**build-dev-submodules.sh** — Builds submodules that must be built for local and local-dev stacks (post_init only; no git update). Run after `update:submodules` if needed.  
→ `npm run build:dev`

**create-faktenforum-branches.sh** — Creates upstream tracking branches for entries with `upstream_url`. Optional (update script does this too).  
→ `npm run create:forks`

**Convenience:** `npm run prepare:dev` = `update:submodules` + `build:dev`. `sync:forks` / `sync:forks:status` / `sync:forks:dry-run` alias to the update:submodules variants.

## Icon variants

**generate-icon-variants.ts** — Generates colored SVG variants from `assets/icons` (originals unchanged). Output: `assets/icons/variants/<variant>/<name>.svg`. Same TypeScript run approach as `setup-env.ts` (Node with `--experimental-strip-types`).

Variants: `green`, `amber`, `purple`, `gray`, `light`, `dark`, and `green-bg`, `amber-bg`, `purple-bg`, `light-bg`, `dark-bg`. Colors match [LibreChat group icons](docs/LIBRECHAT_GROUP_ICONS.md).

```bash
./scripts/generate-icon-variants.ts --help
./scripts/generate-icon-variants.ts --list-variants
./scripts/generate-icon-variants.ts                                    # all icons, all variants
./scripts/generate-icon-variants.ts --variants green,amber lock.svg   # selected only
./scripts/generate-icon-variants.ts --base64 purple                    # print data URI for first icon
```

## Docs

- [Submodule Sync Guide](../docs/SUBMODULE_SYNC.md) — Update/sync workflow (status, merge, conflicts).
