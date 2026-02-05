# Cursor Rules for AI-Assisted Integration

This project uses [Cursor Rules](https://docs.cursor.com/features/rules) to enable AI agents to automatically integrate new services and MCP servers into the Docker stack.

## Overview

Cursor Rules are workspace-level instructions that guide AI agents. All rule files live in `.cursor/rules/`:

| Rule | Purpose |
|------|---------|
| `create-new-service.mdc` | Integrate new Docker services into the stack |
| `create-new-mcp.mdc` | Integrate new MCP servers (Docker) |
| `create-external-mcp.mdc` | Integrate external/remote MCP servers (no Docker) |
| `debug-test-internal-mcp.mdc` | Debug and test internal MCPs from Cursor IDE (editing `packages/mcp-*/**`) |
| `forked-submodules.mdc` | Work with Faktenforum fork submodules (upstream sync, PR workflow) |
| `build-deploy-fork-images.mdc` | Build and deploy Docker images from fork submodules (local build, Portainer registry image) |
| `docker-env.mdc` | Docker env and compose file structure |
| `environment-variables.mdc` | Environment variable guidelines for the stack |
| `documentation.mdc` | Documentation standards (minimal, scannable) |
| `general.mdc` | Language, submodules, code quality (always applied) |
| `typescript.mdc` | TypeScript conventions |

## Usage

### With Cursor AI Agent

1. Open Cursor and activate the Agent mode
2. Request integration: *"Add a new service called X"* or *"Integrate a new MCP server for Y"*
3. The AI agent will automatically reference the appropriate rule file and follow the checklist
4. Review and apply the generated changes

### Rule Files Location

All rules: `.cursor/rules/`. See the table in [Overview](#overview) for each file's purpose.

## What Gets Created

### New Service Integration
- Docker Compose configuration files
- Environment variable templates
- Traefik routing labels
- Setup script integration
- Documentation updates

### New MCP Server Integration
- NPM package structure
- Docker Compose configuration
- GitHub Actions workflow
- LibreChat configuration
- Icon assets and UI metadata

## Reference

- **Rules directory:** `.cursor/rules/`
- [Cursor Rules Documentation](https://docs.cursor.com/features/rules)
- [Cursor Agent Documentation](https://docs.cursor.com/chat/agent)
