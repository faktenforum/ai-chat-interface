# LibreChat Init Services

Two initialization services for LibreChat:

## Services

### librechat-init
Runs before LibreChat API starts:
- LibreChat YAML configuration setup
- File permissions configuration
- MongoDB role initialization

### librechat-post-init
Runs after LibreChat API starts:
- Agent initialization from configuration (via API)

## Configuration

### Custom Roles

Edit `config/roles.json`:

```json
{
  "roles": [
    {
      "name": "DEVELOPER",
      "permissions": {
        "PROMPTS": { "SHARED_GLOBAL": true, "USE": true, "CREATE": true }
      }
    }
  ]
}
```

### Agents

Agents are defined in two files (both optional):

1. **`config/agents.json`** - Shared agents (committed to repository)
2. **`config/agents.private.json`** - Private agents (git-ignored, instance-specific)

**MCP Server Support:** Specify `mcpServers` to include MCP server tools. Optionally specify `mcpTools` to explicitly enable specific tools.

Example:

```json
{
  "agents": [
    {
      "name": "Research Assistant",
      "provider": "Scaleway",
      "model": "mistral-small-3.2-24b-instruct-2506",
      "tools": ["web_search", "file_search"],
      "mcpServers": ["firecrawl"],
      "mcpTools": ["firecrawl_search_mcp_firecrawl", "firecrawl_scrape_mcp_firecrawl"],
      "permissions": { "public": true }
    },
    {
      "name": "Image Generator",
      "provider": "OpenRouter",
      "model": "anthropic/claude-sonnet-4.5",
      "mcpServers": ["image-gen"],
      "permissions": { "public": true }
    }
  ]
}
```

**Key fields:**
- `provider`: Must match a configured endpoint name
- `model`: Model identifier for the provider
- `tools`: Array of non-MCP tool identifiers
- `mcpServers`: Array of MCP server names. If `mcpTools` is omitted, all tools from the server are loaded at runtime.
- `mcpTools`: Optional array of explicit MCP tool keys (format: `toolName_mcp_serverName`). If specified, only these tools are enabled.
- `permissions.owner`: Optional email for owner permissions (defaults to system user)
- `permissions.public`: If `true`, grants public VIEW access
- `permissions.publicEdit`: If `true` and `isCollaborative: true`, grants public EDIT access

**User Selection:** System user is selected in priority order:
1. First user from `LIBRECHAT_DEFAULT_ADMINS` env var
2. First admin user (`role: 'ADMIN'`)
3. First available user (for initial setup)

### Default Administrators

Set `LIBRECHAT_DEFAULT_ADMINS` environment variable (comma-separated emails):

```bash
LIBRECHAT_DEFAULT_ADMINS=admin@example.com,admin2@example.com
```

## Building

```bash
npm run build:docker
```

Or via Docker Compose:

```bash
docker compose -f docker-compose.librechat.yml build librechat-init
```

## Usage

Services run automatically as part of the Docker Compose stack.
