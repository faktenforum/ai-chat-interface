# AI Chat Interface

A complete, standalone open-source AI chat interface platform built with LibreChat and Firecrawl. This turnkey solution provides a fully functional AI chat interface with pre-configured services, ready for deployment.

## Overview

This project is a modular Docker Compose setup that combines multiple open-source AI tools into a cohesive platform:

- **LibreChat** - Main AI chat interface with support for multiple AI models
- **Firecrawl** - Web scraping and content extraction service
- **Traefik** - Reverse proxy and load balancer
- **RAG API** - Retrieval-Augmented Generation for document search
- **SearXNG** - Meta search engine for web search functionality

## Philosophy

This project is designed as a **complete, standalone open-source solution** that prioritizes:

- **Open Source First** - All features work with open-source models and tools by default
- **Feature Completeness** - Full feature parity with LibreChat and beyond
- **Ease of Use** - Intuitive and accessible to non-technical users
- **Turnkey Deployment** - Pre-configured services ready to use out of the box
- **Community Contribution** - Bug fixes and improvements contributed upstream

The platform balances open-source preference with quality, ensuring results that don't lag behind popular commercial platforms while remaining enjoyable to use.

## Quick Start

For detailed setup and deployment instructions, see the [Documentation](docs/README.md).

**Quick setup for local development:**
```bash
npm run setup
docker compose -f docker-compose.local.yml --env-file .env.local up -d
```

**Full reset (cleanup and restart):**
```bash
npm run setup:yes && docker compose -f docker-compose.local.yml down -v && sleep 3 && docker compose -f docker-compose.local.yml --env-file .env.local up -d
```

**Production deployment:**
```bash
npm run setup:prod
docker compose --env-file .env.prod -f docker-compose.yml up -d
```

**Test environment deployment (Portainer):**
```bash
npm run setup:dev
# Deploy via Portainer using docker-compose.yml and .env.dev contents
```

## Documentation

Comprehensive documentation is available in the [`docs/`](docs/) directory:

- **[Getting Started](docs/GETTING_STARTED.md)** - Complete setup and deployment guide
- **[Goals](docs/GOALS.md)** - Project principles and philosophy
- **[Services](docs/SERVICES.md)** - Service overview and architecture
- **[Administration](docs/ADMINISTRATION.md)** - Administration tools and user management
- **[LibreChat Features](docs/LIBRECHAT_FEATURES.md)** - Feature documentation

## Features

- 🚀 **Multiple Deployment Modes** - Standard, development, and production configurations
- 🔒 **Security Hardened** - Production-ready with SSL/TLS and security best practices
- 🔧 **Fully Configurable** - Interactive setup scripts for easy configuration
- 📦 **Modular Architecture** - Services can be enabled/disabled as needed
- 🌐 **Reverse Proxy** - Traefik integration for easy domain management
- 📧 **Email Testing** - Built-in MailDev for local development
- 🔍 **RAG Support** - Document search and retrieval-augmented generation
- 🌍 **Web Search** - Integrated SearXNG for web search capabilities

## License

See [LICENSE](LICENSE) for details.
