# Agents

The chat interface runs one universal **Assistant** plus three specialists. This replaced the former
developer/workspace stack (a Code Assistant router with Developer, Code Refactorer, GitHub, Code
Reviewer, plus workspace specialists and quality variants). Better models (GLM-5.2) made the router,
handoff chain, quality-variant split, and per-workspace plan/task state unnecessary. See
`.plan/simplify-ai-chat-interface/plan.md` for the full rationale and the remaining phases.

## Roster

| Agent | ID | Provider / Model | Distinct backend / tools |
|-------|----|------------------|--------------------------|
| Assistant (default) | `shared-agent-assistant` | Scaleway / glm-5.2 (text/code, no vision) | linux, github (read+write), docs, stackoverflow, npm-search, wikipedia, web_search, file_search |
| Faktencheck | `shared-agent-faktencheck` | Scaleway / mistral-small-3.2 | checkbot-rag `search` MCP (still `public: false`) |
| Travel and Location | `shared-agent-travel-location` | Scaleway / qwen3-235b | mapbox, openstreetmap, weather, db-timetable |
| Image Generation | `shared-agent-image-generation` | Scaleway / mistral-small-3.2 | image-gen MCP |

The Assistant does coding, Linux/shell, data analysis, document creation, file conversion, research
and GitHub itself. It hands off (one hop) only for a clearly different domain: fact-checking, travel,
or image generation. Each specialist returns to the Assistant.

## Recursion limit (Max Agent Steps)

One limit applies to the whole run, taken from the agent the user started with. Each step is one LLM
call, tool call, or handoff. The Assistant uses 150 so long coding/GitHub sessions complete;
specialists use 25-40.

## Guiding principle

An agent exists as a separate entity only when it differs by tool access or backend, not by skill
level or domain prose. Skill and domain differences live in the Assistant's instructions and the
per-project workspace, not in separate agents.
