# Agent avatars

Round, playful avatars for LibreChat shared agents. Generated via image-gen MCP (see [docs/AGENT_AVATAR_PROMPTS.md](../../../docs/AGENT_AVATAR_PROMPTS.md)).

## Automatic upload

Each agent in `config/agents.yaml` can name a file in this folder with `avatar:`. When librechat-init creates or updates the agent, it uploads that file through the LibreChat API, but only if the agent has no avatar yet. An avatar set by hand in the UI is never overwritten. A failed upload logs a warning and does not fail the init.

| Agent ID | Filename |
|----------|----------|
| shared-agent-assistant | shared-agent-assistant.png |
| shared-agent-faktencheck | shared-agent-faktencheck.png |
| shared-agent-image-generation | shared-agent-image-generation.png |
| shared-agent-travel-location | shared-agent-travel-location.png |

To replace an avatar that was already uploaded, change it in LibreChat (Agent settings) or clear it there first.
