/**
 * Server and runtime configuration.
 * Environment variables are read at startup; missing required values cause exit(1).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXAMPLE_MODEL_ID } from './constants/models.ts';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { version: string };

export const SERVER_NAME = 'image-generation-mcp-server';
export const SERVER_VERSION = pkg.version;

export const PORT = parseInt(process.env.PORT ?? '3001', 10);
export const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY ?? '';
export const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

/** MCP server instructions for the agent. Model capabilities are described via list_models. */
export const SERVER_INSTRUCTIONS = `You have access to image generation tools via OpenRouter.

Usage:
- Use generate_image to create images from text descriptions.
- Use detailed prompts: lighting, composition, mood, style (3–6 sentences).
- Use list_models to see available models, their capabilities (e.g. aspect ratio, image size), strengths, and recommended use cases.
- Use check_model to verify a model supports image generation before calling generate_image.
- Example model ID for reference: ${EXAMPLE_MODEL_ID}. Always use the exact Model ID from list_models (case-sensitive).`;
