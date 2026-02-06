# MCP Chefkoch Server

MCP server that provides tools to query recipes from [chefkoch.de](https://www.chefkoch.de). Data is obtained by parsing the public website (no official API).

## Tools

- **get_recipe** – Get a single recipe by URL or recipe ID. Returns title, ingredients, instructions, times, difficulty, servings, author, rating, etc. Chefkoch Plus recipes return limited data.
- **search_recipes** – Search recipes with optional filters (prep time, rating, category, diet, cuisine, sort). Returns a list of recipe summaries (title, url, image_url, rating).
- **get_random_recipe** – Get one random recipe (skips Plus recipes with retries).
- **get_daily_recipes** – Get today’s suggestions: `type`: `"kochen"` (cooking) or `"backen"` (baking). Returns list of summaries.

## Development

```bash
# From repo root
cd packages/mcp-chefkoch
npm install
chmod +x src/server.ts

# Run locally (no env file)
npm start

# Run with .env.local
npm run start:local

# Watch mode
npm run dev
npm run dev:local
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3014` | HTTP server port |
| `LOG_LEVEL` | `info` | Pino log level |

## Implementation notes

- Logic is ported from the Python library [FaserF/chefkoch](https://github.com/FaserF/chefkoch) (branch `fix-newchefkochwebsites`), supporting the current Next.js layout and Chefkoch Plus detection.
- All requests to chefkoch.de use a browser-like User-Agent.
- No API keys; keep request volume moderate.
