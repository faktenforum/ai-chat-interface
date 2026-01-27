# Services Overview

This document provides an overview of all services in the AI Chat Interface stack, their availability, and access methods.

## Service Availability Matrix

| Service | Description | Local (via Traefik) | Production (via Traefik) | Internal Only |
|---------|-------------|---------------------|-------------------------|---------------|
| **LibreChat** | Main AI chat interface | ✅ `http://chat.localhost` | ✅ `https://chat.{DOMAIN}` | ❌ |
| **SearXNG** | Meta search engine for web search | ✅ `http://searxng.localhost` | ❌ Not exposed | ✅ Internal only |
| **Firecrawl API** | Web scraping service | ✅ `http://firecrawl.localhost` | ✅ `https://firecrawl.{DOMAIN}` | ❌ |
| **n8n** | Workflow automation platform | ✅ `http://n8n.localhost` | ✅ `https://n8n.{DOMAIN}` | ❌ |
| **MailDev** | Development mail server | ✅ `http://maildev.localhost` | ❌ Not in production | ❌ |
| **Traefik** | Reverse proxy and load balancer | ✅ `http://localhost:8080` (API) | External (separate container) | ❌ |
| **MongoDB** | LibreChat database | ❌ | ❌ | ✅ Internal only |
| **Meilisearch** | LibreChat search index | ❌ | ❌ | ✅ Internal only |
| **VectorDB** | RAG vector database (PostgreSQL + pgvector) | ❌ | ❌ | ✅ Internal only |
| **RAG API** | Retrieval-Augmented Generation API | ❌ | ❌ | ✅ Internal only |
| **n8n PostgreSQL** | n8n database | ❌ | ❌ | ✅ Internal only |
| **MCP Calculator** | MCP server providing calculator tools for LibreChat agents | ❌ | ❌ | ✅ Internal only |
| **MCP Image Generation** | MCP server providing image generation via OpenRouter API | ❌ | ❌ | ✅ Internal only |
| **MCP Firecrawl** | MCP server providing web scraping tools for LibreChat agents | ❌ | ❌ | ✅ Internal only |
| **MCP Weather** | MCP server providing weather, air quality, and timezone tools for LibreChat agents | ❌ | ❌ | ✅ Internal only |
| **Firecrawl Services** | Internal Firecrawl dependencies | ❌ | ❌ | ✅ Internal only |
| - playwright-service | Browser automation | ❌ | ❌ | ✅ Internal only |
| - redis | Firecrawl cache/queue | ❌ | ❌ | ✅ Internal only |
| - nuq-postgres | Firecrawl database | ❌ | ❌ | ✅ Internal only |
| - rabbitmq | Firecrawl message queue | ❌ | ❌ | ✅ Internal only |

## Service Details

### External Services (Exposed via Traefik)

#### LibreChat
- **Local**: `http://chat.localhost`
- **Production**: `https://chat.{DOMAIN}`
- **Purpose**: Main AI chat interface with support for multiple AI models
- **Network**: `traefik-net` + `app-net`
- **Internal Dependencies**: MongoDB, Meilisearch, RAG API, SearXNG, Firecrawl

#### SearXNG
- **Local**: `http://searxng.localhost` ✅
- **Production**: ❌ **Not exposed externally** (internal only)
- **Purpose**: Meta search engine for web search functionality in LibreChat
- **Network**: `traefik-net` (local) + `app-net`, only `app-net` (production)
- **Note**: Bot detection is disabled as it's only used internally

#### Firecrawl API
- **Local**: `http://firecrawl.localhost`
- **Production**: `https://firecrawl.{DOMAIN}`
- **Purpose**: Web scraping and content extraction service
- **Network**: `traefik-net` + `firecrawl-network` + `app-net`
- **Internal Dependencies**: playwright-service, redis, nuq-postgres, rabbitmq

#### n8n
- **Local**: `http://n8n.localhost`
- **Production**: `https://n8n.{DOMAIN}`
- **Purpose**: Workflow automation platform
- **Network**: `traefik-net` + `app-net`
- **Internal Dependencies**: n8n PostgreSQL, n8n-init (init container)
- **Init Container**: `n8n-init` automatically creates owner account via API if credentials are provided

#### MailDev
- **Local**: `http://maildev.localhost`
- **Production**: ❌ Not in production stack
- **Purpose**: Development mail server for testing email functionality
- **Network**: `traefik-net`
- **Note**: Only available in local development environment

### Internal Services (Not Exposed)

#### MongoDB
- **Purpose**: LibreChat's primary database
- **Network**: `app-net` only
- **Access**: Only accessible from LibreChat API

