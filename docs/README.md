# Documentation

Essential guides for the AI Chat Interface platform.

## LibreChat configuration (project-defined)

The project’s LibreChat setup is defined in the **librechat-init** config; these files are the single source of truth:

| File | Purpose |
|------|---------|
| **[`packages/librechat-init/config/librechat.yaml`](../packages/librechat-init/config/librechat.yaml)** | LibreChat settings: endpoints, model specs, MCP servers, interface, memory, OCR, etc. |
| **[`packages/librechat-init/config/agents.yaml`](../packages/librechat-init/config/agents.yaml)** | Shared agents (Recherche, Bildgenerierung, Universal, Entwickler-Router, Feedback-Assistent, dev specialists) and their tools. |
| **[`packages/librechat-init/config/roles.yaml`](../packages/librechat-init/config/roles.yaml)** | Roles and permissions (who can use which agents/features). |

They are baked into the init image and written into the config volume at startup. See [LibreChat Features](LIBRECHAT_FEATURES.md) for details.

## Getting Started

- **[Getting Started](GETTING_STARTED.md)** - Setup, deployment, and usage

## Core

- **[Goals](GOALS.md)** - Project principles and philosophy
- **[Services](SERVICES.md)** - Services and MCP services overview, network architecture
- **[Administration](ADMINISTRATION.md)** - User management and administration
- **[LibreChat Features](LIBRECHAT_FEATURES.md)** - LibreChat configuration and features
- **[MCP YTPTube](MCP_YTPTUBE.md)** - YTPTube MCP (media URL → transcript or download). Status and [future work](wip/YTPTUBE_FUTURE_WORK.md) (production proxy, FlareSolverr).
- **[YTPTube Cleanup](YTPTUBE_CLEANUP.md)** - Where archive and downloads live; how to clean for fresh tests
- **[MCP YouTube Transcript](MCP_YOUTUBE_TRANSCRIPT.md)** - YouTube Transcript MCP (video URL → transcript via youtube-transcript-api)
- **[MCP Grounded Docs](MCP_DOCS.md)** - Grounded Docs MCP (documentation index; optional embeddings)
- **[MCP Chefkoch](MCP_CHEFKOCH.md)** – Recipes from chefkoch.de (get_recipe, search_recipes, get_random_recipe, get_daily_recipes). Internal only.
- **[MCP Linux](MCP_LINUX.md)** – Per-user isolated Linux terminal with persistent git workspaces. Tools: execute_command, workspace management, account tools. Internal only.
- **[GitHub Machine User](GITHUB_MACHINE_USER.md)** – Shared GitHub identity for MCP Linux (SSH) and GitHub MCP (PAT).
- **[MCP Code Execution Insights](MCP_CODE_EXECUTION_INSIGHTS.md)** – Insights from Anthropic’s “Code execution with MCP” article applied to our Linux MCP server and agents.
- **[MCP Linux Data Analysis](MCP_LINUX_DATA_ANALYSIS.md)** – CSV/JSON analysis and chart generation (Datenanalyse agent): workflow, example Python script, image return via read_workspace_file.
- **[Webshare Proxy](WEBSHARE_PROXY.md)** - Fixed proxy URL setup (Rotating/Backbone) for mcp-ytptube and mcp-youtube-transcript

## Deployment

- **[Portainer Configuration](PORTAINER-CONFIG.md)** - Portainer deployment with GitOps
- **[SearXNG Engines](SEARXNG_ENGINES.md)** - SearXNG configuration
- **[n8n Setup Notes](N8N.md)** - n8n owner setup and configuration

## Development

- **[Developer Agents](DEVELOPER_AGENTS.md)** - Developer domain: router, specialists, handoffs, code review (Code-Reviewer + GitHub-Assistent)
- **[Development Guide](DEVELOPMENT.md)** - Git submodules and development stack
- **[Testing internal MCPs from Cursor](SERVICES.md#testing-internal-mcps-from-cursor-ide)** - Use local-stack MCPs from Cursor IDE for testing
- **[LibreChat Testing](LIBRECHAT_TESTING.md)** - Running LibreChat unit and E2E tests using the dedicated test stack
- **[Submodule Sync Guide](SUBMODULE_SYNC.md)** - Syncing fork submodules with upstream
- **[Cursor Rules](CURSOR_RULES.md)** - Integrating services and MCP servers
- **[Cursor MongoDB MCP](CURSOR_MONGODB_MCP.md)** - Cursor MongoDB integration
- **[Agent Firecrawl Tools](AGENT_FIRECRAWL_TOOLS.md)** - Firecrawl MCP tool guide
## WIP (Work in Progress)

- **[WIP Documentation](wip/README.md)** - YTPTube production, vision architecture, agent token metadata. Vision re-enabled as **experimental/WIP** (`feat/vision`); draft PRs [LibreChat #11501](https://github.com/danny-avila/LibreChat/pull/11501), [agents #48](https://github.com/danny-avila/agents/pull/48)
- **[TODO](TODO.md)** - Current tasks and improvements
- **[PR: LibreChat testing](wip/PR-feat-librechat-testing.md)** - PR text draft for feat/librechat-testing

## Project

- **[MCP Servers to Test](MCP_SERVERS_TODO.md)** - MCP servers to evaluate (x-twitter, Context7, Wikipedia) for Social Networks, Developer Support, and Research Assistant agents

## Links

- **Repository**: [GitHub](https://github.com/Faktenforum/ai-chat-interface)
- **Root README**: [../README.md](../README.md)
