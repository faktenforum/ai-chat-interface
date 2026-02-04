# LibreChat Init Services

Initialization services for LibreChat configuration and agent setup.

## Services

- **librechat-init**: Pre-API initialization (config, permissions, roles)
- **librechat-post-init**: Post-API initialization (agents)

## Configuration

Config files are YAML by default; if a `.yaml` file is missing, the loader tries the same path with `.json` (backward compatibility).

### Local dev: mount config (no image rebuild)

When the host directory `config/` is mounted at `/app/config-source` (e.g. in `docker-compose.local-dev.yml` and `docker-compose.local.yml`), the init script reads from that path instead of the baked-in `/app/data`. After editing `librechat.yaml`, `roles.yaml`, or `agents.yaml`, run init again and restart the API; no image rebuild needed.

```bash
docker compose -f docker-compose.local-dev.yml run --rm librechat-init
docker compose -f docker-compose.local-dev.yml restart api
```

### Roles (`config/roles.yaml`)

```yaml
roles:
  - name: DEVELOPER
    permissions:
      PROMPTS:
        SHARED_GLOBAL: true
        USE: true
        CREATE: true
```

### Agents

**Files:** `config/agents.yaml` (public), `config/agents.private.yaml` (private)

```yaml
agents:
  - name: Research Assistant
    provider: Scaleway
    model: mistral-small-3.2-24b-instruct-2506
    tools:
      - web_search
      - file_search
    mcpServers:
      - firecrawl
    mcpTools:
      - firecrawl_search_mcp_firecrawl
    permissions:
      public: true
```

**MCP Configuration:**
- `mcpServers`: Server names (all tools loaded if `mcpTools` omitted)
- `mcpTools`: Explicit tool keys (`toolName_mcp_serverName`)

**Permissions:**
- `permissions.owner`: Email (defaults to system user)
- `permissions.public`: Public VIEW access
- `permissions.publicEdit`: Public EDIT (requires `isCollaborative: true`)

**System User Priority:** `LIBRECHAT_DEFAULT_ADMINS` → first admin → first user

### Environment Variables

```bash
LIBRECHAT_DEFAULT_ADMINS=admin@example.com,admin2@example.com
LIBRECHAT_API_URL=http://api:3080
LIBRECHAT_JWT_SECRET=your-secret-key
```
