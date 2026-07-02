# Simplify the AI Chat Interface

## Goal

Collapse the current multi-agent construct (18 agent definitions, router + handoff machinery,
workspace-as-git-repo, per-workspace plan/task state) into one universal, Claude-Code-style
assistant plus a small number of genuinely distinct specialists. Better models (GLM-5.2) make
the compensating machinery unnecessary. Use `refs/opencode` as a design reference for tools and
prompts, not as a runtime dependency.

Keep the one piece of custom infrastructure opencode does not provide and that we genuinely need:
the multi-user Linux isolation in `mcp-linux` (root server + per-user `runuser` workers, email to
Linux-user mapping, per-user `/home`). This is also the foundation for the future per-user private
credentials requirement (see Phase 5).

## Guiding principle

An agent exists as a separate entity only when it differs by **tool access or backend**, not by
**skill level or domain prose**. Skill and domain differences collapse into the universal agent;
domain know-how moves to on-demand context (condensed instructions now, a skills mechanism later),
not into separate agents.

## Target roster (decided: "Kuratiert", GLM-5.2 only)

Result: 18 agent definitions to 4.

| Agent | Model | Backend / distinct tools | Fate |
|-------|-------|--------------------------|------|
| **Assistant** (new, universal) | GLM-5.2, vision | linux, github (r/w), docs, stackoverflow, npm-search, wikipedia, web_search, file_search | absorbs main-assistant, code-assistant, developer(+quality), code-refactorer, github, code-reviewer, linux-expert, data-analysis, file-converter, document-creator, research, feedback |
| **Faktencheck** | keep as-is (Mistral) | checkbot-rag `search` MCP | keep — strategic (Faktenforum integration), still `public: false` |
| **Travel & Location** | keep as-is (Qwen3) | mapbox + openstreetmap + weather + db-timetable (~32 tools) | keep — large distinct toolset |
| **Image Generation** | keep as-is (Mistral) | image-gen MCP | keep — distinct modality |

Removed entirely: cooking, video-transcripts (demo / disabled), plus the whole dev/workspace stack
and both routers. No Opus quality variant — Opus stays reachable via the normal model picker for raw chat.

---

## Phase 1 — Agent consolidation (priority, config-only, ships independently)

No `mcp-linux` code changes. Touches only `packages/librechat-init/config/**` + docs + avatars.
Uses the existing Linux MCP tools. Low risk, fully reversible, independent PR.

### 1.1 Add the universal `Assistant` agent

New entry in `agents.yaml`:

- `id: shared-agent-assistant`, `name: Assistant`, `vision: true`, default agent
- `provider: Scaleway`, `model: glm-5.2`, `maxContextTokens: 262144`, `temperature: 0.4`
- `mcpServers: [linux, github, docs, stackoverflow, npm-search, wikipedia]`
- `tools: [web_search, file_search]`
- `mcpTools`: union of the current Developer Linux toolset + GitHub Assistant full read/write
  set + docs + stackoverflow + npm-search. (This list shrinks in Phase 2 when the Linux tools are
  simplified.)
- `recursion_limit: 150` (single agent doing long sessions; no router chain anymore)
- `handoffs`: light, one-hop only — to `shared-agent-faktencheck`, `shared-agent-travel-location`,
  `shared-agent-image-generation`. No inter-specialist handoffs, no workspace-state passing.
- `permissions: { public: true, publicEdit: true }`

Decision to confirm during implementation: whether to also give Assistant the `image-gen` MCP so it
can generate images directly, or leave that to the standalone Image agent. Default: leave it out to
keep the toolset focused; the handoff covers it.

### 1.2 New instruction file `shared-agent-assistant-instructions.md`

Compose from the **kept** partials plus condensed domain guidance (no router/handoff/workflow text):

