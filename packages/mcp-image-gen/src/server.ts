#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import { generateImage, listKnownModels, listAvailableModels, checkModel } from './tools/image-gen.ts';
import { OpenRouterClient } from './services/openrouter.ts';
import { logger } from './utils/logger.ts';
import { ImageGenError } from './utils/errors.ts';
import { ASPECT_RATIOS, IMAGE_SIZES } from './schemas/image-gen.schema.ts';

const PORT = parseInt(process.env.PORT || '3001', 10);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

if (!OPENROUTER_API_KEY) {
  logger.error('OPENROUTER_API_KEY or OPENROUTER_KEY environment variable is required');
  process.exit(1);
}

// Session management
const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Extracts session ID from request headers (supports both lowercase and capitalized header names)
 */
function getSessionId(headers: Request['headers']): string | undefined {
  const header = headers['mcp-session-id'] || headers['Mcp-Session-Id'];
  return typeof header === 'string' ? header : undefined;
}

/**
 * Creates and configures the MCP server with all handlers
 */
function createServer() {
  const openRouterClient = new OpenRouterClient(OPENROUTER_API_KEY, OPENROUTER_BASE_URL);

  const server = new McpServer(
    {
      name: 'image-generation-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      instructions: `You have access to image generation tools via OpenRouter.

Usage guidelines:
- Use generate_image to create images from text descriptions
- Always enhance basic prompts with details: lighting, composition, mood, style, colors, and visual elements (3-6 sentences minimum)
- Default model (FLUX.2 Pro) provides highest quality for most use cases
- Use list_known_models to see recommended models with their strengths and weaknesses
- Use list_available_models to discover all available image generation models from OpenRouter
- Use check_model to verify if a specific model exists and supports image generation
- For Gemini models (models with "gemini" in the name), you can specify aspect_ratio (16:9, 9:16, etc.) and image_size (1K, 2K, 4K)
- When an image is generated, it will be displayed directly - do not repeat the description in detail`,
    },
  );

  // Register generate_image tool
  server.registerTool('generate_image', {
    description: 'Generate high-quality images from text descriptions using OpenRouter-supported models like FLUX.2-Pro, FLUX.2-Flex, or Gemini Image Generation. Supports various models optimized for different use cases.',
    inputSchema: {
      prompt: z
        .string()
        .min(1)
        .describe('Detailed text description of the image to generate. Should be 3-6 sentences, focusing on visual elements, lighting, composition, mood, and style.'),
      model: z
        .string()
        .optional()
        .default('black-forest-labs/flux.2-pro')
        .describe('The image generation model to use. Any OpenRouter-compatible image generation model can be used. Defaults to FLUX.2-Pro for best quality. Examples: black-forest-labs/flux.2-pro, google/gemini-2.5-flash-image-preview, etc.'),
      aspect_ratio: z
        .enum(ASPECT_RATIOS)
        .optional()
        .describe('Aspect ratio for the generated image. Only supported for Gemini models. Defaults to 1:1 (square).'),
      image_size: z
        .enum(IMAGE_SIZES)
        .optional()
        .describe('Image size/resolution. Only supported for Gemini models. Defaults to 1K.'),
    },
  }, async (args: { prompt: string; model?: string; aspect_ratio?: string; image_size?: string }) => {
    try {
      return await generateImage(args, openRouterClient);
    } catch (error) {
      logger.error({ tool: 'generate_image', args, error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
      return {
        content: [{ type: 'text', text: error instanceof ImageGenError ? `Error: ${error.message}` : `Unexpected error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // Register list_known_models tool
  server.registerTool('list_known_models', {
    description: 'List curated image generation models with their characteristics, strengths, weaknesses, and recommended use cases. These are well-tested models with known capabilities.',
    inputSchema: {},
  }, async () => {
    try {
      return listKnownModels();
    } catch (error) {
      logger.error({ tool: 'list_known_models', error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
      return {
        content: [{ type: 'text', text: `Unexpected error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // Register list_available_models tool
  server.registerTool('list_available_models', {
    description: 'Query OpenRouter API to get a list of all available image generation models. This dynamically fetches the current list of models that support image generation, including newly added models.',
    inputSchema: {},
  }, async () => {
    try {
      return await listAvailableModels(openRouterClient);
    } catch (error) {
      logger.error({ tool: 'list_available_models', error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // Register check_model tool
  server.registerTool('check_model', {
    description: 'Check if a specific model exists in OpenRouter and supports image generation. Useful for validating model IDs before using them with generate_image.',
    inputSchema: {
      model: z
        .string()
        .min(1)
        .describe('The model identifier to check (e.g., "black-forest-labs/flux.2-pro")'),
    },
  }, async (args: { model: string }) => {
    try {
      return await checkModel(args, openRouterClient);
    } catch (error) {
      logger.error({ tool: 'check_model', args, error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
      return {
        content: [{ type: 'text', text: error instanceof ImageGenError ? `Error: ${error.message}` : `Unexpected error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // Register resources
  server.registerResource('info', 'image-gen://info', {
    description: 'Information about the image generation MCP server',
    mimeType: 'application/json',
  }, async () => {
    return {
      contents: [
        {
          uri: 'image-gen://info',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              name: 'image-generation-mcp-server',
              version: '1.0.0',
              description: 'MCP Server providing image generation via OpenRouter API',
              tools: ['generate_image', 'list_known_models', 'list_available_models', 'check_model'],
              uptime: process.uptime(),
              nodeVersion: process.version,
              openRouterBaseUrl: OPENROUTER_BASE_URL,
            },
            null,
            2,
          ),
        },
      ],
    };
  });

  // Register prompts
  server.registerPrompt('image_gen_usage', {
    description: 'Instructions on how to use the image generation tools',
  }, async () => {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You have access to image generation tools via OpenRouter:

Available tools:
- generate_image(prompt, model?, aspect_ratio?, image_size?): Generate images from text descriptions
- list_known_models(): List curated models with their characteristics
- list_available_models(): Query OpenRouter for all available image models
- check_model(model): Verify if a model exists and supports image generation

Always enhance basic prompts with details: lighting, composition, mood, style, colors, and visual elements (3-6 sentences minimum).
Default model (FLUX.2 Pro) provides highest quality.
For Gemini models, you can specify aspect_ratio and image_size.`,
          },
        },
      ],
    };
  });

  return server;
}

/**
 * Creates a new session for an initialize request
 */
function createSession(): { server: McpServer; transport: StreamableHTTPServerTransport } {
  const server = createServer();
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
 * Sends a JSON-RPC error response
 */
function sendErrorResponse(res: Response, status: number, code: number, message: string, id: unknown = null): void {
  if (res.headersSent) return;
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id,
  });
}

/**
 * Creates and configures the Express application
 */
function createApp(): express.Application {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      server: 'image-generation-mcp-server',
      version: '1.0.0',
      activeSessions: transports.size,
    });
  });

  // SSE stream endpoint (GET /mcp)
  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req.headers);

    if (!sessionId) {
      sendErrorResponse(res, 400, -32000, 'Bad Request: No session ID provided');
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      sendErrorResponse(res, 404, -32000, 'Session not found');
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error({ sessionId, error: error instanceof Error ? error.message : String(error) }, 'Error in transport.handleRequest');
      sendErrorResponse(res, 500, -32603, 'Internal server error');
    }
  });

  // Session termination endpoint (DELETE /mcp)
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req.headers);

    if (!sessionId) {
      sendErrorResponse(res, 400, -32000, 'Bad Request: No session ID provided');
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      sendErrorResponse(res, 404, -32000, 'Session not found');
      return;
    }

    try {
      await transport.handleRequest(req, res, req.body);
      transports.delete(sessionId);
      logger.info({ sessionId, totalSessions: transports.size }, 'Session deleted');
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error), sessionId }, 'Error handling session termination');
      sendErrorResponse(res, 500, -32603, 'Error handling session termination');
    }
  });

  // Main MCP endpoint (POST /mcp)
  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = getSessionId(req.headers);
      const requestId = typeof req.body === 'object' && req.body !== null && 'id' in req.body ? req.body.id : null;

      // Handle existing session
      if (sessionId) {
        const transport = transports.get(sessionId);
        if (transport) {
          await transport.handleRequest(req, res, req.body);
          return;
        }
        sendErrorResponse(res, 404, -32000, 'Session not found', requestId);
        return;
      }

      // No session ID - only allow initialize requests to create new sessions
      const isInitialize = typeof req.body === 'object' && req.body !== null && 'method' in req.body && req.body.method === 'initialize';
      if (!isInitialize) {
        sendErrorResponse(res, 400, -32000, 'Bad Request: No session ID provided', requestId);
        return;
      }

      // Create new session for initialize request
      const { server, transport } = createSession();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Error handling MCP request');
      const requestId = typeof req.body === 'object' && req.body !== null && 'id' in req.body ? req.body.id : null;
      sendErrorResponse(res, 500, -32603, 'Internal server error', requestId);
    }
  });

  return app;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const app = createApp();
    app.disable('x-powered-by');

    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT }, 'MCP Image Generation Server started');
    });

    // Graceful shutdown handler
    const shutdown = async () => {
      logger.info('Shutting down...');
      for (const [sessionId, transport] of transports.entries()) {
        try {
          await transport.close();
        } catch (error) {
          logger.error({ error: error instanceof Error ? error.message : String(error), sessionId }, 'Error closing transport');
        }
      }
      transports.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
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

export { createApp, createServer };
