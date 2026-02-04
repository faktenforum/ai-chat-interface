#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Image Generation MCP Server
 *
 * Exposes image generation via OpenRouter (list_models, check_model, generate_image).
 * Uses streamable-http transport for stateless HTTP communication.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  PORT,
  SERVER_NAME,
  SERVER_VERSION,
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL,
  SERVER_INSTRUCTIONS,
} from './config.ts';
import { GenerateImageSchema, CheckModelSchema } from './schemas/image-gen.schema.ts';
import { OpenRouterClient } from './services/openrouter.ts';
import { generateImage, listModels, checkModel } from './tools/image-gen.ts';
import { setupMcpEndpoints, setupGracefulShutdown } from './utils/http-server.ts';
import { logger } from './utils/logger.ts';
import { withToolErrorHandler } from './utils/tool-handler.ts';

if (!OPENROUTER_API_KEY) {
  logger.error('OPENROUTER_API_KEY or OPENROUTER_KEY environment variable is required');
  process.exit(1);
}

const transports = new Map<string, StreamableHTTPServerTransport>();

function createMcpServer(): McpServer {
  const openRouter = new OpenRouterClient(OPENROUTER_API_KEY, OPENROUTER_BASE_URL);

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.registerTool(
    'generate_image',
    {
      description:
        'Generate images from text descriptions using OpenRouter image models. Use list_models to see available models and their capabilities.',
      inputSchema: GenerateImageSchema,
    },
    withToolErrorHandler('generate_image', (args) => generateImage(args, openRouter)),
  );

  server.registerTool(
    'list_models',
    {
      description:
        'List available image generation models from OpenRouter with metadata (capabilities, strengths, use cases). Use this to choose a model for generate_image.',
      inputSchema: {},
    },
    withToolErrorHandler('list_models', () => listModels(openRouter)),
  );

  server.registerTool(
    'check_model',
    {
      description:
        'Check whether a model exists on OpenRouter and supports image generation. Use before calling generate_image with an unfamiliar model ID.',
      inputSchema: CheckModelSchema,
    },
    withToolErrorHandler('check_model', (args) => checkModel(args, openRouter)),
  );

  server.registerResource(
    'info',
    'image-gen://info',
    { description: 'Information about the image generation MCP server', mimeType: 'application/json' },
    async () => ({
      contents: [
        {
          uri: 'image-gen://info',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              name: SERVER_NAME,
              version: SERVER_VERSION,
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

async function main(): Promise<void> {
  try {
    const app = createApp();
    const httpServer = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT, server: SERVER_NAME, version: SERVER_VERSION }, 'MCP Image Generation Server started');
    });
    setupGracefulShutdown(httpServer, transports, logger);
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
