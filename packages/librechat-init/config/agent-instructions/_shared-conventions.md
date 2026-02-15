# Agent instruction conventions (maintainer reference)

**Not loaded by any agent.** Use these exact phrases in the listed agent files to avoid drift. See [shared-file-upload-types.md](shared-file-upload-types.md) for full upload/workspace/plan detail.

## Principle

Workspace + plan/tasks are the single source of truth for continuity across handoffs; handoff text should not duplicate the full plan/task list.

## Canonical snippets

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
One short clarifying question or reasonable interpretation; do not hand back to Universal for ambiguity. Language: match user.

**Files (MCP)**  
Files: MCP upload → list_upload_sessions then read_workspace_file(workspace, uploads/<path>); output → create_download_link. Do not ask for LibreChat attach unless LLM must read content.

**Paths**  
Paths: workspace-relative; same workspace for all tools.

**Commit/push**  
Only stage/push repo-relevant files; unstage or remove helper scripts and temp files before push.

## Which agents use which snippet

| Snippet | Agents |
|--------|--------|
| HANDOFF (minimal) | All 17 agent instruction files |
| Before handoff | 008, 009, 010, developer, code-refactorer, code-reviewer, github, code-researcher |
| On receive | 008, 009, 010, developer, code-refactorer, code-reviewer, github, code-researcher |
| End of turn | 008, 009, 010, developer, code-refactorer, code-reviewer, github, code-researcher |
| Execution | 001, 002, 003, 005, 006, 008, 009, 010, developer, code-refactorer, code-reviewer, github, code-researcher, feedback |
| When unclear | 001, 002, 003, 005, 006, 008, 009, 010, developer, code-refactorer, code-reviewer, github, code-researcher, feedback, developer-router, 011 |
| Files (MCP) | 008, 009, 010, developer |
| Paths | 008, 009, 010, developer |
| Commit/push | developer, code-reviewer, github |

## Section order (per file)

HANDOFF → Role → Constraints → Workflow / Hand off → Execution → When unclear → {{current_datetime}}

Omit sections that do not apply.
