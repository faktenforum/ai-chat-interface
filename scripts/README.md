# Submodule Management Scripts

Scripts for managing Faktenforum fork submodules.

## Scripts

### `sync-fork-submodules.sh`

Syncs Faktenforum fork submodules with their upstream repositories.

**Usage:**
```bash
npm run sync:forks              # Sync all forks
npm run sync:forks:status       # Show sync status
npm run sync:forks:dry-run      # Preview changes
```

**Features:**
- Automatically configures upstream remotes
- Creates/updates upstream tracking branches
- Merges upstream changes into main branches
- Interactive conflict resolution

### `create-faktenforum-branches.sh`

Creates upstream tracking branches (optional - sync script does this automatically).

**Usage:**
```bash
npm run create:forks
```

## Configuration

Upstream repositories are configured in `submodules-upstream.yaml`.

## Documentation

See [Submodule Sync Guide](../docs/SUBMODULE_SYNC.md) for detailed documentation.
