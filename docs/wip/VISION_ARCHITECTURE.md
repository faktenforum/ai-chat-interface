# Vision Capability & MCP Artifact Architecture

> **WIP** – Work-in-progress. See [WIP Documentation](README.md).

## Overview

This document describes the architecture for vision capability detection and MCP artifact processing in LibreChat. The implementation ensures consistent behavior across Agents and Assistants endpoints, addressing Issue #11418 where MCP image generation tools were sending generated images to non-vision models, causing errors.

## Key Principles

1. **Images are ALWAYS saved** to files regardless of vision capability (for LibreChat UI/attachments)
2. **Images are ONLY sent to LLM** if vision capability is enabled (prevents context overflow errors)
3. **Single Source of Truth**: Vision detection uses `validateVisionModel()` everywhere
4. **Consistent Processing**: Same artifact filtering logic for both endpoints
5. **Clean Code**: No debug logging in production code

## Important Distinction: Artifacts vs Vision

**Artifacts (UI Display)** and **Vision (LLM Input)** are two separate concepts:

- **Artifacts**: Generated content (like images) that is **displayed to the user** in the chat UI. This is independent of vision capability. Images are always saved to files so users can see them, even if the LLM cannot process them.

- **Vision**: The LLM's ability to **process images as input**. This determines whether images are sent back to the LLM in subsequent requests.

**Why this matters:**
- MCP tools (like image generation) create artifacts that should be visible to users
- These artifacts are saved to files and displayed in the UI (Artifacts feature)
- However, sending base64-encoded images back to non-vision LLMs causes context overflow errors
- Therefore: **Save always (for UI), send only if vision-enabled (for LLM)**

This is why you see images in the chat even when "artifacts are disabled" - the UI display is separate from whether the LLM receives the images as input.

## Architecture Components

### 1. Vision Capability Detection

**Location**: `dev/librechat/packages/data-provider/src/config.ts`

**Function**: `validateVisionModel()`

**Flow**:
1. Checks `modelSpecs` configuration first (if provided) - explicit `vision: boolean` flag per model
2. Falls back to hardcoded `visionModels` list for known vision-capable models
3. Excludes known non-vision models (e.g., `gpt-4-turbo-preview`, `o1-mini`)

**Usage**:
- **Client**: `useVisionModel()` hook in `client/src/hooks/useVisionModel.ts`
- **Server**: `ToolService.js` via `getVisionCapability()` function
- **Agents**: Automatically determined in `createRun()` via `determineVisionCapability()` helper function

**Key Function Signature**:
```typescript
validateVisionModel({
  model: string,
  modelSpecs?: TSpecsConfig,
  availableModels?: string[],
  additionalModels?: string[]
}): boolean
```

### 2. Agent Vision Capability

**Location**: `dev/librechat/packages/api/src/agents/run.ts` (auto-detection) and `dev/agents/src/agents/AgentContext.ts` (storage)

**Flow**:
1. **Automatic Detection** (in `createRun()`):
   - If `agent.vision` is explicitly set (via UI), use that value
   - Otherwise, automatically determine using `validateVisionModel()` based on `agent.model` and `modelSpecs`
   - This ensures consistency with Assistants endpoint behavior
2. Stored in `AgentContext` from `AgentInputs` during agent initialization
3. Used in `Graph.createCallModel()` to determine if `formatArtifactPayload` should filter base64 images

**Key Usage**:
```typescript
// In run.ts -> buildAgentContext()
const visionCapability = determineVisionCapability(agent, modelSpecs, availableModels);

// In Graph.ts
const visionCapability = agentContext.vision ?? false;
formatArtifactPayload(finalMessages, visionCapability);
```

**Helper Function**:
The `determineVisionCapability()` function in `run.ts` encapsulates the vision detection logic:
- Checks for explicit `agent.vision` override first
- Falls back to `validateVisionModel()` with model from `agent.model_parameters?.model ?? agent.model`
- Returns `false` if no model is available

**Configuration**:
- **Automatic**: Determined from `agent.model` using `validateVisionModel()` (default behavior)
- **Manual Override**: Optional checkbox in agent configuration UI (ImageVision component)
- Stored in agent document in MongoDB when explicitly set
- Passed through API to agents package via `AgentInputs`

### 3. MCP Tool Artifact Processing

#### For Agents Endpoint

**Location**: `dev/agents/src/messages/core.ts` and `dev/agents/src/tools/ToolNode.ts`

**Flow**:
1. MCP tools return `[content, artifact]` tuple from `formatToolContent()` (in `librechat/packages/api/src/mcp/parsers.ts`)
2. `ToolNode.runTool()` processes the artifact:
   - Converts MCP format (`type: 'image'`) to standard format (`type: 'image_url'`)
   - Filters base64 images if vision is disabled (`visionCapable === false`)
   - Stores processed artifact in `ToolMessage.additional_kwargs.artifact`
3. Messages flow through LangGraph's `messagesStateReducer`
   - `additional_kwargs` is preserved during `coerceMessageLikeToMessage()`
   - Artifact property would be lost, but we don't rely on it
