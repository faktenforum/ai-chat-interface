# MCP Image Generation Server

MCP server providing image generation capabilities via OpenRouter API for LibreChat agents.

## Tools

### `generate_image`
Generate high-quality images from text descriptions using OpenRouter-supported models.

**Parameters:**
- `prompt` (required): Detailed text description of the image to generate (3-6 sentences recommended)
- `model` (optional): Image generation model to use (default: `black-forest-labs/flux.2-pro`)
- `aspect_ratio` (optional): Aspect ratio for Gemini models (e.g., "16:9", "9:16", "1:1")
- `image_size` (optional): Image size for Gemini models ("1K", "2K", "4K")

**Example:**
```json
{
  "prompt": "A beautiful sunset over mountains with vibrant orange and pink colors, dramatic clouds, peaceful atmosphere",
  "model": "black-forest-labs/flux.2-pro",
  "aspect_ratio": "16:9"
}
```

### `list_known_models`
List curated image generation models with their characteristics, strengths, weaknesses, and recommended use cases.

**Returns:** Information about well-tested models including:
- FLUX.2 Pro (highest quality)
- FLUX.2 Flex (flexible styles)
- Gemini 2.5 Flash Image (fast with aspect ratio control)
- Riverflow v2 (general purpose)

### `list_available_models`
Query OpenRouter API to get a list of all available image generation models. Dynamically fetches current models including newly added ones.

**Returns:** List of all models that support image generation with pricing and capabilities.

### `check_model`
Check if a specific model exists in OpenRouter and supports image generation.

**Parameters:**
- `model` (required): Model identifier to check (e.g., "black-forest-labs/flux.2-pro")

**Returns:** Model existence status, image generation support, and detailed information.

## Known Models

The server maintains a curated list of known models:

- **FLUX.2 Pro**: Highest quality, excellent detail, photorealistic
- **FLUX.2 Flex**: Flexible styles, good balance of quality and speed
- **Gemini 2.5 Flash Image**: Fast generation with aspect ratio and resolution control
- **Riverflow v2**: Good quality, reliable, general purpose

## Development

```bash
npm install
npm run dev
```

## Environment Variables

- `PORT`: Server port (default: 3001)
- `LOG_LEVEL`: Logging level (default: info)
- `OPENROUTER_API_KEY` or `OPENROUTER_KEY`: OpenRouter API key (required)
- `OPENROUTER_BASE_URL`: OpenRouter API base URL (default: https://openrouter.ai/api/v1)

## Testing

```bash
# Integration tests
npm run test:integration

# HTTP API tests
npm run test:http
```

## Docker

```bash
# Build image
docker build -t mcp-image-gen .

# Run container
docker run -p 3001:3001 \
  -e OPENROUTER_KEY=your-key \
  -e PORT=3001 \
  mcp-image-gen
```

## License

MIT
