# Submodule Sync Guide

**update-submodules** brings all submodules up to date: (1) pull all (non-forks stay current), (2) for fork/upstream-only: upstream remote, tracking branch; forks: merge into main. To also build submodules needed for local/local-dev, run **`npm run build:dev`** (or **`npm run prepare:dev`** = update + build).

## Quick Start

```bash
# Check fork/upstream status
npm run update:submodules:status

# Update all submodules (pull all + fork merge)
npm run update:submodules

# Preview (dry-run)
npm run update:submodules:dry-run
```

## Branch Strategy

- **`main`**: Production branch with Faktenforum-specific modifications (default in `.gitmodules`)
- **`upstream`**: Local tracking branch for upstream state (auto-created, not pushed)

## Configuration

Config: `scripts/submodules-upstream.yaml` (shared with build-dev-submodules and create-faktenforum-branches). **Only entries with `upstream_url`** get step 2 (upstream remote, tracking branch, merge). All submodules are updated in step 1 (`git submodule update --init --remote`).

Sync-relevant entries: `path`, `upstream_url`, `upstream_branch`, `fork_branch`, `upstream_tracking_branch`; `fork_url` only for Faktenforum forks.

## Usage

### Check Status

```bash
npm run update:submodules:status
```

Shows sync status for fork/upstream-only submodules:
- Commits ahead/behind upstream
- Unpushed commits
- Upstream tracking branch status

### Update All Submodules

```bash
npm run update:submodules
```

Automatically:
1. Creates/updates `upstream` tracking branches
2. Fetches latest changes from upstream
3. Merges upstream changes into `main` branches
4. Handles conflicts interactively

### Update Specific Submodule

```bash
./scripts/update-submodules.sh --submodule dev/librechat
```

### Dry Run

```bash
npm run update:submodules:dry-run
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

## Viewing our customizations (diff to upstream)

Prefer aligning with upstream; add only what’s strictly needed. From repo root (ensure `upstream` is fetched in the submodule):

```bash
cd dev/librechat && git diff upstream/main --stat
cd dev/librechat && git diff upstream/main -- path/to/file

cd dev/agents && git diff upstream/main --stat
cd dev/agents && git diff upstream/main -- path/to/file
```

**LibreChat** — Vision + artifact handling: `validateVisionModel`, `getVisionCapability`, `processArtifactsForAssistants` in ToolService; vision in agent config/run and client (ImageVision, useVisionModel); MCP artifact processing (base64 → files, contentParts). **Agents** — Tool definitions (Calculator, CodeExecutor, WebSearch, ProgrammaticToolCalling) kept aligned so `packages/api` can import from `@librechat/agents`.

## Adding New Fork Submodules

1. Add entry to `scripts/submodules-upstream.yaml`
2. Add submodule to `.gitmodules` with `branch = main`
3. Run `npm run update:submodules:status` to verify

## Troubleshooting

**Submodule not initialized** — Run `npm run update:submodules` to update all submodules (or `git submodule update --init --remote`).

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

### Regular update
```bash
npm run update:submodules:status  # Check status
npm run update:submodules         # Update all
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
npm run update:submodules  # Step 1 updates all; step 2 merges upstream into main for forks
```

## CI: Image builds on submodule updates

When you commit a **submodule pointer update** (e.g. after `npm run update:submodules` and `git add dev/librechat`), GitHub records the change as the path `dev/librechat` (a gitlink). The build workflows (e.g. **Build and Push LibreChat Image**) use `paths` filters that include both that path and `dev/librechat/**`, so the workflow runs and the image is rebuilt. Same for `dev/agents` and other dev submodules (mcp-youtube-transcript, db-timetable-mcp, etc.). If you only update the pointer and push, the corresponding image workflow will run.

## Related Documentation

- [Development Guide](DEVELOPMENT.md) - Working with git submodules
- [Getting Started](GETTING_STARTED.md) - Project setup
