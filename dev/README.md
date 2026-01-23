# Development Submodules

Git submodules for local development and testing PRs.

## Submodules

This project includes the following git submodules:

- **dev/librechat** - Main LibreChat application
- **dev/agents** - npm package used by LibreChat
- **dev/rag_api** - RAG API service
- **dev/librechat-doc** - LibreChat documentation
- **dev/firecrawl** - Firecrawl web scraping service
- **dev/searxng** - SearXNG metasearch engine (reference only - uses official Docker image)
- **dev/n8n** - n8n workflow automation platform
- **dev/open-streetmap-mcp** - OpenStreetMap MCP server (fork with HTTP transport support)
- **dev/db-timetable-mcp** - Deutsche Bahn Timetable MCP server
- **dev/stackoverflow-mcp** - Stack Overflow MCP server
- **dev/npm-search-mcp** - npm Search MCP server (fork with HTTP transport support)

## Documentation

- [SearXNG Engines Configuration](../docs/SEARXNG_ENGINES.md) - Overview of enabled search engines and features

## Setup

### Quick Setup (Recommended)

Use the preparation script to set up all development submodules:

```bash
npm run prepare:dev
```

This will:
1. Initialize and update git submodules
2. Build the agents npm package

**Note:** SearXNG uses the official Docker image (`searxng/searxng:latest`). The code in `dev/searxng` is kept as reference only.

### Manual Setup

If you prefer to set up manually:

**1. Initialize Submodules**

```bash
git submodule update --init --remote
```

This checks out the branches specified in `.gitmodules`.

**2. Build Agents Package**

Since `agents` is an npm package used by LibreChat, build it before starting:

```bash
cd dev/agents
npm install
npm run build
cd ../..
```

**Note:** SearXNG uses the official Docker image, no build required.

### 2. Build and Start

**Using npm scripts (recommended):**
```bash
npm run setup
npm run start:local-source
```

**Or manually:**
```bash
docker compose -f docker-compose.local-source.yml --env-file .env.local build
docker compose -f docker-compose.local-source.yml --env-file .env.local up -d
```

This builds images from submodules and starts all services.

## Update Submodules

```bash
git submodule update --remote
```

After updating, rebuild affected services:
```bash
docker compose -f docker-compose.local-source.yml --env-file .env.local build <service-name>
docker compose -f docker-compose.local-source.yml --env-file .env.local up -d <service-name>
```
