# MCP Image Generation Server

MCP server providing image generation via OpenRouter API for LibreChat agents.

## Tools

- `generate_image`: Generate images from text descriptions
- `list_known_models`: List curated models with characteristics
- `list_available_models`: Query OpenRouter for all available models
- `check_model`: Verify if a model supports image generation

## Environment Variables

- `PORT`: Server port (default: 3001)
- `LOG_LEVEL`: Logging level (default: info)
- `OPENROUTER_API_KEY` or `OPENROUTER_KEY`: OpenRouter API key (required)
- `OPENROUTER_BASE_URL`: OpenRouter API base URL (default: https://openrouter.ai/api/v1)

## Development

```bash
npm install
npm run dev
```

## License

MIT
