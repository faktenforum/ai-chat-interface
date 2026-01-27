# Agent Token Metadata (Custom / Scaleway)

> **WIP** – Work-in-progress. See [WIP Documentation](README.md).

Custom and Scaleway models need context size and max-output metadata so agent init and completion requests use valid `max_tokens` values. Without it, `getModelMaxTokens` can return `undefined`, init may use fallbacks, and stored or derived values can produce invalid requests (e.g. `max_tokens must be at least 1`).

## Why It Matters

- **Agent init** ([`dev/librechat/packages/api/src/agents/initialize.ts`](../../dev/librechat/packages/api/src/agents/initialize.ts)) uses `getModelMaxTokens(modelName, endpoint, endpointTokenConfig)` to compute `agentMaxContextTokens`. If the model is unknown, it falls back to 18000.
- **max_tokens** in completion requests comes from `agent.model_parameters` (getOptions / DB / request). If metadata is missing or wrong, that value can be invalid (e.g. negative).
- **Safeguards** in the run ([`dev/librechat/packages/api/src/agents/run.ts`](../../dev/librechat/packages/api/src/agents/run.ts)) clamp `max_tokens`/`maxTokens` to at least 1 and default to 4096 when absent or invalid, but correct metadata avoids relying on that and keeps context/pruning correct.

## Providing Metadata

### 1. Token config from model fetch (recommended)

For custom endpoints with `models.fetch: true`, the stack fetches model list and builds `endpointTokenConfig` via `processModelData` ([`dev/librechat/packages/api/src/utils/tokens.ts`](../../dev/librechat/packages/api/src/utils/tokens.ts)). Each model entry should include `context_length` (and optionally per-model output limits). That config is passed into custom init and used by `getModelMaxTokens` when `endpointTokenConfig` is set.

Ensure the fetch response includes `context_length` (and, if supported, per-model output limits) so `getModelMaxTokens` and init get sane values for your models.

### 2. Explicit tokenConfig on the endpoint

Custom endpoints support an optional `tokenConfig` property on the endpoint config. If set, it is used as `endpointTokenConfig` instead of (or in addition to) the fetched config. Define per-model context (and optionally output) so unknown models are not left with undefined limits.

Example shape (conceptual): map model id to `{ context: number }` or to the structure used by `getModelTokenValue` / `EndpointTokenConfig`.

### 3. LibreChat config

Custom endpoints are configured in [`packages/librechat-init/config/librechat.yaml`](../../packages/librechat-init/config/librechat.yaml) under `endpoints.custom`. For Scaleway (or any custom provider):

- Use `models.fetch: true` so context/metadata comes from the provider's model list when supported.
- If the provider does not expose context in the fetch response, add a static `tokenConfig` (or equivalent) for the models you use so `getModelMaxTokens` and agent init see correct context and do not produce invalid or fallback-only behaviour.

## References

- [`dev/librechat/packages/api/src/utils/tokens.ts`](../../dev/librechat/packages/api/src/utils/tokens.ts): `getModelMaxTokens`, `endpointTokenConfig`, `processModelData`, `maxTokensMap`
- [`dev/librechat/packages/api/src/agents/initialize.ts`](../../dev/librechat/packages/api/src/agents/initialize.ts): `agentMaxContextTokens`, `maxOutputTokens`, use of `getModelMaxTokens`
- [`dev/librechat/packages/api/src/endpoints/custom/initialize.ts`](../../dev/librechat/packages/api/src/endpoints/custom/initialize.ts): `tokenConfig`, `endpointTokenConfig`, `FetchTokenConfig`
