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
| shared-agent-main-assistant | Main Assistant | Playful round avatar, soft gradient background (e.g. soft blue to purple or warm amber). Centered cute sparkle or star with little rays, friendly and universal. Slightly whimsical, no text. |
| shared-agent-research | Research Assistant | Playful round avatar, soft teal or blue background. Cute magnifying glass over a document or lines, research theme. Friendly, colorful icon, no text. |
| shared-agent-image-generation | Image Generation Assistant | Playful round avatar, soft purple or magenta background. Cute image frame or palette with a small brush, creative and colorful. No text. |
| shared-agent-travel-location | Travel and Location Assistant | Playful round avatar, soft green or mint background. Friendly map pin or tiny map with a location dot, travel vibe. Colorful, no text. |
| shared-agent-code-assistant | Code Assistant | Playful round avatar, soft indigo or slate background. Cute branching arrows or router node, routing to specialists. Friendly geometric symbol, no text. |
| shared-agent-developer | Developer | Playful round avatar, soft blue or cyan background. Cute terminal window or code brackets symbol, dev vibe. Friendly and slightly playful, no text. |
| shared-agent-code-refactorer | Code Refactorer | Playful round avatar, soft violet background. Cute overlapping blocks or arrows for refactor, friendly geometric. No text. |
| shared-agent-github | GitHub Assistant | Playful round avatar, soft grey-blue or dark teal background. Cute branch or fork symbol (git), not the GitHub logo. Friendly, no text. |
| shared-agent-code-reviewer | Code Reviewer | Playful round avatar, soft green or emerald background. Cute checkmark in curly braces or magnifying glass over code. Friendly, no text. |
| shared-agent-feedback | Feedback Assistant | Playful round avatar, soft coral or rose background. Cute speech bubble with exclamation or small flag, feedback theme. Friendly, no text. |
| shared-agent-video-transcripts | Video Transcripts | Playful round avatar, soft red or coral background. Cute play button with two or three subtitle lines beside it. Friendly, no text. |
| shared-agent-cooking | Cooking Assistant | Playful round avatar, warm orange or warm yellow background. Cute cooking pot, chef's hat, or fork and spoon. Cozy, friendly, no text. |
| shared-agent-data-analysis | Data Analysis | Playful round avatar, soft blue or aqua background. Cute bar chart or line chart, friendly data vibe. Colorful, no text. |
| shared-agent-file-converter | File Converter | Playful round avatar, soft lime or green background. Cute two file shapes with arrow between them, conversion theme. Friendly, no text. |
| shared-agent-document-creator | Document Creator | Playful round avatar, soft paper-white or cream with blue accent. Cute document with pen or sheet with lines. Clean, friendly, no text. |
| shared-agent-linux-expert | Linux Expert | Playful round avatar, soft slate or grey-blue background. Cute terminal window or command prompt symbol (>_), friendly Linux vibe. No text. |

Quality variants (`shared-agent-developer-quality`, `shared-agent-code-refactorer-quality`, `shared-agent-code-reviewer-quality`) use the same prompt as their default counterpart (Developer, Code Refactorer, Code Reviewer); reuse the same image file for the avatar.

## Usage (Image-Gen MCP)

Example for one agent (Main Assistant):

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
