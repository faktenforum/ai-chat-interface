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

To use local builds from submodules, include the override file:

```bash
docker compose -f docker-compose.librechat.yml -f docker-compose.librechat.dev.yml build
docker compose -f docker-compose.librechat.yml -f docker-compose.librechat.dev.yml up -d
```

Alternatively, use the development compose file which includes all services:

```bash
docker compose -f docker-compose.dev.yml build
docker compose -f docker-compose.dev.yml up -d
```

To use published images, omit the override file:

```bash
docker compose -f docker-compose.librechat.yml build
docker compose -f docker-compose.librechat.yml up -d
```

## Update Submodules

```bash
git submodule update --remote
```

## Switch Between Local and Published Images

Since the override file is not automatically loaded, simply include or omit it in your commands:

- **Local builds**: Include `-f docker-compose.librechat.dev.yml` or use `-f docker-compose.dev.yml`
- **Published images**: Omit the override file flag
