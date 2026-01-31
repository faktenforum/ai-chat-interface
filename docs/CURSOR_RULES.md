# Cursor Rules for AI-Assisted Integration

This project uses [Cursor Rules](https://docs.cursor.com/features/rules) to enable AI agents to automatically integrate new services and MCP servers into the Docker stack.

## Overview

Cursor Rules are workspace-level instructions that guide AI agents through complex integration tasks. Specialized rules include:

- **`create-new-service`** - Integration guide for new Docker services
- **`create-new-mcp`** - Integration guide for new MCP (Model Context Protocol) servers
- **`debug-test-internal-mcp`** - Debug and test internal (self-hosted) MCP servers; IDE as test client, Docker logs, reload after changes (applies when editing `packages/mcp-*/**`)

## Usage

### With Cursor AI Agent

1. Open Cursor and activate the Agent mode
2. Request integration: *"Add a new service called X"* or *"Integrate a new MCP server for Y"*
3. The AI agent will automatically reference the appropriate rule file and follow the checklist
4. Review and apply the generated changes

### Rule Files Location

- `.cursor/rules/create-new-service.mdc` - Service integration checklist
- `.cursor/rules/create-new-mcp.mdc` - MCP server integration checklist
- `.cursor/rules/debug-test-internal-mcp.mdc` - Debug and test internal MCP servers

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

- [Cursor Rules Documentation](https://docs.cursor.com/features/rules)
- [Cursor Agent Documentation](https://docs.cursor.com/chat/agent)
