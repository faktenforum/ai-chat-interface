# Vision Artifact Refactoring - Completed

> **WIP** – Work-in-progress. See [WIP Documentation](README.md).

## Problem (Solved)

MCP tool artifacts (especially images) were lost during LangGraph state management because `coerceMessageLikeToMessage()` doesn't preserve the `artifact` property.

## Implemented Solution: additional_kwargs Pattern

### Architecture
1. **ToolNode creates artifacts**: MCP tools return `[content, artifact]` tuple
2. **Vision-based filtering**: Base64 images filtered in ToolNode if vision disabled
3. **Storage in additional_kwargs**: Artifacts stored in `ToolMessage.additional_kwargs.artifact`
4. **Restoration**: `formatArtifactPayload()` restores artifacts from `additional_kwargs` to `artifact` property

### Why additional_kwargs?
- ✅ `additional_kwargs` survives `coerceMessageLikeToMessage()` during state management
- ✅ No complex caching needed
- ✅ Single code path, clean and simple
- ✅ Fixes root cause instead of working around it

### Files Modified
- `dev/agents/src/tools/ToolNode.ts`: Artifact creation, MCP format conversion, vision filtering
- `dev/agents/src/messages/core.ts`: Artifact restoration from additional_kwargs
- `dev/agents/src/graphs/Graph.ts`: Passes vision capability to ToolNode
- `dev/agents/src/types/tools.ts`: Added `visionCapable` to ToolNodeOptions

## Key Changes

### 1. ToolNode Simplification
- **Before**: Complex `extractMCPArtifact()` with duplicate code paths, artifact cache
- **After**: Single `processArtifact()` helper, stores in `additional_kwargs`
- **Lines reduced**: ~200 → ~70 lines

### 2. Removed Artifact Cache
- Removed broken cache pattern from Graph.ts and ToolNode.ts
- Removed ~40 lines of cache restoration logic
- Removed `artifactCache` type definitions

### 3. Vision Filtering in ToolNode
- Base64 images filtered during artifact creation (not later)
- HTTP URLs preserved (just text references)
- Single point of filtering, consistent behavior

### 4. Cleaned Up Debug Logging
- Removed all `[IMAGE_DEBUG]` console.log statements from `openrouter/index.ts` (~45 lines)
- Removed all `[VISION]` console.log statements from `run.ts` (3 occurrences)
- Removed debug logging from `Graph.ts` (toolMessagesWithArtifactsInState)
- Simplified error handling in `Graph.ts` (removed verbose console.error)
- Production-ready code without debug noise

### 5. Role Sequencing Fix
- Fixed Scaleway API errors: "Unexpected role 'user' after role 'tool'" and "Invalid assistant message: role='assistant' content=''"
- Changed approach: Append artifacts directly to `ToolMessage.content` (similar to Anthropic)
- No empty `AIMessage` or separate `HumanMessage` required
- Maintains proper `user/assistant/user/assistant/...` pattern required by strict APIs
- Ensures compatibility with all OpenAI-compatible providers, including strict ones like Scaleway

## Testing

```bash
# Rebuild agents
cd dev/agents && npm run build

# Restart LibreChat
docker compose -f docker-compose.local-dev.yml restart api

# Test with different providers:
# - OpenRouter: Vision + MCP screenshot tool (should continue working)
# - Scaleway: Non-vision + MCP screenshot tool (should no longer error)
# - Anthropic: Vision + MCP screenshot tool (should continue working)
# - Google: Vision + MCP screenshot tool (should work with role sequencing fix)
```

## Status

✅ **Completed and Cleaned**:
- Refactoring complete
- All debug logging removed
- Role sequencing fixed for strict APIs
- Production ready
- Build successful
- Ready for PR submission
