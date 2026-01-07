# AI Chat Interface

Modular Docker Compose setup for LibreChat, Open WebUI, and Firecrawl with Traefik as reverse proxy.

## Setup

### Local Development

1. **Network**: Create the shared proxy network:
   ```bash
   docker network create traefik-net
   ```

2. **Environment Configuration**
   ```bash
   npm run setup
   ```
   This interactive script will configure:
   - Domain settings
   - Database credentials (MongoDB, PostgreSQL)
   - API keys (OpenRouter, Jina)
   - RabbitMQ credentials (for Firecrawl stability)
   - Registration settings (enabled by default for local development)
   - Email verification (enabled by default, uses MailDev for local testing)

### Production Deployment

1. **Production Environment Configuration**
   ```bash
   npm run setup:prod
   ```
   This generates `.env.prod` with production-specific settings:
   - **Registration enabled** but restricted to allowed email domains (`@correctiv.org`, `@faktenforum.org`)
   - **SendGrid SMTP** for email verification
   - Production-optimized defaults from `env.prod.example`

## Services

Run services using their feature-grouped compose files:

| Feature | Commands | Access (Local) |
| :--- | :--- | :--- |
| **Proxy** | `docker compose -f docker-compose.traefik.yml up -d` | `http://localhost:8080` (Dashboard) |
| **LibreChat** | `docker compose -f docker-compose.librechat.yml up -d` | `http://chat.localhost` |
| **WebUI** | `docker compose -f docker-compose.openwebui.yml up -d` | `http://webui.localhost` |
| **WebSearch** | `docker compose -f docker-compose.websearch.yml up -d` | `http://searxng.localhost`, `http://firecrawl.localhost` |
| **RAG** | `docker compose -f docker-compose.rag.yml up -d` | *Internal* |
| **MailDev** | Included in `docker-compose.yml` / `docker-compose.dev.yml` | `http://maildev.localhost` (Web UI) |

## Usage

Select the stack you want to run:

### Modes

#### Standard (Official Images)
Uses official hub images.
```bash
docker compose up -d
```

#### Development (Local Builds)
Builds LibreChat and RAG components from local source.
```bash
docker compose -f docker-compose.dev.yml up -d
```

#### Production (Stable Release + SSL)
Enables Let's Encrypt SSL and security hardening.
```bash
docker compose -f docker-compose.prod.yml up -d
```

### Deployment (Portainer)

1. **Generate Template**: Create a flattened, secure template for Portainer:
   ```bash
   npm run generate:portainer
   ```

2. **Generate Environment**: (Optional) Generate a specific environment file for Portainer's "Advanced mode":
   ```bash
   npm run setup:portainer
   ```
   This creates `docker-compose.portainer.env` without affecting your local `.env`.

3. **Deploy**: Point Portainer to `docker-compose.portainer.yml` (Git or Web Editor) and paste the contents of the generated environment file into the **Environment variables** (Advanced mode) section.

### Advanced Usage

You can still use standard `docker compose` commands with the feature-grouped files:

```bash
# Start only the proxy and LibreChat
docker compose -f docker-compose.traefik.yml -f docker-compose.librechat.yml up -d
```

## Local Development Tools

### MailDev (Email Testing)
MailDev is automatically included in local development setups. It captures all outgoing emails for testing:
- **Web UI**: `http://maildev.localhost` (or `http://localhost:1080`)
- **SMTP**: `maildev:1025` (internal Docker network)
- Email verification is enabled by default (`LIBRECHAT_ALLOW_UNVERIFIED_EMAIL_LOGIN=false`)
- All emails sent by LibreChat can be viewed in the MailDev web interface

### Firecrawl Admin
`http://firecrawl.localhost/admin/<BULL_AUTH_KEY>/queues`
(Set `FIRECRAWL_BULL_AUTH_KEY` in `.env`)

## TODO

- Replace Jina reranker with RAG API reranker once LibreChat PR [#10574](https://github.com/danny-avila/LibreChat/pull/10574) is merged (adds `rerankerType: "simple"` support)

