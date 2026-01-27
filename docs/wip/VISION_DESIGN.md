# Vision Handling Design

> **WIP** – Work-in-progress. See [WIP Documentation](README.md).

## Single Rule

**Never send image content (image_url, IMAGE_FILE) to the LLM when the model does not support vision.**

This prevents "model is not a multimodal model" and "No endpoints found that support image input" errors while still allowing image-generation tools to work (images are stored/shown in UI but not re-fed to the model).

## Where We Enforce It

| Flow | Entry point | What is filtered |
|------|-------------|------------------|
| **Agent (all messages → API)** | `_convertMessagesToOpenAIParams` / `_convertMessagesToOpenAIResponsesParams` (agents package) | All `image_url` parts in every message (user, assistant, tool), including history and MCP results, when `visionCapable` is false. **Single choke point for the agent flow.** |
| **Assistants (thread artifacts)** | `ToolService.processArtifactsForAssistants` (LibreChat) | Artifact content only. The Assistants flow does not use the agents LLM layer; this is the only filter for that path. |

## Agent Flow: One Choke Point

For the agent flow, **all** messages that reach the LLM go through the OpenAI utils before the API request:

- **`_convertMessagesToOpenAIParams`** (Completions API): When `options.visionCapable === false`, strips all `image_url` parts from every message's content; for tool messages with array content, serializes to text and uses a placeholder if all parts were images.
- **`_convertMessagesToOpenAIResponsesParams`** (Responses API): Same via a `visionCapable` parameter; omits `input_image` for user/system/developer when false, and replaces image-heavy tool/computer_call_output with a placeholder.

That covers:

- User attachments (`image_urls` in messages that become content parts)
- MCP tool results (content and artifact, after `formatArtifactPayload` merges artifact into ToolMessage.content)
- Conversation history loaded from DB (already contains tool outputs or assistant content with images)

Vision is passed from `agentContext.vision` into `clientOptions.vision` when the graph builds the LLM; `ChatOpenAI`, `AzureChatOpenAI`, `ChatOpenRouter`, `ChatDeepSeek`, and `ChatXAI` read it and pass `visionCapable` into these converters.

**Removed as redundant:** ToolNode and AgentClient.buildMessages no longer filter; the LLM layer alone is sufficient and avoids duplicate logic.

## Assistants Flow

The Assistants API uses a different code path (LibreChat ToolService, not the agents package). Only artifact content is merged into the thread as a user message. That path is covered by `processArtifactsForAssistants` (vision check + filtering). The tool_output text does not carry image parts.

## Simplification Summary

1. **Single rule** – One sentence defines the contract; all code paths that feed the LLM obey it.
2. **Agent flow: one choke point** – The LLM layer (OpenAI utils) filters every message right before the API request. No filtering in ToolNode or buildMessages.
3. **Assistants flow** – `processArtifactsForAssistants` remains the only filter for that path.
4. **ToolNode** – Only normalizes MCP image format (type `'image'` → `image_url`); does not strip images. The LLM layer does that when converting to API params.
