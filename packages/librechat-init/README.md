# LibreChat Init Services

Two initialization services:

- **librechat-init**: Runs before API (config setup, permissions, roles)
- **librechat-post-init**: Runs after API (agent initialization)

## Configuration

### Roles (`config/roles.json`)

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

### Agents (`config/agents.json`, `config/agents.private.json`)

```json
{
  "agents": [
    {
      "name": "Research Assistant",
      "provider": "Scaleway",
      "model": "mistral-small-3.2-24b-instruct-2506",
      "tools": ["web_search", "file_search"],
      "mcpServers": ["firecrawl"],
      "mcpTools": ["firecrawl_search_mcp_firecrawl"],
      "permissions": { "public": true }
    }
  ]
}
```

**Fields:**
- `mcpServers`: MCP server names (all tools loaded if `mcpTools` omitted)
- `mcpTools`: Explicit tool keys (`toolName_mcp_serverName`)
- `permissions.owner`: Email (defaults to system user)
- `permissions.public`: Public VIEW access
- `permissions.publicEdit`: Public EDIT (requires `isCollaborative: true`)

**System user priority:** `LIBRECHAT_DEFAULT_ADMINS` → first admin → first user

### Default Administrators

```bash
LIBRECHAT_DEFAULT_ADMINS=admin@example.com,admin2@example.com
```