4. `formatArtifactPayload()` adds artifacts directly to `ToolMessage.content`:
   - Restores artifacts from `additional_kwargs` to `artifact` property
   - Appends artifact content directly to `ToolMessage.content` as array
   - Maintains proper role sequencing without requiring empty `AIMessage` or separate `HumanMessage`
   - Compatible with strict APIs (e.g., Scaleway) that reject empty assistant messages

**Why additional_kwargs?**:
- `additional_kwargs` survives state management (unlike `artifact` property)
- No complex caching needed
- Vision filtering happens once, during artifact creation
- Clean, simple, maintainable

**Key Function**:
```typescript
formatArtifactPayload(
  messages: BaseMessage[],
  isVisionModel: boolean = true
): void
```

**Role Sequencing Fix**:
- Some strict APIs (e.g., Scaleway) require alternating `user/assistant/user/assistant/...` pattern
- Adding `HumanMessage` directly after `ToolMessage` violates this rule
- Empty `AIMessage` is also rejected by some APIs (e.g., Scaleway with certain models)
- Solution: Append artifacts directly to `ToolMessage.content` (similar to Anthropic approach):
  ```typescript
  // Sequence: ToolMessage (with artifacts in content) → LLM call → AIMessage
  // Artifacts are appended to ToolMessage.content array, maintaining proper sequencing
  toolMsg.content = [...currentContent, ...artifact.content];
  ```
- This ensures compliance with strict API requirements while preserving artifact functionality
- No additional messages required, keeping the message sequence clean

**Provider Support**:
- Determined by `supportsArtifactFormatting()` helper in `Graph.ts`
- Supports OpenAI-compatible providers, Google providers, and custom endpoints
- Anthropic uses separate `formatAnthropicArtifactContent()` function

#### For Assistants Endpoint

**Location**: `dev/librechat/api/server/services/ToolService.js`

**Flow**:
1. `formatToolContent()` returns `[content, artifact]` tuple
2. Artifacts detected in `processRequiredActions()` after all tool outputs are collected
3. `processArtifactsForAssistants()` processes artifacts:
   - **ALWAYS saves** base64 images to files (for UI/attachments)
   - **ONLY includes** base64 images in contentParts if `isVisionModel === true`
   - **ALWAYS includes** HTTP URLs (they're just text references, don't cause context overflow)
4. Artifacts stored on `client.pendingArtifactContent` and `client.pendingArtifactFileIds`
5. Added to thread as user message in `runAssistant()` before `submitToolOutputs()`

**Implementation Details**:
- Vision capability checked via `getVisionCapability(client)` using `validateVisionModel()`
- Artifacts processed after all tool outputs are collected
- User message created with artifact content and file_ids before recursive `runAssistant()` call
- Files saved with `FileContext.image_generation` for proper categorization

### 4. Artifact Cache

**Location**: `dev/agents/src/graphs/Graph.ts`

**Purpose**: Preserves MCP tool artifacts that may be lost during LangGraph state management.

**Implementation**:
- `artifactCache: Map<string, { content: unknown[] }>` - Stores artifacts keyed by `tool_call_id`
- Artifacts are stored in `ToolNode.runTool()` when ToolMessages are returned
- Artifacts are restored in `Graph.createCallModel()` before `formatArtifactPayload()` is called
- Cache is cleared on `Graph.resetValues()` to prevent memory leaks

**Why this approach**:
- LangGraph's `messagesStateReducer` uses `coerceMessageLikeToMessage` which doesn't preserve the `artifact` property
- Trying to patch the reducer is fragile and complex
- Cache pattern provides clean separation of concerns and reliable artifact preservation

### 5. Shared Utilities

#### `isBase64ImageUrl()` Function

**Location**:
- `dev/librechat/packages/api/src/utils/image-helpers.ts` (for Assistants endpoint)
- `dev/agents/src/tools/ToolNode.ts` (local implementation in `runTool()` for Agents endpoint)

**Note**: The agents package has a local implementation in the `runTool()` method because it cannot import from `@librechat/api` (separate npm package). The logic is identical.

**Functionality**:
- Checks if an `image_url` content item contains base64 data (starts with `data:`)
- HTTP URLs are just text references and don't need filtering
- Used by both Agents and Assistants endpoints for consistent filtering

**Usage**:
```typescript
// In agents package (ToolNode.runTool > processArtifact)
if (!this.visionCapable) {
  artifactObj.content = artifactObj.content.filter((item) => !isBase64ImageUrl(item));
}

// In Assistants endpoint (processArtifactsForAssistants)
const isBase64 = isBase64ImageUrl(item);
if (isBase64) {
  // Save to file, only include in contentParts if vision enabled
} else {
  // HTTP URLs - always include (just text references)
}
```

**Important Notes**:
- **Only Base64 images are filtered**: The function `isBase64ImageUrl()` only checks for `image_url` types with `data:` URLs
- **HTTP/HTTPS URLs are never filtered**: They are just text references and don't cause context overflow
- **Other image formats are not filtered**: `image_file` types (with `file_id`) are not checked by `isBase64ImageUrl()` and therefore pass through unchanged
- **Why filter Base64?**: Base64-encoded images are very large and can cause context-length-overflow errors when sent to non-vision models. HTTP URLs are just strings and don't have this problem.

