# Agent instruction conventions (maintainer reference)

**Not loaded by any agent.** Canonical snippets live in `partial_instructions/` and are pulled into
agent files via `{{include:partial-name.md}}` (e.g. `{{include:code-think-first.md}}`). The init
process resolves these includes before storing instructions in LibreChat. Edit the partials, not this file.

## Roster

One universal **Assistant** (`shared-agent-assistant`) handles coding, Linux/shell, files, data,
documents, research and GitHub. Three specialists differ by tool access or backend and exist as
separate agents: **Faktencheck** (checkbot-rag `search`), **Travel and Location** (mapbox / OSM /
weather / db-timetable), **Image Generation** (image-gen). Specialists return to the Assistant via a
light one-hop handoff; there is no router and no cross-specialist handoff chain.

## Partials (`partial_instructions/`)

| Partial | Content |
|---------|---------|
| `handoff-simple` | Minimal handoff: transfer via `lc_transfer_to_<agentId>`, put context in the instructions param (chat text does not trigger a transfer). |
| `mcp-linux-workspace-management` | Workspace create/list/status/update tools; one workspace per project. |
| `mcp-linux-tools-files-upload` | MCP upload/download: `list_upload_sessions`, `read_workspace_file`, `create_download_link`. |
| `code-think-first` | Read and search before editing; plan multi-file changes. |
| `code-commit-push` | Only stage/push repo-relevant files; drop temp/helper files before pushing. |
| `code-git-ssh` | GitHub over SSH only (`git@github.com:org/repo.git`); never HTTPS with a token. |
| `code-python-dependencies` | Use `uv` for all Python deps; never `pip install`. |
| `conventions-when-unclear` | Ask or interpret; match the user's language. |
| `conventions-current-datetime` | Injects the current date/time. |

## Section order (per agent file)

Role → Constraints → Workflow → Execution → Specialists / hand off → When unclear →
`{{include:conventions-current-datetime.md}}`. Omit sections that do not apply.
