# WIP Documentation

Work-in-progress notes and design docs for vision handling, YTPTube production, agent token metadata, and related refactors. Content may change as implementation evolves.

## YTPTube production

Works locally; on server (e.g. Hetzner), blocking (geo/bot) may apply. See [YTPTUBE_FUTURE_WORK.md](YTPTUBE_FUTURE_WORK.md) for production options and [TODO.md](../TODO.md) for the tracked task.

## Branch Status & Upstream Sync (Jan 2025)

Vision is **re-enabled as experimental/WIP**. Implementation lives on `feat/vision` in submodules; config in this repo is active and explicitly marked WIP.

| Aspect | Details |
|--------|---------|
| **Submodules** | `dev/librechat`, `dev/agents` |
| **Feature branch** | `feat/vision` (required for vision to work) |
| **Status** | **Experimental/WIP** – not merged upstream yet |
| **Draft PRs** | [LibreChat PR #11501](https://github.com/danny-avila/LibreChat/pull/11501) (modelSpecs vision flag), [agents PR #48](https://github.com/danny-avila/agents/pull/48) (base64 artifact filtering) |

**Config:** Vision is turned on in `packages/librechat-init/config/librechat.yaml` and labelled WIP/experimental:
- Agents capability: `- "vision"` (around line 102) with comment `# WIP/experimental`
- Model specs: `vision: true` on vision-capable models (Scaleway Pixtral/Mistral Small, OpenRouter Claude/GPT/Gemini). Section header references draft PRs.

To bring submodule `main` in line with upstream while keeping vision on `feat/vision`, use **[Submodule Sync Guide](../SUBMODULE_SYNC.md)** (`npm run update:submodules:status`, `npm run update:submodules`, `npm run update:submodules:dry-run`).

## Contents

| Document | Description |
|----------|-------------|
| **[YTPTube Future Work](YTPTUBE_FUTURE_WORK.md)** | Production options (proxy, FlareSolverr, office Pi); status and ideas |
| **[PR: LibreChat testing](PR-feat-librechat-testing.md)** | PR text draft for feat/librechat-testing |
| **[Vision Architecture](VISION_ARCHITECTURE.md)** | Vision capability detection and MCP artifact processing (Agents & Assistants) |
| **[Vision Design](VISION_DESIGN.md)** | Single rule and where images are filtered for non-vision models |
| **[Vision Debug Status](VISION_DEBUG_STATUS.md)** | Vision artifact refactoring status and testing notes |
| **[Agent Token Metadata](AGENTS_TOKEN_METADATA.md)** | Context and max_tokens for custom/Scaleway models |
| **[Agent Context Limit](AGENTS_CONTEXT_LIMIT.md)** | Where the 400K context limit comes from, where pruning runs, and why image tokens cause "418191 tokens" errors |

## Navigation

- [Documentation index](../README.md)
