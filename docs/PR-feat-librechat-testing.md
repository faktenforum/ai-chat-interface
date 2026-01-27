# PR suggestion: LibreChat testing (upstream contribution workflow)

Use this as the PR title and description when opening the PR for the LibreChat test stack and docs.

---

## Title

```
feat: LibreChat test stack and docs for upstream contribution workflow
```

---

## Description

**Goal:** Run LibreChat unit and E2E tests locally so we can contribute patches upstream.

**What’s in this PR:**
- Dedicated test stack (MongoDB + Meilisearch) and env template
- Docs: [LibreChat Testing](docs/LIBRECHAT_TESTING.md) — prerequisites, stack, unit/E2E steps, OpenSSL 1.1 for `mongodb-memory-server`, troubleshooting
- Root npm scripts: `test:librechat:stack:up/down`, `test:librechat:unit`, `test:librechat:e2e`, `test:librechat:link-agents/unlink-agents`
- Index updates in `docs/README.md` and `docs/SERVICES.md`

Tests run on the host. The stack is required for E2E; unit tests use in-memory MongoDB and do not need it. Optional `npm link` flow to use local `dev/agents` when testing agent-related changes.
