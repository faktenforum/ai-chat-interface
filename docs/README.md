# Documentation

Essential guides for the AI Chat Interface platform.

## LibreChat configuration (project-defined)

The project’s LibreChat setup is defined in the **librechat-init** config; these files are the single source of truth:

| File | Purpose |
|------|---------|
| **[`packages/librechat-init/config/librechat.yaml`](../packages/librechat-init/config/librechat.yaml)** | LibreChat settings: endpoints, model specs, MCP servers, interface, memory, OCR, etc. |
| **[`packages/librechat-init/config/agents.yaml`](../packages/librechat-init/config/agents.yaml)** | Shared agents (universal Assistant + Faktencheck, Travel and Location, Image Generation) and their tools. |
| **[`packages/librechat-init/config/agent-instructions/_shared-conventions.md`](../packages/librechat-init/config/agent-instructions/_shared-conventions.md)** | Canonical snippets for agent instructions (maintainer reference; not loaded by agents). |
| **[`packages/librechat-init/config/roles.yaml`](../packages/librechat-init/config/roles.yaml)** | Roles and permissions (who can use which agents/features). |

They are baked into the init image and written into the config volume at startup. See [LibreChat Features](LIBRECHAT_FEATURES.md) for details.

## Getting Started

- **[Getting Started](GETTING_STARTED.md)** - Setup, deployment, and usage

## Core

- **[Goals](GOALS.md)** - Project principles and philosophy
- **[Services](SERVICES.md)** - Services and MCP services overview, network architecture
- **[Administration](ADMINISTRATION.md)** - User management and administration
- **[LibreChat Features](LIBRECHAT_FEATURES.md)** - LibreChat configuration and features
- **[Spend Monitor](SPEND_MONITOR.md)** - Read-only org cost dashboard (reads LibreChat MongoDB; in-platform status page)
- **[LibreChat group icons](LIBRECHAT_GROUP_ICONS.md)** - Model-spec group icons, colors, theme tips
- **[Agent avatar prompts](AGENT_AVATAR_PROMPTS.md)** - Image-gen MCP prompts for round minimalist agent avatars
- **[MCP YTPTube](MCP_YTPTUBE.md)** - YTPTube MCP (media URL → transcript or download). Status and [future work](wip/YTPTUBE_FUTURE_WORK.md) (production proxy, FlareSolverr).
- **[YTPTube Cleanup](YTPTUBE_CLEANUP.md)** - Where archive and downloads live; how to clean for fresh tests
- **[MCP Grounded Docs](MCP_DOCS.md)** - Grounded Docs MCP (documentation index; optional embeddings)
- **[Faktenforum Search](SERVICES.md)** - Optional external fact-check search (MCP), hosted as part of Faktenforum; opt-in via `SEARCH_MCP_URL`
- **[MCP Chefkoch](MCP_CHEFKOCH.md)** – Recipes from chefkoch.de (get_recipe, search_recipes, get_random_recipe, get_daily_recipes). Internal only.
- **[MCP Linux](MCP_LINUX.md)** – Per-user isolated Linux terminal with persistent git workspaces. Tools: execute_command, workspace management, account tools. Internal only.
- **[GitHub Machine User](GITHUB_MACHINE_USER.md)** – Shared GitHub identity for MCP Linux (SSH) and GitHub MCP (PAT).
- **[MCP Code Execution Insights](MCP_CODE_EXECUTION_INSIGHTS.md)** – Insights from Anthropic’s “Code execution with MCP” article applied to our Linux MCP server and agents.
- **[MCP Linux Data Analysis](MCP_LINUX_DATA_ANALYSIS.md)** – CSV/JSON analysis and chart generation (Data Analysis agent): workflow, example Python script, image return via read_workspace_file.
- **[Agent file upload guidance](AGENT_FILE_UPLOAD.md)** – LibreChat upload options (Upload to Provider, Upload as Text), MCP Linux upload/download, when to recommend which, workspace handoff.
- **[Webshare Proxy](WEBSHARE_PROXY.md)** - Fixed proxy URL setup (Rotating/Backbone) for mcp-ytptube

## Deployment

- **[Portainer Configuration](PORTAINER-CONFIG.md)** - Portainer deployment with GitOps
- **[SearXNG Engines](SEARXNG_ENGINES.md)** - SearXNG configuration

## Development

- **[Agents](DEVELOPER_AGENTS.md)** - Current agent roster (universal Assistant + 3 specialists) and the consolidation rationale
- **[Agent Workspaces](../workspaces/README.md)** - Persistent workspace repositories for agents
- **[Development Guide](DEVELOPMENT.md)** - Git submodules and development stack
- **[Running with Podman](PODMAN.md)** - Run the local stack under rootless Podman instead of Docker
- **[Testing internal MCPs from Cursor](SERVICES.md#testing-internal-mcps-from-cursor-ide)** - Use local-stack MCPs from Cursor IDE for testing
- **[LibreChat Testing](LIBRECHAT_TESTING.md)** - Running LibreChat unit and E2E tests using the dedicated test stack
- **[Submodule Sync Guide](SUBMODULE_SYNC.md)** - Syncing fork submodules with upstream
- **[Cursor Rules](CURSOR_RULES.md)** - Integrating services and MCP servers
- **[Cursor MongoDB MCP](CURSOR_MONGODB_MCP.md)** - Cursor MongoDB integration
- **[Agent Firecrawl Tools](AGENT_FIRECRAWL_TOOLS.md)** - Firecrawl MCP tool guide
- **[MCP Server Best Practices](MCP_SERVER_BEST_PRACTICES.md)** - Conventions for building, wiring, and testing MCP servers

## WIP (Work in Progress)

- **[WIP Documentation](wip/README.md)** - YTPTube production, vision architecture, agent token metadata. Vision re-enabled as **experimental/WIP** (merged into fork `main`); upstream re-attempts [agents #257](https://github.com/danny-avila/agents/pull/257), [LibreChat #13860](https://github.com/danny-avila/LibreChat/pull/13860)
- **[TODO](TODO.md)** - Current tasks and improvements
- **[PR: LibreChat testing](wip/PR-feat-librechat-testing.md)** - PR text draft for feat/librechat-testing

## Project

- **[MCP Servers to Test](MCP_SERVERS_TODO.md)** - MCP servers to evaluate (x-twitter, Context7, Wikipedia) for Social Networks, Developer Support, and Research Assistant agents
- **[Agent MCP Suggestions](AGENT_MCP_SUGGESTIONS.md)** - Which MCP servers suit which agents (see SERVICES.md and agents.yaml for the live setup)

## Links

- **Repository**: [GitHub](https://github.com/Faktenforum/ai-chat-interface)
- **Root README**: [../README.md](../README.md)
