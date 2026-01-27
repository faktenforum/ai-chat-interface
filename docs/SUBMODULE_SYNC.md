# Submodule Sync Guide

Synchronize Faktenforum fork submodules with their upstream repositories.

## Quick Start

```bash
# Check sync status
npm run sync:forks:status

# Sync all forks
npm run sync:forks

# Preview changes (dry-run)
npm run sync:forks:dry-run
```

## Branch Strategy

- **`main`**: Production branch with Faktenforum-specific modifications (default in `.gitmodules`)
- **`upstream`**: Local tracking branch for upstream state (auto-created, not pushed)

## Configuration

Upstream repositories are defined in `scripts/submodules-upstream.yaml`. Each entry specifies:
- `path`: Submodule path
- `fork_url`: Faktenforum fork repository
- `upstream_url`: Original upstream repository
- `upstream_branch`: Upstream branch name (usually `main` or `master`)
- `fork_branch`: Fork branch name (always `main`)
- `upstream_tracking_branch`: Local branch name (always `upstream`)

## Usage

### Check Status

```bash
npm run sync:forks:status
```

Shows sync status for all fork submodules:
- Commits ahead/behind upstream
- Unpushed commits
- Upstream tracking branch status

### Sync All Forks

```bash
npm run sync:forks
```

Automatically:
1. Creates/updates `upstream` tracking branches
2. Fetches latest changes from upstream
3. Merges upstream changes into `main` branches
4. Handles conflicts interactively

### Sync Specific Submodule

```bash
./scripts/sync-fork-submodules.sh --submodule dev/librechat
```

### Dry Run

```bash
npm run sync:forks:dry-run
```

Preview changes without applying them.

## Conflict Resolution

When merge conflicts occur:
1. Script pauses and lists conflicted files
2. Resolve conflicts manually in the submodule directory
3. Stage resolved files: `git add <file>`
4. Complete merge: `git commit`
5. Press Enter in the script to continue

**Tip**: For `main` branch conflicts, carefully merge upstream changes while preserving Faktenforum-specific modifications.

## Adding New Fork Submodules

1. Add entry to `scripts/submodules-upstream.yaml`
2. Add submodule to `.gitmodules` with `branch = main`
3. Run `npm run sync:forks:status` to verify

## Troubleshooting

**Submodule not initialized**
```bash
git submodule update --init --remote
```

**Uncommitted changes**
```bash
# Commit changes
cd dev/librechat && git add . && git commit -m "..." && cd ../..

# Or stash
cd dev/librechat && git stash && cd ../..
```

**YAML parser not found**
```bash
pip3 install pyyaml
# or
# Install yq (see: https://github.com/mikefarah/yq)
```

## Workflow Examples

### Regular Sync
```bash
npm run sync:forks:status  # Check status
npm run sync:forks         # Sync all
```

### Fixing Bugs

**For Upstream PRs (recommended):**
```bash
cd dev/librechat
git checkout upstream
git checkout -b fix/bug-description
# ... implement fix ...
git push origin fix/bug-description
# Create PR: faktenforum/LibreChat → danny-avila/LibreChat
```

**For Faktenforum-specific fixes:**
```bash
cd dev/librechat
git checkout main
git checkout -b fix/faktenforum-specific-bug
# ... implement fix ...
git checkout main && git merge fix/faktenforum-specific-bug
git push origin main
```

### After Upstream Accepts PR
```bash
npm run sync:forks  # Automatically merges changes into main
```

## Related Documentation

- [Development Guide](DEVELOPMENT.md) - Working with git submodules
- [Getting Started](GETTING_STARTED.md) - Project setup
