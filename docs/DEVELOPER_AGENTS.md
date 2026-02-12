# Developer Agents

Development requests are routed by **Entwickler-Router** to task-specific specialists. Universal hands off to this router once (10-handoff limit); the router then has up to 10 handoffs to specialists.

## Router hierarchy

```
Universal ──► Entwickler-Router ──► Code-Recherche | Entwickler | Code-Refactorer
                                 ──► GitHub-Assistent | Code-Reviewer
                                 ──► Universal (back)
```

Specialists do **not** hand off back to the router; they hand off to Universal or to other specialists.

**Recursion limit (Max Agent Steps):**
- One limit applies to the **entire** run (all agents in the chain); taken from the **first** agent (the one the user started with).
- Each step = one LLM call, tool call, or handoff. Stop = agent returns a final response with no further tools/handoffs; else `GRAPH_RECURSION_LIMIT`.
- Dev agents: 100–120 so workflows with many file/git/GitHub steps complete. Universal 100, Entwickler-Router 120.

## Agents

| Agent | ID | Provider | Model | Tools | Role |
|-------|----|----------|-------|-------|------|
| **Entwickler-Router** | `shared-agent-developer-router` | Scaleway | mistral-small-3.2-24b | None | Route to specialist |
| **Code-Recherche** | `shared-agent-code-researcher` | OpenRouter | anthropic/claude-opus-4.6 | ~35 (Linux subset, GitHub, Docs, SO, npm, web_search) | Understand code, find examples, search docs. No implementation. |
| **Entwickler** | `shared-agent-developer` | OpenRouter | anthropic/claude-opus-4.6 | 18 (Linux full, web_search) | Implement, fix bugs. |
| **Code-Refactorer** | `shared-agent-code-refactorer` | OpenRouter | google/gemini-3-pro-preview | 18 (Linux full, web_search) | Refactor, polish, restructure. |
| **GitHub-Assistent** | `shared-agent-github` | Scaleway | qwen3-235b | GitHub (read+write), Linux minimal | PRs, issues, releases; create/update/merge PR, review, file/repo ops. See [GitHub tools](#github-tools). |
| **Code-Reviewer** | `shared-agent-code-reviewer` | OpenRouter | google/gemini-3-pro-preview | ~18 (Linux subset, GitHub read) | Single entry for PR reviews: clone repo, analyze via Linux MCP, produce review; hand off to GitHub-Assistent to post on GitHub when the user requests it. |

## Chains

No automatic chains. All transitions between specialists are via explicit handoffs.

## Handoffs

Each specialist can hand off to Universal and to 2–3 relevant specialists (e.g. Entwickler → Code-Recherche, GitHub-Assistent). Specialists do **not** hand off back to Entwickler-Router. All agents with handoffs have a **HANDOFF** instruction: they must **call the handoff/transfer tool** (not just write a message) and pass context in the tool's instructions parameter.

- **Entwickler → Code-Refactorer**: Polish or restructure code (readability, structure, tests, style).
- **Code-Refactorer → Entwickler**: Implement missing code, tests, or behavior found during refactoring.
- **Code-Refactorer → Code-Reviewer**: Read PR/review comments and fix issues (Code-Refactorer has no GitHub API).
- **Feedback-Assistent → GitHub-Assistent**: Create issue (title + body in English); → Code-Recherche (similar issues); → Entwickler-Router (user wants to fix).

## Code review flow

1. User provides PR URL to **Code-Reviewer** (via router or by selecting the agent).
2. **Code-Reviewer**: `pull_request_read` → head/base ref and repo URL; `create_workspace` (git_url, branch = head ref) → in workspace: `git fetch origin <base_ref>`, `git diff origin/<base_ref>...HEAD`; `read_workspace_file` for changed files and context → analyze → structured review (summary + optional inline comments).
3. To post on GitHub: **Code-Reviewer** hands off via transfer tool with review body and inline comments; **GitHub-Assistent** uses `create_review`.

Optional handoffs: Code-Reviewer → Code-Recherche (codebase context) or → Entwickler (fix issues).

**GitHub content:** GitHub-Assistent posts all review bodies, inline comments, and issue/PR text in **English** (per agent instructions).

## Feedback / Bug reports

**Feedback-Assistent** (`shared-agent-feedback`): Report chat-interface bugs. Understands description → structured issue (title, steps, expected/actual, environment) → hand off to **GitHub-Assistent** (issue in English). Optional: **Code-Recherche** (similar issues), **Entwickler-Router** (user wants to fix). Entry: Universal or preset “Feedback / Fehler melden”.

## GitHub tools

Write tools are **only on GitHub-Assistent**; Code-Recherche and Code-Reviewer have read-only GitHub tools. Code-Reviewer hands off to GitHub-Assistent to post reviews.

GitHub-Assistent’s tools in `agents.yaml` (suffix `_mcp_github`):

| Scope | Examples |
|-------|----------|
| Read | search_*, get_file_contents, get_commit, get_me, get_label, issue_read, pull_request_read, list_* |
| Write — issues/PRs/review | create_issue, create_pull_request, create_review, pull_request_review_write, add_issue_comment, issue_write, update_pull_request, update_pull_request_branch, merge_pull_request |
| Write — branch/file/repo | create_branch, create_or_update_file, delete_file, push_files, fork_repository, create_repository |
| Optional (if MCP provides) | assign_copilot_to_issue, request_copilot_review, sub_issue_write |

Only tools the GitHub MCP server actually provides are exposed; unknown names in YAML are ignored. In the UI, tools may appear without the `_mcp_github` suffix—keep them enabled for GitHub-Assistent.

## Config

- Agents: [`packages/librechat-init/config/agents.yaml`](../packages/librechat-init/config/agents.yaml)
- Models: [`packages/librechat-init/config/librechat.yaml`](../packages/librechat-init/config/librechat.yaml)
- Init: [`packages/librechat-init/src/init-agents.ts`](../packages/librechat-init/src/init-agents.ts)
