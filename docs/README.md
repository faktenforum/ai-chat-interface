# Documentation

Essential guides for the AI Chat Interface platform.

## Getting Started

- **[Getting Started](GETTING_STARTED.md)** - Setup, deployment, and usage

## Core

- **[Goals](GOALS.md)** - Project principles and philosophy
- **[Services](SERVICES.md)** - Services and MCP services overview, network architecture
- **[Administration](ADMINISTRATION.md)** - User management and administration
- **[LibreChat Features](LIBRECHAT_FEATURES.md)** - LibreChat configuration and features
- **[MCP YTPTube](MCP_YTPTUBE.md)** - YTPTube MCP (video URL → transcript via Scaleway STT; extensible). [Verification (debug)](MCP_YTPTUBE_VERIFICATION.md) - URL normalization and Docker logs check.
- **[YTPTube Cleanup](YTPTUBE_CLEANUP.md)** - Where archive and downloads live; how to clean for fresh tests
- **[MCP YouTube Transcript](MCP_YOUTUBE_TRANSCRIPT.md)** - YouTube Transcript MCP (video URL → transcript via youtube-transcript-api)
- **[Webshare Proxy](WEBSHARE_PROXY.md)** - Fixed proxy URL setup (Rotating/Backbone) for mcp-ytptube and mcp-youtube-transcript

## Deployment

- **[Portainer Configuration](PORTAINER-CONFIG.md)** - Portainer deployment with GitOps
- **[SearXNG Engines](SEARXNG_ENGINES.md)** - SearXNG configuration
- **[n8n Setup Notes](N8N.md)** - n8n owner setup and configuration

## Development

- **[Development Guide](DEVELOPMENT.md)** - Git submodules and development stack
- **[Testing internal MCPs from Cursor](SERVICES.md#testing-internal-mcps-from-cursor-ide)** - Use local-stack MCPs from Cursor IDE for testing
- **[LibreChat Testing](LIBRECHAT_TESTING.md)** - Running LibreChat unit and E2E tests using the dedicated test stack
- **[PR: LibreChat testing](PR-feat-librechat-testing.md)** - PR text draft for feat/librechat-testing
- **[Submodule Sync Guide](SUBMODULE_SYNC.md)** - Syncing fork submodules with upstream
- **[Cursor Rules](CURSOR_RULES.md)** - Integrating services and MCP servers
- **[Cursor MongoDB MCP](CURSOR_MONGODB_MCP.md)** - Cursor MongoDB integration
- **[Agent Firecrawl Tools](AGENT_FIRECRAWL_TOOLS.md)** - Firecrawl MCP tool guide
- **[Refactor Summary](REFACTOR_SUMMARY.md)** - Vision capability refactoring for PR submission

## WIP (Work in Progress)

- **[WIP Documentation](wip/README.md)** - Vision architecture, vision design, debug status, agent token metadata (custom/Scaleway). Vision re-enabled as **experimental/WIP**; branch `feat/vision` in `dev/librechat` and `dev/agents`; draft PRs [LibreChat #11501](https://github.com/danny-avila/LibreChat/pull/11501), [agents #48](https://github.com/danny-avila/agents/pull/48)

## Project

- **[TODO](TODO.md)** - Current tasks and improvements
- **[MCP Servers to Test](MCP_SERVERS_TODO.md)** - MCP servers to evaluate (x-twitter, Context7, Wikipedia) for Social Networks, Developer Support, and Research Assistant agents

## Links

- **Repository**: [GitHub](https://github.com/Faktenforum/ai-chat-interface)
- **Root README**: [../README.md](../README.md)
