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

**MCP Server Support:** Specify `mcpServers` array to automatically include all tools from MCP servers.

Example:

```json
{
  "agents": [
    {
      "name": "Research Assistant",
      "description": "Helps with research",
      "instructions": "System instructions",
      "provider": "Scaleway",
      "model": "mistral-small-3.2-24b-instruct-2506",
      "tools": ["web_search", "file_search"],
      "mcpServers": ["image-gen"],
      "permissions": {
        "public": true,
        "publicEdit": false
      }
    }
  ]
}
```

**Key fields:**
- `provider`: Must match a configured endpoint name
- `model`: Model identifier for the provider
- `tools`: Array of tool identifiers
- `mcpServers`: Array of MCP server names (all tools automatically added)
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
