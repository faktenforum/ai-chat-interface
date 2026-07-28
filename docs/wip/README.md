# WIP Documentation

Work-in-progress notes and design docs for vision handling, YTPTube production, agent token metadata, and related refactors. Content may change as implementation evolves.

## YTPTube production

Works locally; on server (e.g. Hetzner), blocking (geo/bot) may apply. See [YTPTUBE_FUTURE_WORK.md](YTPTUBE_FUTURE_WORK.md) for production options and [TODO.md](../TODO.md) for the tracked task.

## Branch Status & Upstream Sync (2026-07)

Vision is a **permanent fork feature**, not a WIP branch: our non-vision models hard-fail on image
input, so something has to gate it. It lives on fork `main` in both `dev/librechat` and `dev/agents`.

The 2026-07 upstream sync rebuilt the LibreChat side onto upstream's refactored agent builder -
vision is now a builtin capability item in upstream's own catalog rather than a bespoke checkbox.
**The three VISION_*.md documents below describe the pre-2026-07 structure and are kept as design
history.** For the current wiring see
[LIBRECHAT_FEATURES.md](../LIBRECHAT_FEATURES.md#vision-gating-fork-only).

| Aspect | Details |
|--------|---------|
| **Submodules** | `dev/librechat`, `dev/agents` (vision on fork `main`) |
| **Status** | Fork-only; upstream does not gate image input |
| **Upstream attempts** | [agents PR #257](https://github.com/danny-avila/agents/pull/257) and [LibreChat PR #13860](https://github.com/danny-avila/LibreChat/pull/13860) - neither merged |

**Config:** `packages/librechat-init/config/librechat.yaml`
- Agents capability: `- "vision"`
- Model specs: `vision: true` on the image-capable specs (Scaleway Pixtral / Mistral Small /
  Mistral Medium / Gemma 4 / Qwen3.5+3.6 / Holo2, OpenRouter Claude / GPT / Gemini / Grok / Kimi).

To keep the forks in line with upstream, use **[Submodule Sync Guide](../SUBMODULE_SYNC.md)** (`npm run update:submodules:status`, `npm run update:submodules`, `npm run update:submodules:dry-run`).

## Contents

| Document | Description |
|----------|-------------|
| **[YTPTube Future Work](YTPTUBE_FUTURE_WORK.md)** | Production options (proxy, FlareSolverr, office Pi); status and ideas |
| **[PR: LibreChat testing](PR-feat-librechat-testing.md)** | PR text draft for feat/librechat-testing |
| **[Vision Architecture](VISION_ARCHITECTURE.md)** | Design history (pre-2026-07): vision capability detection and MCP artifact processing |
| **[Vision Design](VISION_DESIGN.md)** | Design history (pre-2026-07): the single rule and where images are filtered |
| **[Vision Debug Status](VISION_DEBUG_STATUS.md)** | Design history (pre-2026-07): artifact refactoring status and testing notes |
| **[Agent Token Metadata](AGENTS_TOKEN_METADATA.md)** | Context and max_tokens for custom/Scaleway models |
| **[Agent Context Limit](AGENTS_CONTEXT_LIMIT.md)** | Where the 400K context limit comes from, where pruning runs, and why image tokens cause "418191 tokens" errors |

## Navigation

- [Documentation index](../README.md)
