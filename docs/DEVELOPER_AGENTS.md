# Developer Agents

Development requests are routed by **Entwickler-Router** to task-specific specialists. Universal hands off to this router once (10-handoff limit); the router then has up to 10 handoffs to specialists.

## Router hierarchy

```
Universal ──► Entwickler-Router ──► Code-Recherche | Entwickler | Code-Refactorer
                                 ──► GitHub-Assistent | Code-Reviewer | Code-Review-Workflow
                                 ──► Universal (back)
```

## Agents

| Agent | ID | Provider | Model | Tools | Role |
|-------|----|----------|-------|-------|------|
| **Entwickler-Router** | `shared-agent-developer-router` | Scaleway | mistral-small-3.2-24b | None | Route to specialist |
| **Code-Recherche** | `shared-agent-code-researcher` | OpenRouter | anthropic/claude-opus-4.6 | ~35 (Linux subset, GitHub, Docs, SO, npm, web_search) | Understand code, find examples, search docs. No implementation. |
| **Entwickler** | `shared-agent-developer` | OpenRouter | anthropic/claude-opus-4.6 | 18 (Linux full, web_search) | Implement, fix bugs. Chain → Code-Refactorer. |
| **Code-Refactorer** | `shared-agent-code-refactorer` | OpenRouter | google/gemini-3-pro-preview | 18 (Linux full, web_search) | Refactor, polish, restructure. |
| **GitHub-Assistent** | `shared-agent-github` | Scaleway | qwen3-235b | ~21 (GitHub read, Linux minimal) | PRs, issues, post reviews. |
| **Code-Reviewer** | `shared-agent-code-reviewer` | OpenRouter | google/gemini-3-pro-preview | ~18 (Linux subset, GitHub read) | Analyze PR diff + codebase, produce review. |
| **Code-Review-Workflow** | `shared-agent-code-review-workflow` | Scaleway | mistral-small-3.2-24b | None (chain) | PR link → auto review on GitHub. |

## Chains

- **Entwickler → Code-Refactorer**: After implementation, Code-Refactorer runs automatically.
- **Code-Review-Workflow → Code-Reviewer → GitHub-Assistent**: User pastes PR link → review analyzed → posted by GitHub-Assistent.

## Handoffs

Each specialist can hand off to Entwickler-Router, Universal, and 2–3 relevant specialists (e.g. Entwickler → Code-Recherche, GitHub-Assistent). Each agent stays at 4–5 handoffs.

## Code review flow

1. User provides PR URL (Code-Review-Workflow or Code-Reviewer).
2. **Code-Reviewer**: Parse URL → clone → checkout PR branch → `git diff` → read changed files + context → analyze → structured review (summary + optional inline comments).
3. **GitHub-Assistent**: Receives review (chain or handoff) → posts on PR when `create_review` is available.

Optional: Code-Reviewer → Code-Recherche (deeper codebase understanding) or → Entwickler (fix issues found).

## GitHub write tools

GitHub MCP is read-only. When `create_issue`, `create_pull_request`, `create_review` exist, add them **only to GitHub-Assistent**.

## Config

- Agents: [`packages/librechat-init/config/agents.yaml`](../packages/librechat-init/config/agents.yaml)
- Models: [`packages/librechat-init/config/librechat.yaml`](../packages/librechat-init/config/librechat.yaml)
- Init: [`packages/librechat-init/src/init-agents.ts`](../packages/librechat-init/src/init-agents.ts)
