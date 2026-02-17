# Agent avatars

Round, playful avatars for LibreChat shared agents. Generated via image-gen MCP (see [docs/AGENT_AVATAR_PROMPTS.md](../../../docs/AGENT_AVATAR_PROMPTS.md)).

## Saving generated images

The image-gen MCP shows each generated image in the chat. To use them:

1. In the chat where the avatars were generated, save each image (e.g. right‑click → Save image as).
2. Name files by agent ID and put them here:

| Order | Agent ID | Suggested filename |
|-------|----------|---------------------|
| 1 | shared-agent-011 | shared-agent-011-universal.png |
| 2 | shared-agent-001 | shared-agent-001-recherche.png |
| 3 | shared-agent-002 | shared-agent-002-bildgenerierung.png |
| 4 | shared-agent-003 | shared-agent-003-reise-standort.png |
| 5 | shared-agent-developer-router | shared-agent-developer-router.png |
| 6 | shared-agent-code-researcher | shared-agent-code-researcher.png |
| 7 | shared-agent-developer | shared-agent-developer.png |
| 8 | shared-agent-code-refactorer | shared-agent-code-refactorer.png |
| 9 | shared-agent-github | shared-agent-github.png |
| 10 | shared-agent-code-reviewer | shared-agent-code-reviewer.png |
| 11 | shared-agent-feedback | shared-agent-feedback.png |
| 12 | shared-agent-005 | shared-agent-005-video-transkripte.png |
| 13 | shared-agent-006 | shared-agent-006-kochhilfe.png |
| 14 | shared-agent-008 | shared-agent-008-datenanalyse.png |
| 15 | shared-agent-009 | shared-agent-009-dateikonverter.png |
| 16 | shared-agent-010 | shared-agent-010-dokumenten-ersteller.png |
| 17 | shared-agent-linux-maintenance | shared-agent-linux-maintenance.png |

### Linux-Experte (shared-agent-linux-maintenance) — 3 avatar options

Three variants are provided; pick one and rename to `shared-agent-linux-maintenance.png`:

| Option | Filename | Style |
|--------|----------|-------|
| 1 | shared-agent-linux-maintenance-option1.png | Terminal/prompt symbol, slate background |
| 2 | shared-agent-linux-maintenance-option2.png | Penguin (Tux), teal background |
| 3 | shared-agent-linux-maintenance-option3.png | Shell/bash symbol, amber background |

3. In LibreChat: open each agent in the sidebar → Agent settings → upload the matching avatar image.

Avatars are stored per agent in the backend (DB); this folder is for your copies and version control if desired.
