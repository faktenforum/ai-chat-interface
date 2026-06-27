# Agent instruction conventions (maintainer reference)

**Not loaded by any agent.** Canonical snippets live in `partial_instructions/` and are pulled into agent files via `{{include:partial-name.md}}` (e.g. `{{include:mcp-linux-handoff-workspace.md}}`). The init process resolves these includes before storing instructions in LibreChat. Edit the partials, not this file.

## Principle

Workspace plus plan/tasks are the single source of truth for continuity across handoffs; handoff text should not duplicate the full plan/task list.

## Partials (`partial_instructions/`)

| Partial | Content |
|---------|---------|
| `handoff-simple` | Minimal handoff: transfer via `lc_transfer_to_<agentId>`, put context in the instructions param (chat text does not trigger a transfer). |
| `mcp-linux-handoff-workspace` | Full workspace handoff: transfer, before-handoff, on-receive, end-of-turn. |
| `mcp-linux-workspace-management` | Workspace create/list/status/update tools. |
| `mcp-linux-workspace-persistent-repo` | Persistent git-repo workspaces. |
| `mcp-linux-tools-files-upload` | MCP upload/download: `list_upload_sessions`, `read_workspace_file`, `create_download_link`. |
| `mcp-linux-tools-search-list` | Linux search/list tools. |
| `mcp-github-repo-default` | GitHub repo constants (`faktenforum/ai-chat-interface`). |
| `code-developer-base` | Shared base instructions for the developer specialists. |
| `code-generation` | Execution: at most 3 tool calls per batch; brief prose; no labels/tags. |
| `code-think-first` | Read and search before editing; plan multi-file changes. |
| `code-commit-push` | Only stage/push repo-relevant files; drop temp/helper files before pushing. |
| `code-git-ssh` | GitHub over SSH only (`git@github.com:org/repo.git`); never HTTPS with a token. |
| `code-python-dependencies` | Use `uv` for all Python deps; never `pip install`. |
| `conventions-current-datetime` | Injects the current date/time. |
| `conventions-when-unclear` | Ask or interpret; do not hand back for ambiguity alone; match the user's language. |
| `conventions-when-unclear-router` | Router variant: wait for the reply before transferring; do not re-transfer to the same specialist. |
| `workflow-multi-agent` | Multi-agent workflow: plan/tasks and the handoff chain. |

## Section order (per agent file)

HANDOFF → Role → Constraints → Workflow / Hand off → Execution → When unclear → `{{include:conventions-current-datetime.md}}`. Omit sections that do not apply.
