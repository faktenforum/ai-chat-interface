# Development Guide

This guide explains how to work with the development stack and git submodules.

## Development vs Production Compose Files

The project uses two different Docker Compose configurations:

- **`docker-compose.yml`** - Uses published Docker images from Docker Hub/GHCR. Use this for production deployments or when you want to use stable, pre-built images.
- **`docker-compose.dev.yml`** - Builds images directly from git submodules in `/dev`. Use this for local development, debugging, and working on PRs for upstream projects.

## Git Submodules

The project includes several git submodules in the `/dev` directory:

- `dev/librechat` - Main LibreChat application
- `dev/agents` - npm package used by LibreChat
- `dev/rag_api` - RAG API service
- `dev/librechat-doc` - LibreChat documentation
- `dev/firecrawl` - Firecrawl web scraping service
- `dev/searxng` - SearXNG metasearch engine

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

## Development Stack

### Building and Starting

To use local builds from submodules:

```bash
docker compose -f docker-compose.dev.yml build
docker compose -f docker-compose.dev.yml up -d
```

This will:
- Build `librechat:local` from `dev/librechat`
- Build `rag_api:local` from `dev/rag_api`
- Use official `searxng/searxng:latest` image (same as production)
- Mount `dev/agents` as a volume in the LibreChat container

**Note:** The SearXNG code in `dev/searxng` is kept as reference only. We use the official Docker image for both development and production.

### Working on Upstream PRs

The development stack allows you to:
1. Make changes to submodule code in `/dev`
2. Test changes immediately by rebuilding and restarting services
3. Create PRs for upstream projects
4. Test upstream PRs by checking out the PR branch in the submodule

Example workflow for testing a LibreChat PR:

```bash
cd dev/librechat
git fetch origin pull/1234/head:pr-1234
git checkout pr-1234
cd ../..
docker compose -f docker-compose.dev.yml build api
docker compose -f docker-compose.dev.yml up -d api
```

## Switching Between Local and Published Images

- **Local builds**: Use `docker compose -f docker-compose.dev.yml`
- **Published images**: Use `docker compose -f docker-compose.yml`

The compose files are independent - you can run either stack, but not both simultaneously (they use the same container names).

## Additional Resources

- See `dev/README.md` for more detailed submodule setup instructions
- See [Getting Started](GETTING_STARTED.md) for initial project setup
- See [Services](SERVICES.md) for an overview of all services
