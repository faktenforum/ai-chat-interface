# Developer Agents

Development requests are routed by **Entwickler-Router** to task-specific specialists. Universal hands off to this router once (10-handoff limit); the router then has up to 10 handoffs to specialists.

## Router hierarchy

```
Universal ──► Entwickler-Router ──► Code-Recherche | Entwickler | Code-Refactorer
                                 ──► GitHub-Assistent | Code-Reviewer
                                 ──► Universal (back)
```

Specialists do **not** hand off back to the router; they hand off to Universal or to other specialists.

## Agents

| Agent | ID | Provider | Model | Tools | Role |
|-------|----|----------|-------|-------|------|
| **Entwickler-Router** | `shared-agent-developer-router` | Scaleway | mistral-small-3.2-24b | None | Route to specialist |
| **Code-Recherche** | `shared-agent-code-researcher` | OpenRouter | anthropic/claude-opus-4.6 | ~35 (Linux subset, GitHub, Docs, SO, npm, web_search) | Understand code, find examples, search docs. No implementation. |
| **Entwickler** | `shared-agent-developer` | OpenRouter | anthropic/claude-opus-4.6 | 18 (Linux full, web_search) | Implement, fix bugs. |
| **Code-Refactorer** | `shared-agent-code-refactorer` | OpenRouter | google/gemini-3-pro-preview | 18 (Linux full, web_search) | Refactor, polish, restructure. |
| **GitHub-Assistent** | `shared-agent-github` | Scaleway | qwen3-235b | ~24 (GitHub read+write, Linux minimal) | PRs, issues, create PR/issue/review. |
| **Code-Reviewer** | `shared-agent-code-reviewer` | OpenRouter | google/gemini-3-pro-preview | ~18 (Linux subset, GitHub read) | Single entry for PR reviews: clone repo, analyze via Linux MCP, produce review; hand off to GitHub-Assistent to post on GitHub when the user requests it. |

## Chains

No automatic chains. All transitions between specialists are via explicit handoffs.

## Handoffs

Each specialist can hand off to Universal and to 2–3 relevant specialists (e.g. Entwickler → Code-Recherche, GitHub-Assistent). Specialists do **not** hand off back to Entwickler-Router.

- **Entwickler → Code-Refactorer**: To polish or restructure implemented code (readability, structure, tests, style).
- **Code-Refactorer → Entwickler**: To implement missing code, tests, or new behavior identified during refactoring.

## Code review flow

1. User provides PR URL to **Code-Reviewer** (via router or by selecting the agent).
2. **Code-Reviewer**: `pull_request_read` → head/base ref and repo URL; `create_workspace` (git_url, branch = head ref) → in workspace: `git fetch origin <base_ref>`, `git diff origin/<base_ref>...HEAD`; `read_workspace_file` for changed files and context → analyze → structured review (summary + optional inline comments).
3. To post on GitHub: **Code-Reviewer** hands off to **GitHub-Assistent** with review body and inline comments; GitHub-Assistent uses `create_review`.

Optional handoffs: Code-Reviewer → Code-Recherche (codebase context) or → Entwickler (fix issues).

## GitHub write tools

GitHub MCP has write access. Write tools (`create_issue`, `create_pull_request`, `create_review`) are assigned **only to GitHub-Assistent**; other developer agents keep read-only or no GitHub write.

## Config

- Agents: [`packages/librechat-init/config/agents.yaml`](../packages/librechat-init/config/agents.yaml)
- Models: [`packages/librechat-init/config/librechat.yaml`](../packages/librechat-init/config/librechat.yaml)
- Init: [`packages/librechat-init/src/init-agents.ts`](../packages/librechat-init/src/init-agents.ts)
