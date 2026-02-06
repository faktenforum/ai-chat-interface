# MCP Chefkoch

Recipes from [chefkoch.de](https://www.chefkoch.de). Self-written MCP server (Pattern 1); no API key.

| Item | Value |
|------|--------|
| **URL** | `http://mcp-chefkoch:3014/mcp` |
| **Network** | `app-net` only (no Traefik) |
| **Env** | `MCP_CHEFKOCH_PORT` (3014), `MCP_CHEFKOCH_LOG_LEVEL` |
| **Package** | [`packages/mcp-chefkoch/`](../packages/mcp-chefkoch/) |

## Tools

- `get_recipe` – Single recipe by URL or ID (title, ingredients, instructions, times, difficulty, servings, rating).
- `search_recipes` – Search with filters (prep time, rating, category, diet, cuisine, sort).
- `get_random_recipe` – One random recipe.
- `get_daily_recipes` – Today’s suggestions (`kochen` or `backen`).

## Agent

Assigned to **Kochhilfe** in `packages/librechat-init/config/agents.yaml`.

## Development

See [packages/mcp-chefkoch/README.md](../packages/mcp-chefkoch/README.md) for local run and tests.
