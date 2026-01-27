#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Image Generation MCP Server
 *
 * Provides image generation capabilities via OpenRouter API for LibreChat agents.
 * Supports multiple models including FLUX.2 Pro, FLUX.2 Flex, and Gemini models.
 * Uses streamable-http transport for stateless HTTP-based communication.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { generateImage, listModels, checkModel } from './tools/image-gen.ts';
import { OpenRouterClient } from './services/openrouter.ts';
import { logger } from './utils/logger.ts';
import { withToolErrorHandler } from './utils/tool-handler.ts';
import { GenerateImageSchema, CheckModelSchema } from './schemas/image-gen.schema.ts';
import { setupMcpEndpoints, setupGracefulShutdown } from './utils/http-server.ts';

const PORT = parseInt(process.env.PORT || '3001', 10);
const SERVER_NAME = 'image-generation-mcp-server';
const SERVER_VERSION = '1.0.0';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

if (!OPENROUTER_API_KEY) {
  logger.error('OPENROUTER_API_KEY or OPENROUTER_KEY environment variable is required');
  process.exit(1);
}

// Session management
const transports = new Map<string, StreamableHTTPServerTransport>();

function createMcpServer() {
  const openRouterClient = new OpenRouterClient(OPENROUTER_API_KEY, OPENROUTER_BASE_URL);

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      instructions: `You have access to image generation tools via OpenRouter.

Usage:
- Use generate_image to create images from text descriptions
- Enhance prompts with details: lighting, composition, mood, style, colors (3-6 sentences minimum)
- Use list_models to see all available models with their characteristics, strengths, weaknesses, and recommended use cases
- Default model (FLUX.2 Pro) provides highest quality but is more expensive
- For high-quality: FLUX.2 Pro or FLUX.2 Flex
- For fast/cost-effective with aspect ratio control: Gemini models
- Use check_model to verify model support
- Gemini models support aspect_ratio (16:9, 9:16, etc.) and image_size (1K, 2K, 4K)`,
    },
  );

  server.registerTool(
    'generate_image',
    {
      description: 'Generate high-quality images from text descriptions using OpenRouter-supported models like FLUX.2-Pro, FLUX.2-Flex, or Gemini Image Generation.',
      inputSchema: GenerateImageSchema,
    },
    withToolErrorHandler('generate_image', (args) => generateImage(args, openRouterClient)),
  );

  server.registerTool(
    'list_models',
    {
      description: 'List all available image generation models from OpenRouter, combining static metadata (characteristics, strengths, weaknesses, recommended use cases) with dynamic API data. This provides a comprehensive view of all models including well-tested ones with detailed metadata and newly added models.',
      inputSchema: {},
    },
    withToolErrorHandler('list_models', () => listModels(openRouterClient)),
  );

  server.registerTool(
    'check_model',
    {
      description: 'Check if a specific model exists in OpenRouter and supports image generation. Useful for validating model IDs before using them with generate_image.',
      inputSchema: CheckModelSchema,
    },
    withToolErrorHandler('check_model', (args) => checkModel(args, openRouterClient)),
  );

  server.registerResource(
    'info',
    'image-gen://info',
    {
      description: 'Information about the image generation MCP server',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'image-gen://info',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              name: 'image-generation-mcp-server',
              version: '1.0.0',
              description: 'MCP Server providing image generation via OpenRouter API',
              tools: ['generate_image', 'list_models', 'check_model'],
              uptime: process.uptime(),
              nodeVersion: process.version,
              openRouterBaseUrl: OPENROUTER_BASE_URL,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  return server;
}

/**
 * Creates a new session for an initialize request
 */
function createSession(): { server: McpServer; transport: StreamableHTTPServerTransport } {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId: string) => {
      logger.info({ sessionId, totalSessions: transports.size + 1 }, 'Session initialized');
      transports.set(sessionId, transport);
    },
  });

  server.server.onclose = async () => {
    const sid = transport.sessionId;
    if (sid && transports.has(sid)) {
      logger.info({ sessionId: sid, totalSessions: transports.size - 1 }, 'Session closed');
      transports.delete(sid);
    }
  };

  return { server, transport };
}

/**
 * Creates and configures the Express application
 */
function createApp(): express.Application {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.disable('x-powered-by');

  setupMcpEndpoints(app, {
    serverName: SERVER_NAME,
    version: SERVER_VERSION,
    port: PORT,
    transports,
    createServer: createSession,
    logger,
  });

  return app;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const app = createApp();
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT, server: SERVER_NAME, version: SERVER_VERSION }, 'MCP Image Generation Server started');
    });

    setupGracefulShutdown(server, transports, logger);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    logger.error({ error }, 'Fatal error');
    process.exit(1);
  });
}

export { createApp, createMcpServer };
