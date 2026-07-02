# Agent avatars

Round, playful avatars for LibreChat shared agents. Generated via image-gen MCP (see [docs/AGENT_AVATAR_PROMPTS.md](../../../docs/AGENT_AVATAR_PROMPTS.md)).

## Saving generated images

The image-gen MCP shows each generated image in the chat. To use them:

1. In the chat where the avatars were generated, save each image (e.g. right‑click → Save image as).
2. Name files by agent ID and put them here:

| Order | Agent ID | Suggested filename |
|-------|----------|---------------------|
| 1 | shared-agent-assistant | shared-agent-assistant.png |
| 2 | shared-agent-faktencheck | shared-agent-faktencheck.png |
| 3 | shared-agent-image-generation | shared-agent-image-generation.png |
| 4 | shared-agent-travel-location | shared-agent-travel-location.png |

3. In LibreChat: open each agent in the sidebar → Agent settings → upload the matching avatar image.

Avatars are stored per agent in the backend (DB); this folder is for your copies and version control if desired.
