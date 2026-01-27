# Image Generation MCP Server

MCP server providing image generation capabilities via OpenRouter API for LibreChat agents.

## Overview

This server implements the Model Context Protocol (MCP) to provide image generation tools using various models available through OpenRouter, including FLUX.2 Pro, FLUX.2 Flex, and Gemini models.

## Tools

- **`generate_image`**: Generate high-quality images from text descriptions
- **`list_models`**: List all available image generation models with characteristics, strengths, and recommended use cases
- **`check_model`**: Verify if a specific model supports image generation

## Features

- ✅ Multiple model support (FLUX.2 Pro, FLUX.2 Flex, Gemini, etc.)
- ✅ Model metadata with characteristics and recommendations
- ✅ Aspect ratio and image size control (Gemini models)
- ✅ Stateless HTTP transport (streamable-http)
- ✅ Session management
- ✅ Graceful shutdown
- ✅ Structured logging (Pino)
- ✅ Health check endpoint
- ✅ Error handling with Request-ID support

## Environment Variables

- `PORT`: Server port (default: `3001`)
- `LOG_LEVEL`: Logging level (default: `info`)
- `OPENROUTER_API_KEY` or `OPENROUTER_KEY`: OpenRouter API key (required)
- `OPENROUTER_BASE_URL`: OpenRouter API base URL (default: `https://openrouter.ai/api/v1`)

## Development

```bash
npm install
npm run build
npm start
```

## Architecture

The server uses:
- **Express.js** for HTTP server
- **@modelcontextprotocol/sdk** for MCP protocol implementation
- **OpenRouter API** for image generation
- **Pino** for structured logging
- **Zod** for input validation

## Model Recommendations

- **High Quality**: FLUX.2 Pro or FLUX.2 Flex
- **Fast/Cost-Effective with Aspect Ratio Control**: Gemini models
- **Default**: FLUX.2 Pro (highest quality, more expensive)

## License

MIT
