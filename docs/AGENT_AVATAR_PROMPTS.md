# Agent Avatar Prompts (Image-Gen MCP)

Prompts for generating round agent avatars for LibreChat. Style: playful and friendly, with soft colors and a clear symbol per agent. Use with the image-gen MCP tool (e.g. `black-forest-labs/flux.2-pro`). Output is square; LibreChat displays it `rounded-full`.

## Design constraints (use in every prompt)

- Round avatar: icon inside a perfect circle; final image square with the circle filling the frame.
- Colored: soft background (e.g. muted blue, green, amber, purple, teal) or gentle gradient; icon in white or a contrasting accent. Avoid harsh neon; keep it readable in dark UI.
- Playful: friendly, slightly whimsical icon; not corporate-stiff. Simple shapes, one clear symbol per agent.
- No text, no logos, no photorealism.

## Prompts by agent

| Agent ID | Name | Prompt (EN) |
|----------|------|-------------|
| shared-agent-assistant | Assistant | Playful round avatar, soft gradient background (e.g. soft blue to purple or warm amber). Centered cute sparkle or star with little rays, friendly and universal. Slightly whimsical, no text. |
| shared-agent-faktencheck | Faktencheck Assistant | Playful round avatar, soft blue or slate background. Cute magnifying glass over a document with a small checkmark, fact-checking theme. Friendly, colorful icon, no text. |
| shared-agent-travel-location | Travel and Location Assistant | Playful round avatar, soft green or mint background. Friendly map pin or tiny map with a location dot, travel vibe. Colorful, no text. |
| shared-agent-image-generation | Image Generation Assistant | Playful round avatar, soft purple or magenta background. Cute image frame or palette with a small brush, creative and colorful. No text. |

## Usage (Image-Gen MCP)

Example for one agent (Assistant):

```
Prompt: Playful round avatar, soft gradient background (e.g. soft blue to purple or warm amber). Centered cute sparkle or star with little rays, friendly and universal. Slightly whimsical, no text.
Model: black-forest-labs/flux.2-pro
Aspect ratio: 1:1 (square; LibreChat crops to circle).
```

After generation, save the image from the chat (e.g. right‑click → Save image as) into `packages/librechat-init/assets/agent-avatars/` using the filename from that folder’s README, then assign it in LibreChat (Agent settings → Avatar upload).

## Optional: consistent style prefix

For a cohesive set, prepend this and then add the agent-specific line:

**Style prefix:**  
`Playful app icon, round avatar, soft colored or gently gradient circular background, cute friendly symbol in white or accent color, slightly whimsical, no text, centered.`

Then add the agent-specific symbol and color hint (e.g. "soft teal background, magnifying glass over document").
