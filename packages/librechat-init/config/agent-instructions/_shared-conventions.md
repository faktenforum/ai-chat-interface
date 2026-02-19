# Agent instruction conventions (maintainer reference)

**Not loaded by any agent.** Canonical snippets live in `partial_instructions/` and are included in agent files via `{{include:partial-name.md}}` (e.g. `{{include:handoff-workspace.md}}`). The init process resolves these directives before storing instructions in LibreChat. See [shared-file-upload-types.md](shared-file-upload-types.md) for full upload/workspace/plan detail.

## Principle

Workspace + plan/tasks are the single source of truth for continuity across handoffs; handoff text should not duplicate the full plan/task list.

## Partial files (source of truth)

| Partial | Content |
|---------|---------|
| handoff-workspace | Full workspace handoff (Transfer, Before handoff, On receive, End of turn) |
| handoff-simple | Minimal handoff (Transfer via lc_transfer_to; put context in instructions) |
| execution-2 | Execution: ≤2 tool calls/batch; brief prose; no labels/tags. |
| code-generation | Execution: ≤3 tool calls/batch; brief prose; no labels/tags. |
| when-unclear | When unclear: One short clarifying question...; Language: match user. |
| files-mcp | MCP upload/download (list_upload_sessions, read_workspace_file, create_download_link) |
| paths-workspace | Paths: workspace-relative; same workspace for all tools. |
| commit-push | Commit/push: Only stage/push repo-relevant files... |
| git-github-ssh | Git (GitHub): Use SSH only... |
| github-default-repo | GitHub repo: faktenforum/ai-chat-interface (owner/repo constants) |
| before-handoff-workspace | Before handoff or when finishing: get_workspace_status; set_workspace_plan... |
| when-unclear-router | When unclear (routers): wait for reply before transferring; do not hand off to same specialist again |
| file-upload-types | LibreChat vs MCP upload, routing, Linux handoff (011); workspace agents use files-mcp |

## Canonical snippets (reference; edit partials, not this list)

**HANDOFF (minimal)**  
Transfer only via lc_transfer_to_<agentId>; put context in the tool's instructions param. Chat text does not trigger transfer.

**Before handoff (workspace agents)**  
Before handoff: update plan/tasks with set_workspace_plan (mark completed done, next in_progress); then hand off with workspace name in instructions. Optionally add one short hint (e.g. "Continue from plan/tasks").

**On receive (workspace)**  
On receive: use workspace from instructions → get_workspace_status → follow plan/tasks; if none/empty → set_workspace_plan from instructions, then proceed. Plan and tasks are the source of truth for what to do next.

**End of turn (workspace)**  
Always call set_workspace_plan before handoff or when finishing your part so the next agent has current state; otherwise context is lost.

**Execution**  
≤N tool calls/batch; brief prose; no labels/tags.

**When unclear**  
One short clarifying question or reasonable interpretation; do not hand back to Main Assistant for ambiguity. Language: match user.

**Files (MCP)**  
Files: MCP upload → list_upload_sessions then read_workspace_file(workspace, uploads/<path>); output → create_download_link. Do not ask for LibreChat attach unless LLM must read content.

**Paths**  
Paths: workspace-relative; same workspace for all tools.

**Commit/push**  
Only stage/push repo-relevant files; unstage or remove helper scripts and temp files before push.

**Git (GitHub)**  
Use SSH only for GitHub: remote URLs must be `git@github.com:org/repo.git`. Do not set origin (or any remote) to HTTPS with token or password; push/pull use the configured SSH key. If the remote is HTTPS, set it to the SSH URL: `git remote set-url origin git@github.com:org/repo.git`.

## Which agents use which snippet

| Snippet | Agents |
|--------|--------|
| HANDOFF (minimal) | All 17 agent instruction files |
| Before handoff | 008, 009, 010, developer, code-refactorer, code-reviewer, github, code-researcher |
| On receive | 008, 009, 010, developer, code-refactorer, code-reviewer, github, code-researcher |
| End of turn | 008, 009, 010, developer, code-refactorer, code-reviewer, github, code-researcher |
| Execution | 001, 002, 003, 005, 006, 008, 009, 010, developer, code-refactorer, code-reviewer, github, code-researcher, feedback |
| When unclear | 001, 002, 003, 005, 006, 008, 009, 010, developer, code-refactorer, code-reviewer, github, code-researcher, feedback, code-assistant, 011 |
| Files (MCP) | 008, 009, 010, developer |
| Paths | 008, 009, 010, developer |
| Commit/push | developer, code-reviewer, github |
| Git (GitHub) | developer, code-reviewer, github |

## Section order (per file)

HANDOFF → Role → Constraints → Workflow / Hand off → Execution → When unclear → {{include:current_datetime.md}}

Omit sections that do not apply.