#### Meilisearch
- **Purpose**: Search index for LibreChat conversations and messages
- **Network**: `app-net` only
- **Access**: Only accessible from LibreChat API

#### VectorDB (PostgreSQL + pgvector)
- **Purpose**: Vector database for RAG (Retrieval-Augmented Generation)
- **Network**: `app-net` only
- **Access**: Only accessible from RAG API

#### RAG API
- **Purpose**: Retrieval-Augmented Generation service for document search
- **Network**: `app-net` only
- **Access**: Only accessible from LibreChat API

#### n8n PostgreSQL
- **Purpose**: n8n's database for storing workflows, credentials, and execution history
- **Network**: `app-net` only
- **Access**: Only accessible from n8n service

#### n8n-init
- **Purpose**: Init container that creates n8n owner account via API
- **Network**: `app-net` only
- **Behavior**: Waits for n8n readiness, then calls `/rest/owner/setup` API if credentials are provided

#### MCP Calculator
- **Purpose**: MCP server providing calculator tools for LibreChat agents
- **Network**: `app-net` only
- **Access**: Only accessible from LibreChat API

#### MCP Image Generation
- **Purpose**: MCP server providing image generation capabilities via OpenRouter API for LibreChat agents
- **Network**: `app-net` only
- **Access**: Only accessible from LibreChat API
- **Tools**: 
  - `generate_image`: Generate images from text descriptions
  - `list_known_models`: List curated models with characteristics
  - `list_available_models`: Query OpenRouter for all available image models
  - `check_model`: Verify if a model supports image generation
- **Models**: Supports FLUX.2 Pro, FLUX.2 Flex, Gemini Image Generation, and other OpenRouter-compatible models

#### MCP Firecrawl
- **Purpose**: MCP server providing web scraping and content extraction tools for LibreChat agents
- **Network**: `app-net` only
- **Backend**: Connects to internal Firecrawl API service (`firecrawl-api:3002`)
- **Tools**: `firecrawl_scrape`, `firecrawl_batch_scrape`, `firecrawl_map`, `firecrawl_crawl`, `firecrawl_search`, `firecrawl_extract`
- **Image**: `ghcr.io/firecrawl/firecrawl-mcp-server:latest`

#### MCP Weather
- **Purpose**: MCP server providing weather, air quality, and timezone tools for LibreChat agents
- **Network**: `app-net` only
- **Access**: Only accessible from LibreChat API
- **Tools**: 
  - Weather: `get_current_weather`, `get_weather_by_datetime_range`, `get_weather_details`
  - Air Quality: `get_air_quality`, `get_air_quality_details`
  - Timezone: `get_current_datetime`, `get_timezone_info`, `convert_time`
- **Image**: `dog830228/mcp_weather_server:latest`
- **API**: Free Open-Meteo API (no API key required)

#### Firecrawl Internal Services
- **playwright-service**: Browser automation for web scraping
- **redis**: Cache and queue management
- **nuq-postgres**: Firecrawl's database
- **rabbitmq**: Message queue for Firecrawl workers
- **Network**: `firecrawl-network` only (except firecrawl-api which also has `traefik-net` and `app-net`)

## Network Architecture

### Networks

1. **`traefik-net`** (Local: bridge, Production: external `loadbalancer-net`)
   - Services that need external HTTP/HTTPS access
   - LibreChat, SearXNG (local only), Firecrawl API, n8n, MailDev (local only)

2. **`app-net`** (Bridge network)
   - LibreChat ecosystem internal communication
   - LibreChat, MongoDB, Meilisearch, VectorDB, RAG API, SearXNG, Firecrawl API, n8n, n8n-init, n8n PostgreSQL, MCP Calculator, MCP Image Generation, MCP Firecrawl, MCP Weather

3. **`firecrawl-network`** (Bridge network)
   - Firecrawl internal services only
   - firecrawl-api, playwright-service, redis, nuq-postgres, rabbitmq

## Security Notes

- **SearXNG**: Not exposed in production to reduce attack surface. Bot detection is disabled as it's only used internally.
- **Internal Services**: MongoDB, Meilisearch, and other internal services are not exposed externally for security.
- **Production**: Uses external Traefik container with SSL/TLS certificates via Let's Encrypt.
- **Local**: Traefik runs in the stack with HTTP only (no SSL).

## Access Patterns

### Local Development
- All services accessible via `http://{service}.localhost`
- Traefik dashboard: `http://localhost:8080`
- Direct container access via service names on shared networks

### Production
- External services: `https://{service}.{DOMAIN}`
- Internal services: Accessible only via service names on `app-net` or `firecrawl-network`
- SearXNG: Only accessible internally (not exposed via Traefik)
