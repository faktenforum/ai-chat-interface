# Agent avatars

Round, playful avatars for LibreChat shared agents. Generated via image-gen MCP (see [docs/AGENT_AVATAR_PROMPTS.md](../../../docs/AGENT_AVATAR_PROMPTS.md)).

## Saving generated images

The image-gen MCP shows each generated image in the chat. To use them:

1. In the chat where the avatars were generated, save each image (e.g. right‑click → Save image as).
2. Name files by agent ID and put them here:

| Order | Agent ID | Suggested filename |
|-------|----------|---------------------|
| 1 | shared-agent-main-assistant | shared-agent-main-assistant.png |
| 2 | shared-agent-research | shared-agent-research.png |
| 3 | shared-agent-image-generation | shared-agent-image-generation.png |
| 4 | shared-agent-travel-location | shared-agent-travel-location.png |
| 5 | shared-agent-code-assistant | shared-agent-code-assistant.png |
| 6 | shared-agent-code-researcher | shared-agent-code-researcher.png |
| 7 | shared-agent-developer | shared-agent-developer.png |
| 8 | shared-agent-code-refactorer | shared-agent-code-refactorer.png |
| 9 | shared-agent-github | shared-agent-github.png |
| 10 | shared-agent-code-reviewer | shared-agent-code-reviewer.png |
| 10a | shared-agent-code-researcher-quality | shared-agent-code-researcher.png (reuse default) |
| 10b | shared-agent-developer-quality | shared-agent-developer.png (reuse default) |
| 10c | shared-agent-code-refactorer-quality | shared-agent-code-refactorer.png (reuse default) |
| 10d | shared-agent-code-reviewer-quality | shared-agent-code-reviewer.png (reuse default) |
| 11 | shared-agent-feedback | shared-agent-feedback.png |
| 12 | shared-agent-video-transcripts | shared-agent-video-transcripts.png |
| 13 | shared-agent-cooking | shared-agent-cooking.png |
| 14 | shared-agent-data-analysis | shared-agent-data-analysis.png |
| 15 | shared-agent-file-converter | shared-agent-file-converter.png |
| 16 | shared-agent-document-creator | shared-agent-document-creator.png |
| 17 | shared-agent-linux-expert | shared-agent-linux-expert.png |

### Linux Expert (shared-agent-linux-expert) — 3 avatar options

Three variants are provided; pick one and rename to `shared-agent-linux-expert.png`:

| Option | Filename | Style |
|--------|----------|-------|
| 1 | shared-agent-linux-expert-option1.png | Terminal/prompt symbol, slate background |
| 2 | shared-agent-linux-expert-option2.png | Penguin (Tux), teal background |
| 3 | shared-agent-linux-expert-option3.png | Shell/bash symbol, amber background |

3. In LibreChat: open each agent in the sidebar → Agent settings → upload the matching avatar image.

Avatars are stored per agent in the backend (DB); this folder is for your copies and version control if desired.
