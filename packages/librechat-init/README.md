# LibreChat Init Service

Unified initialization service for LibreChat that handles:
1. LibreChat YAML configuration setup
2. File permissions configuration
3. MongoDB role initialization
4. Agent initialization from configuration

## Structure

```
librechat-init/
├── config/
│   ├── librechat.yaml         # LibreChat configuration file
│   ├── roles.json             # Custom roles definition
│   ├── agents.json            # Shared agents definition (in repository)
│   └── agents.private.json    # Private agents (not in repository, optional)
├── src/
│   ├── init.ts                # Main orchestrator
│   ├── setup-permissions.ts
│   ├── init-roles.ts
│   └── init-agents.ts
├── package.json
├── tsconfig.json
└── Dockerfile
```

## Configuration

### Custom Roles

Edit `config/roles.json` to add or modify custom roles:

```json
{
  "roles": [
    {
      "name": "DEVELOPER",
      "permissions": {
        "PROMPTS": { "SHARED_GLOBAL": true, "USE": true, "CREATE": true },
        ...
      }
    }
  ]
}
```

### Shared Agents

Agents can be defined in two files:

1. **`config/agents.json`** - Public agents that are committed to the repository and shared across all instances
2. **`config/agents.private.json`** - Private agents (optional, not in repository) for instance-specific configurations

Both files are loaded and merged during initialization. The `agents.private.json` file is automatically ignored by git (see `.gitignore`).

Basic structure for both files:

```json
{
  "agents": [
    {
      "id": "shared-agent-001",
      "name": "My Shared Agent",
      "description": "Agent description",
      "instructions": "System instructions for the agent",
      "provider": "Scaleway",
      "model": "mistral-small-3.2-24b-instruct-2506",
      "model_parameters": {
        "temperature": 0.3
      },
      "tools": ["web_search", "file_search"],
      "category": "general",
      "permissions": {
        "public": true,
        "publicEdit": false
      }
    }
  ]
}
```

**Key fields:**
- `id`: Optional unique identifier. If omitted, auto-generated as `agent_<nanoid>`
- `provider`: Must match a configured endpoint name (e.g., "Scaleway", "OpenRouter")
- `model`: Model identifier for the provider
- `permissions.owner`: Optional email of user to grant owner permissions. If not specified, uses the system user (see "User Selection" below)
- `permissions.public`: If `true`, grants public VIEW access
- `permissions.publicEdit`: If `true` and `isCollaborative: true`, grants public EDIT access

**User Selection:**

The system automatically selects a user to be the author of all agents. The selection follows this priority order:

1. **First priority**: User from `LIBRECHAT_DEFAULT_ADMINS` environment variable (comma-separated email addresses)
2. **Second priority**: First admin user found in the database (`role: 'ADMIN'`)
3. **Last resort**: First available user in the database (for initial setup)

This selected user becomes the `author` of all agents. Owner permissions are granted to:
- The user specified in `permissions.owner` (if provided), OR
- The system user (if `permissions.owner` is not specified)

Example: If `LIBRECHAT_DEFAULT_ADMINS=admin@example.com,admin2@example.com` is set, the system will use `admin@example.com` as the author (if that user exists in the database).

**Note:** 
- If an agent with the same `id` already exists, it will be updated with the new configuration
- Agents from both `agents.json` and `agents.private.json` are loaded and merged
- Use `agents.private.json` for instance-specific or sensitive agent configurations that should not be committed to the repository

### Default Administrators

Set `LIBRECHAT_DEFAULT_ADMINS` environment variable (comma-separated email addresses):

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

The service runs automatically as part of the Docker Compose stack. It executes before the LibreChat API service starts.
