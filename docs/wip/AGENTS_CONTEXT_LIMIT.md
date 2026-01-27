# Agent Context Limit and Pruning

Why "maximum context length is 400000 tokens" errors occur when sending images, and where limits/pruning are enforced.

## Error pattern

Example API error:

```
400 This endpoint's maximum context length is 400000 tokens. However, you requested about 418191 tokens (413444 of text input, 651 of tool input, 4096 in the output). Please reduce the length of either one, or use the "middle-out" transform to compress your prompt automatically.
```

The model allows 400K tokens; the actual request is ~418K. The difference often comes from **image tokens not being counted** before the request is sent.

## Where the 400K limit comes from

- **Model metadata**: [`dev/librechat/packages/api/src/utils/tokens.ts`](dev/librechat/packages/api/src/utils/tokens.ts) – `maxTokensMap` (e.g. `'gpt-5': 400000`). Custom/Scaleway use `endpointTokenConfig` or fallback 18000.
- **Agent init**: [`dev/librechat/packages/api/src/agents/initialize.ts`](dev/librechat/packages/api/src/agents/initialize.ts) (around line 317):
  - `agentMaxContextTokens` = `getModelMaxTokens(...)` or 18000
  - `maxOutputTokens` from llmConfig
  - `agent.maxContextTokens = Math.round((agentMaxContextNum - maxOutputTokensNum) * 0.9)`
- That value is passed into the run as `maxContextTokens` and used as the pruning budget.

## Where pruning runs

- **Agents package**: [`dev/agents/src/graphs/Graph.ts`](dev/agents/src/graphs/Graph.ts) (around lines 666–701).
- Pruning is **only** created and used when **all** of these are true:
  - `agentContext.tokenCounter` is set
  - `agentContext.maxContextTokens != null`
  - `agentContext.indexTokenCountMap[0] != null` (instruction tokens already counted)
- When pruning runs, [`dev/agents/src/messages/prune.ts`](dev/agents/src/messages/prune.ts) `getMessagesWithinTokenLimit` keeps messages whose **combined token count** (from `indexTokenCountMap`) fits in `maxContextTokens`. Messages without an entry use `indexTokenCountMap[i] ?? 0` and, when missing, the prune logic later may call `factoryParams.tokenCounter(message)` to fill gaps.

## Where token counts come from (LibreChat → agents)

- **AgentClient** ([`dev/librechat/api/server/controllers/agents/client.js`](dev/librechat/api/server/controllers/agents/client.js)):
  - Uses `contextStrategy = 'discard'`, so it calls `handleContextStrategy`.
  - For each message, `orderedMessages[i].tokenCount = this.getTokenCountForMessage(formattedMessage)` (when `needsTokenCount` or vision + files).
  - After `handleContextStrategy`, `this.indexTokenCountMap[i] = messages[i].tokenCount`.
  - That `indexTokenCountMap` is passed into `formatAgentMessages` and then into `createRun` → agents.
- **BaseClient.getTokenCountForMessage** ([`dev/librechat/api/app/clients/BaseClient.js`](dev/librechat/api/app/clients/BaseClient.js), around lines 1115–1126):
  - In `processValue`, when iterating content parts it **skips** `ContentTypes.IMAGE_URL` (and THINK, ERROR): `continue` → **image parts contribute 0 tokens**.
  - Comment in code: *"Note: image token calculation is to be done elsewhere where we have access to the image metadata"*.
- In the same flow, **image token cost is not added**: the call to `this.calculateImageTokenCost(...)` is **commented out** in the agents client (around lines 469–474 in `client.js`).

So:

1. **Pruning** uses `indexTokenCountMap` / token counts that **exclude image tokens** (and any logic that would add image cost is commented out).
2. The **real request** includes images, so the provider counts text + tool + **image** tokens.
3. We can stay under `maxContextTokens` in our own accounting but still exceed the model’s 400K at the API.

## Flow summary

```text
initializeAgent
  → getModelMaxTokens / endpointTokenConfig / 18000
  → agent.maxContextTokens = (context - outputReserve) * 0.9

AgentClient.buildMessages
  → handleContextStrategy (contextStrategy = 'discard')
  → getTokenCountForMessage(message)  // IMAGE_URL skipped → 0 tokens per image
  → indexTokenCountMap[i] = tokenCount
  → (calculateImageTokenCost commented out)

createRun({ agents, indexTokenCountMap, tokenCounter, ... })
  → agentContext.maxContextTokens, indexTokenCountMap, tokenCounter

Graph.createCallModel
  → pruneMessages = createPruneMessages({ maxTokens: maxContextTokens, indexTokenCountMap, tokenCounter })
  → pruneMessages({ messages }) → context that “fits” in maxContextTokens
  → but context still contains full image content; image tokens never subtracted from budget

→ Request sent with images → API counts image tokens → total > 400K → 400 error
```

## What to change so pruning respects image tokens

So that pruning keeps the **true** request size under the context limit:

1. **Count image tokens** where the token map is built for the agent run:
   - In **BaseClient.getTokenCountForMessage** (or in an Agents-specific override): for each `ContentTypes.IMAGE_URL` part, add an estimate (e.g. from resolution/detail like OpenAI’s image token rules), or
   - When building **indexTokenCountMap** in the agents client: add image token cost per message (e.g. via `calculateImageTokenCost`) **before** passing the map to `formatAgentMessages` / `createRun`.
2. **Re-enable/add image token logic** in [`dev/librechat/api/server/controllers/agents/client.js`](dev/librechat/api/server/controllers/agents/client.js) in the block around “If message has files, calculate image token cost” (lines 458–475), so `orderedMessages[i].tokenCount` (and thus `indexTokenCountMap`) includes image cost.
3. Ensure the **tokenCounter** used inside the agents package ([`dev/agents/src/messages/prune.ts`](dev/agents/src/messages/prune.ts)) also attributes tokens to image parts when it fills missing entries (e.g. when `indexTokenCountMap[i] === undefined` and `factoryParams.tokenCounter(message)` is used). That may require a tokenCounter that is aware of image content or that receives precomputed counts that already include images.

Until image tokens are included in the same counts that drive pruning, context-limit errors when sending images will continue.

## References

- [`dev/librechat/packages/api/src/utils/tokens.ts`](dev/librechat/packages/api/src/utils/tokens.ts) – `getModelMaxTokens`, `maxTokensMap`
- [`dev/librechat/packages/api/src/agents/initialize.ts`](dev/librechat/packages/api/src/agents/initialize.ts) – `agent.maxContextTokens`
- [`dev/agents/src/graphs/Graph.ts`](dev/agents/src/graphs/Graph.ts) – `createPruneMessages`, when pruning runs
- [`dev/agents/src/messages/prune.ts`](dev/agents/src/messages/prune.ts) – `getMessagesWithinTokenLimit`, `indexTokenCountMap`, `tokenCounter`
- [`dev/librechat/api/app/clients/BaseClient.js`](dev/librechat/api/app/clients/BaseClient.js) – `getTokenCountForMessage` (skips `IMAGE_URL`)
- [`dev/librechat/api/server/controllers/agents/client.js`](dev/librechat/api/server/controllers/agents/client.js) – `buildMessages`, `indexTokenCountMap`, commented `calculateImageTokenCost`
