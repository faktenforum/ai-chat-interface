# Submodule Sync Guide

**update-submodules** brings all submodules up to date: (1) pull all (non-forks stay current), (2) for fork/upstream-only: upstream remote, tracking branch; forks: merge into main, (3) fork submodules end on their **main** branch (not detached). To also build submodules needed for local/local-dev, run **`npm run build:dev`** (or **`npm run prepare:dev`** = update + build).

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

Config: `scripts/submodules-upstream.yaml` (shared with build-dev-submodules). **Only entries with `upstream_url`** get step 2 (upstream remote, tracking branch, merge). All submodules are updated in step 1 (`git submodule update --init --remote`).

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
4. Ensures fork submodules end on their main branch (not detached)
5. Handles conflicts interactively

Use **`--stage`** to stage fork submodule commits in the superproject after sync (`git add` each synced fork path). Then commit in the superproject so that a later `git submodule update` does not reset the submodule to an older commit.

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

### Own change that should also go upstream (preferred)

Branch off **upstream**, never off the fork `main` (branching off `main` carries our other customizations into the PR diff):
```bash
cd dev/librechat
git fetch upstream
git checkout -b feat/short-description upstream/main   # use upstream/dev if upstream merges features into dev
# ... implement ...
git push origin feat/short-description
# Open PR: faktenforum/LibreChat:feat/short-description → danny-avila/LibreChat
```
- To make it live in our fork before upstream merges: also merge the branch into the fork `main`, bump the parent submodule pointer (`git add dev/<submodule>`), and track it as a pending-upstream customization (prune it after upstream merges).
- If the change is **not** needed live (e.g. superseded by a `librechat.yaml` override): leave fork `main` untouched and `git checkout <pinned-sha>` so the parent submodule pointer is unchanged — the commit lives only on the pushed branch + the PR.

**Base-branch caveat:** LibreChat merges contributions into its **`dev`** branch; they reach `main` only at the next release. Our fork tracks `upstream_branch: main` (`scripts/submodules-upstream.yaml`), so `npm run update:submodules` will **not** pull a change that is still only on upstream `dev`.

**For Faktenforum-specific fixes (stay in the fork, no upstream PR):**
```bash
cd dev/librechat
git checkout main && git checkout -b fix/faktenforum-specific-bug
# ... implement fix ...
git checkout main && git merge fix/faktenforum-specific-bug && git push origin main
```

### After Upstream Accepts PR
```bash
npm run update:submodules  # Step 1 updates all; step 2 merges upstream into main for forks
# then drop the now-redundant local commit so our diff vs upstream shrinks (prune pending-upstream customizations)
```

## CI: Image builds on submodule updates

When you commit a **submodule pointer update** (e.g. after `npm run update:submodules` and `git add dev/librechat`), GitHub records the change as the path `dev/librechat` (a gitlink). The build workflows (e.g. **Build and Push LibreChat Image**) use `paths` filters that include both that path and `dev/librechat/**`, so the workflow runs and the image is rebuilt. Same for `dev/agents` and other dev submodules (mcp-youtube-transcript, db-timetable-mcp, etc.). If you only update the pointer and push, the corresponding image workflow will run.

## Related Documentation

- [Development Guide](DEVELOPMENT.md) - Working with git submodules
- [Getting Started](GETTING_STARTED.md) - Project setup
