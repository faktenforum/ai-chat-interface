# Development Submodules

Git submodules for local development and testing PRs.

## Setup

### 1. Initialize Submodules

```bash
git submodule update --init --remote
```

This checks out the branches specified in `.gitmodules`.

### 1.1. Build Agents Package

Since `agents` is an npm package used by LibreChat, build it before starting:

```bash
cd dev/agents
npm install
npm run build
cd ../..
```

### 2. Build and Start

To use local builds from submodules, include the override file:

```bash
docker compose -f docker-compose.librechat.yml -f docker-compose.librechat.override.yml build
docker compose -f docker-compose.librechat.yml -f docker-compose.librechat.override.yml up -d
```

To use published images, omit the override file:

```bash
docker compose -f docker-compose.librechat.yml build
docker compose -f docker-compose.librechat.yml up -d
```

## Testing the Reranker

```bash
curl -s http://localhost:8000/rerank \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "query": "I love you",
    "docs": ["I hate you", "I really like you"],
    "k": 5
  }'
```

## Update Submodules

```bash
git submodule update --remote
```

## Switch Between Local and Published Images

Since the override file is not automatically loaded, simply include or omit it in your commands:

- **Local builds**: Include `-f docker-compose.librechat.override.yml`
- **Published images**: Omit the override file flag