## Implementation Details

### Provider Detection Logic

**Location**: `dev/agents/src/graphs/Graph.ts`

The `supportsArtifactFormatting()` helper function determines which providers support artifact formatting:

- **Anthropic**: Uses separate `formatAnthropicArtifactContent()` (not artifact formatting)
- **Non-artifact providers**: Bedrock, VertexAI, Ollama (excluded)
- **OpenAI-compatible**: OpenAI, Azure OpenAI, and custom endpoints (supported)
- **Google**: Google providers (supported)
- **Custom endpoints**: Automatically detected if not in exclusion list

### MCP Tool Handling

**Location**: `dev/agents/src/tools/ToolNode.ts`

The `extractMCPArtifact()` helper function:
- Detects MCP tools by checking `tool.mcp === true`
- Uses `tool._call()` directly to get `[content, artifact]` tuple (LangChain's `invoke()` unwraps it)
- Falls back to standard `invoke()` if `_call` fails or tool is not MCP
- Extracts artifact object from tuple for `ToolMessage` creation
- Converts MCP format (`type: 'image'` with `data:`) to standard format (`type: 'image_url'` with `image_url: { url: '...' }`)
- Stores artifact in `Graph.artifactCache` for later restoration

### Message State Reducer

**Location**: `dev/agents/src/messages/reducer.ts`

The `messagesStateReducer` uses conditional coercion for efficiency:
- Only coerces message-like objects when they're not already `BaseMessage` instances
- Artifacts are handled separately via the cache, so the reducer doesn't need to preserve them
- This keeps the reducer simple and maintainable

### Consistency Between Endpoints

Both Agents and Assistants endpoints now use the same automatic vision detection pattern:

**Assistants Endpoint**:
- Uses `getVisionCapability(client)` which calls `validateVisionModel(model, modelSpecs, availableModels)`
- Model comes from `client.req.body.model`
- Fully automatic - no manual configuration needed

**Agents Endpoint**:
- Uses `determineVisionCapability()` helper in `createRun()` → `buildAgentContext()`
- Helper function checks `agent.vision` override first, then calls `validateVisionModel()`
- Model resolution: `agent.model_parameters?.model ?? agent.model` (model_parameters takes precedence)
- Supports optional manual override via UI checkbox (`agent.vision`)
- If `agent.vision` is explicitly set, uses that value; otherwise auto-detects

**Key Benefits**:
- Consistent behavior across both endpoints
- Automatic detection reduces configuration burden
- Manual override available when needed (Agents only)
- Single source of truth: `validateVisionModel()` function

## Code Quality

### Removed Debug Logging

All debug logging has been removed from production code:
- ✅ Removed `console.log('[ARTIFACT-DEBUG]...')` from agents package
- ✅ Removed `logger.info('[ARTIFACT-DEBUG]...')` from LibreChat services
- ✅ Clean production logs without debug noise

### Code Simplification

- ✅ Replaced broken artifact cache with `additional_kwargs` pattern
- ✅ Reduced ToolNode artifact handling from ~200 to ~70 lines
- ✅ Single code path for all MCP tools (no duplicate logic)
- ✅ Vision filtering in one place (ToolNode) during artifact creation
- ✅ Removed ~50 debug log statements
- ✅ Extracted vision detection to `determineVisionCapability()` helper function
- ✅ Simplified provider detection logic with `supportsArtifactFormatting()` helper
- ✅ Improved `ImageVision` component with better UX
- ✅ Fixed HTTP URL filtering (only base64 images need filtering)
- ✅ Removed unnecessary type assertions and simplified conditionals
- ✅ Improved code readability and maintainability
- ✅ Clean separation of concerns: artifact storage uses standard LangChain patterns

## Benefits

1. **Consistency**: Same vision detection logic everywhere via `validateVisionModel()`
2. **Unified Artifact Processing**: Same filtering logic for Agents and Assistants endpoints
3. **Architectural Alignment**: Follows existing patterns (modelSpecs → validateVisionModel)
4. **Maintainability**: Changes in one place affect both endpoints
5. **Image Generation Support**: Non-vision LLMs can generate images (saved but not sent back)
6. **Clean Code**: No debug logging, simplified logic, better documentation
7. **Type Safety**: Proper TypeScript types throughout

## Related Issues

- [#11418](https://github.com/danny-avila/LibreChat/issues/11418) - Enhancement: Determine whether an endpoint and/or model is vision capable via config
- [#11413](https://github.com/danny-avila/LibreChat/issues/11413) - Bug: MCP Image Generation Tools sending generated images to non-vision models
- [#11333](https://github.com/danny-avila/LibreChat/discussions/11333) - Image Upload Option Shown for Non-Vision Models
- [#10996](https://github.com/danny-avila/LibreChat/issues/10996) - Enhancement: Custom endpoint config to allow processing image outputs from MCP as attachments
