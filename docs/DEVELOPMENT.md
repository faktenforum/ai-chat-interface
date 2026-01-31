# Development Guide

This guide explains how to work with local source builds and git submodules.

## Local Development Builds

**`docker-compose.local-dev.yml`** builds images directly from git submodules in `/dev`. Use this for:
- Debugging services
- Testing PRs for upstream projects
- Contributing to upstream projects
- Custom modifications to services

**Note:** For standard local development with official images, use `docker-compose.local.yml` instead. For Portainer deployments, use `docker-compose.prod.yml` (production) or `docker-compose.dev.yml` (dev/test).

## Git Submodules

The project includes several git submodules in the `/dev` directory:

- `dev/librechat` - Main LibreChat application
- `dev/agents` - npm package used by LibreChat
- `dev/rag_api` - RAG API service
- `dev/librechat-doc` - LibreChat documentation
- `dev/firecrawl` - Firecrawl web scraping service
- `dev/searxng` - SearXNG metasearch engine
- `dev/mcp-youtube-transcript` - YouTube Transcript MCP server
- `dev/yt-dlp` - yt-dlp (reference only; used indirectly via YTPTube; we do not build from sources)

### Initializing Submodules

```bash
git submodule update --init --remote
```

This checks out the branches specified in `.gitmodules`.

### Building Agents Package

Since `agents` is an npm package used by LibreChat, build it before starting:

```bash
cd dev/agents
npm install
npm run build
cd ../..
```

### Updating Submodules

```bash
git submodule update --remote
```

## Setup

### Prerequisites

```bash
npm run prepare:dev  # Initialize submodules and build agents package
npm run setup        # Configure environment (.env.local)
```

### Building and Starting

**First time setup:**
```bash
npm run prepare:dev  # Initialize submodules and build agents package
npm run setup        # Configure environment (.env.local)
npm run build:local-dev  # Build Docker images from source
npm run start:local-dev  # Start services
```

**Subsequent starts (images already built):**
```bash
npm run start:local-dev
```

**Available npm scripts:**
- `npm run build:local-dev` - Build Docker images from source
- `npm run rebuild:local-dev` - Rebuild images without cache (use after code changes)
- `npm run start:local-dev` - Start services (preserves data)
- `npm run stop:local-dev` - Stop services (preserves data)
- `npm run restart:local-dev` - Restart services (preserves data)

**Manual commands:**
```bash
docker compose -f docker-compose.local-dev.yml --env-file .env.local build
docker compose -f docker-compose.local-dev.yml --env-file .env.local up -d
```

This will:
- Build `librechat:local` from `dev/librechat`
- Build `rag_api:local` from `dev/rag_api`
- Use official `searxng/searxng:latest` image (same as production)
- Mount `dev/agents` as a volume in the LibreChat container

**Note:** The SearXNG code in `dev/searxng` is kept as reference only. We use the official Docker image for both development and production.

## Working on Upstream PRs

Example workflow for testing a LibreChat PR:

```bash
cd dev/librechat
git fetch origin pull/1234/head:pr-1234
git checkout pr-1234
cd ../..
npm run build:local-dev api  # Build only the api service
npm run start:local-dev api   # Start only the api service
```

Or manually:
```bash
docker compose -f docker-compose.local-dev.yml --env-file .env.local build api
docker compose -f docker-compose.local-dev.yml --env-file .env.local up -d api
```

**After making code changes:**
```bash
npm run rebuild:local-dev <service-name>  # Rebuild without cache
npm run restart:local-dev <service-name>   # Restart the service
```

## Additional Resources

- See `dev/README.md` for more detailed submodule setup instructions
- See [Getting Started](GETTING_STARTED.md) for initial project setup
- See [Services](SERVICES.md) for an overview of all services