- `{{include:code-think-first.md}}` — read/search/plan before editing
- `{{include:mcp-linux-workspace-management.md}}` (reworked — drop the "never delete template
  workspaces" exception, since the template submodules go away in Phase 3)
- `{{include:mcp-linux-tools-files-upload.md}}` — upload/download flow
- `{{include:code-commit-push.md}}`, `{{include:code-git-ssh.md}}`, `{{include:code-python-dependencies.md}}`
- `{{include:conventions-when-unclear.md}}`, `{{include:conventions-current-datetime.md}}`
- Condensed domain sections lifted from the retired specialist instructions + workspace `AGENTS.md`:
  data analysis (matplotlib Agg/headless), document creation (Typst / Pandoc), file conversion
  (ffmpeg / ImageMagick / Pandoc), GitHub operations. Short, not the full template reference content.

### 1.3 Remove 14 agents + their instruction files

Remove from `agents.yaml`: `shared-agent-main-assistant`, `-code-assistant`, `-developer`,
`-developer-quality`, `-code-refactorer`, `-github`, `-code-reviewer`, `-linux-expert`,
`-data-analysis`, `-file-converter`, `-document-creator`, `-research`, `-feedback`, `-cooking`,
`-video-transcripts`.

Delete matching `agent-instructions/shared-agent-*-instructions.md` for each.

### 1.4 Fix handoffs on the 3 kept specialists

Currently faktencheck/travel/image hand back to `shared-agent-main-assistant` (and faktencheck to
`shared-agent-research`). Repoint the "return" handoff to `shared-agent-assistant`; delete handoffs
that target any removed agent.

### 1.5 Delete the handoff/router partials

Delete: `workflow-multi-agent.md`, `handoff-simple.md`, `mcp-linux-handoff-workspace.md`,
`conventions-when-unclear-router.md`, `mcp-linux-workspace-persistent-repo.md`.
Rework `code-developer-base.md` (it currently just aggregates handoff/workflow includes) — either
delete it or reduce to the still-relevant dev conventions. Update `_shared-conventions.md`
(maintainer reference table) to match.

### 1.6 Update `librechat.yaml` modelSpecs

`modelSpecs.list` (lines ~362-544) has one spec per agent. Reduce to 4:
- `assistant-agent` (label "Assistant", `default: true`, `order: 0`, `agent_id: shared-agent-assistant`)
- keep faktencheck, travel-location, image-generation specs
- delete the 13 removed specs
- update the "Main Assistant = default" comment at line 363

### 1.7 Avatars

In `packages/librechat-init/assets/agent-avatars/`: add `shared-agent-assistant.png` (reuse the
main-assistant avatar), delete PNGs for removed agents. Update the folder `README.md`.

### 1.8 Sync + test

```bash
docker compose -f docker-compose.local.yml --env-file .env.local run --rm librechat-post-init
docker compose -f docker-compose.local.yml --env-file .env.local restart api
```

Manual smoke test in the local UI: Assistant is the default; a coding task, a data/chart task, a
document task, and a GitHub-issue task all work end to end without handoffs; the 3 specialists still
appear and return to Assistant. Verify `docs/DEVELOPER_AGENTS.md` no longer describes reality (rewrite
in 1.9).

### 1.9 Docs

Rewrite/retire `docs/DEVELOPER_AGENTS.md` (the router hierarchy is gone). Update references to removed
agents in `docs/LIBRECHAT_FEATURES.md`, `docs/AGENT_AVATAR_PROMPTS.md`, `docs/MCP_SERVERS_TODO.md`,
`packages/librechat-init/README.md`, and the top-level `README.md`. Link any new doc from `docs/README.md`.

**Phase 1 exit:** one universal Assistant + 3 specialists live; router/handoff/quality machinery gone;
Linux MCP untouched.

---

## Phase 2 — Simplify the Linux MCP tools (depends on Phase 1)

Use `refs/opencode/packages/core/src/tool/` and `packages/opencode/src/tool/` as the design reference
(MIT — tool schemas and prompts can be copied). Goal: fewer, sharper, first-class tools instead of
routing everything through `execute_command`, which also shrinks the Assistant's tool list.

- Add first-class tools modeled on opencode: `read`, `write`, `edit` (targeted string-replace),
  `grep` (ripgrep), `glob`, `todowrite` (in-context plan — replaces the git-persisted plan/tasks).
- Remove `codebase_search` + LanceDB + tree-sitter chunking. opencode and Claude Code deliberately
  rely on grep/glob/read instead; this deletes a large chunk of the ~7,300 LOC and an index lifecycle.
- Remove the plan/tasks-as-handoff-state surface: `set_workspace_plan`, and the plan logic inside
  `get_workspaces`/`update_workspace`. The todo tool lives in context, not in `.mcp-linux/`.
- Keep: per-user isolation, `execute_command` + terminal tools, upload/download links, status page.

Separate PR(s). Update agent `mcpTools` lists accordingly.

---

## Phase 3 — Workspaces to central project management

- Drop the 4 workspace template submodules (`document-creator`, `data-analysis`, `file-converter`,
  `linux-expert`) and the "each workspace is a git repo for logging" model. Remove their entries from
  `.gitmodules`.
- Replace with a plain per-user projects root (e.g. `~/projects/<name>/`) and a light
  `list_projects` / `create_project` / `open_project` surface (or a convention over bash). This is
  opencode's directory-based project model and the "central project management" idea from the brief.
- `git init` becomes on-demand (when versioning actually helps), not a mandatory scaffold.
- Move any still-useful domain reference content (Typst examples, awesome-bash) to docs or drop it;
  GLM-5.2 + web search covers most of it.

---

## Phase 4 — Cleanup

- Remove dead env vars, compose entries, and icons for anything retired.
- Reconcile `docs/SERVICES.md` and the MCP docs with the new shape.
- Final self-review: build green, no references to removed agents/tools.

---

## Phase 5 — Per-user private credentials + account setup (future, design note)

New requirement: the Linux MCP should let each user attach private accounts (email, GitHub, etc.),
possibly via a dedicated init/setup tool for their own Linux account.

This reinforces keeping the multi-user infrastructure — it is the enabler. Today `MCP_LINUX_GIT_SSH_KEY`
and `MCP_GITHUB_PAT` are **global**, written into every user's home from shared env values. The future
direction:

- A per-user credential store (not global env) — the per-user home + `runuser` worker already isolate
  filesystem and process, so per-user secrets fit the existing model.
- An `account_setup` / onboarding MCP tool: initialize the user's Linux account, register a GitHub
  token / SSH key, configure git identity, connect email, etc. — replaces `reset_account` as the main
  account-management entry point and gives the universal Assistant a first-class way to set things up.
- Security review needed: where secrets are stored, encryption at rest, scope per user, revocation.

Not scheduled yet; captured so Phase 2/3 tool design leaves room for it (the account/credential tools
are natural neighbours of the project-management tools).

---

## Risks and rollback

- Config-only Phase 1 is reversible by reverting the `librechat-init/config` changes and re-running
  post-init. Take a git branch before starting.
- Losing domain prompts: mitigated by folding condensed domain guidance into the Assistant instructions
  (1.2) before deleting the specialist files.
- Tool overload on one agent until Phase 2 lands: acceptable with GLM-5.2's 262k context; Phase 2 fixes
  it properly.
- Do NOT adopt opencode as a runtime dependency — it is single-tenant (one server password) and would
  force us to rebuild the multi-user isolation we already have.

## Open items

- **Vision:** glm-5.2 is text/code only, so the universal Assistant has no image understanding
  (the former Mistral main-assistant did). Image uploads fall back to OCR / "Upload as Text". If
  image understanding matters, either add a vision-capable model path or a small vision agent.
- Image-gen on the universal Assistant: fold in or keep standalone-only (1.1).
- Faktencheck model: keep Mistral or bump to GLM-5.2 (it is strategic).
- Whether to keep light one-hop handoffs at all, or rely purely on the LibreChat agent picker.

## Status (branch `refactor/consolidate-agents`, PR #66)

- **Phase 1 done.** 18 agents → 4; routers/handoff/quality machinery and 8 partials removed;
  `librechat.yaml` modelSpecs reduced to 4 (Assistant default); avatars + docs updated. Config
  validated with a standalone harness replicating the real init include/tool-build logic (ALL PASS).
- **Phase 2 done.** mcp-linux: added `write`/`edit`/`grep`/`glob` (worker, run as user) + `todowrite`;
  removed the code-index subsystem (`@codebase-indexer/core`, LanceDB/tree-sitter), the plan/tasks
  state and `update_workspace`, plus `CODE_INDEX_*` env and dead status-page components. Built the
  image with podman and exercised every new tool end-to-end via MCP (server + runuser + worker). +485/−1344.
- **Phase 3 done.** Dropped the 4 workspace template submodules and the unused `dev/codebase-indexer`
  submodule; emptied `workspace_templates`; workspaces are plain per-project git dirs (git on demand).
  Unit tests green.
- **Phase 4 done.** Docs reconciled to the new shape across 10 files; no banned words, no stale refs.
- **Phase 5** (per-user credentials + account setup) remains a future design note (below).

Remaining manual step: run `librechat-post-init` + restart the API on the target stack to sync the
4 agents into LibreChat (mutates the LibreChat DB), then a quick UI smoke test. The mcp-linux image
change is covered by the podman tool test above.

Decisions applied for the open items: image-gen kept on the standalone Image agent (not folded in);
Faktencheck stays on Mistral; light one-hop handoffs kept. Vision limitation (glm-5.2 is text-only)
stands as noted.
