#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { generateImage, listKnownModels, listAvailableModels, checkModel } from './tools/image-gen.ts';
import { OpenRouterClient } from './services/openrouter.ts';
import { logger } from './utils/logger.ts';
import { withToolErrorHandler } from './utils/tool-handler.ts';
import { GenerateImageSchema, CheckModelSchema } from './schemas/image-gen.schema.ts';

const PORT = parseInt(process.env.PORT || '3001', 10);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

if (!OPENROUTER_API_KEY) {
  logger.error('OPENROUTER_API_KEY or OPENROUTER_KEY environment variable is required');
  process.exit(1);
}

// Session management
const transports = new Map<string, StreamableHTTPServerTransport>();

function getSessionId(headers: Request['headers']): string | undefined {
  const header = headers['mcp-session-id'] || headers['Mcp-Session-Id'];
  return typeof header === 'string' ? header : undefined;
}

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

Usage:
- Use generate_image to create images from text descriptions
- Enhance prompts with details: lighting, composition, mood, style, colors (3-6 sentences minimum)
- Default model (FLUX.2 Pro) provides highest quality but is more expensive
- Prefer list_known_models over list_available_models for curated, well-tested models with detailed characteristics
- Only use list_available_models if searching for specific models not in the known list or if there's an error with known models
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
    'list_known_models',
    {
      description: 'List curated image generation models with their characteristics, strengths, weaknesses, and recommended use cases. Prefer this over list_available_models unless searching for specific models not in this list or if there\'s an error with known models.',
      inputSchema: {},
    },
    withToolErrorHandler('list_known_models', () => Promise.resolve(listKnownModels())),
  );

  server.registerTool(
    'list_available_models',
    {
      description: 'Query OpenRouter API to get a list of all available image generation models. Dynamically fetches current models including newly added ones. Use this only if searching for specific models not in list_known_models or if there\'s an error with known models. Prefer list_known_models for curated, well-tested models.',
      inputSchema: {},
    },
    withToolErrorHandler('list_available_models', () => listAvailableModels(openRouterClient)),
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
    }),
  );

  return server;
}

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

function sendErrorResponse(res: Response, status: number, code: number, message: string, id: unknown = null): void {
  if (res.headersSent || res.closed || res.destroyed || res.socket?.destroyed) {
    return;
  }
  
  try {
    res.status(status).json({
      jsonrpc: '2.0',
      error: { code, message },
      id,
    });
  } catch (error) {
    // Silently fail if connection is already closed
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!errorMessage.includes('ECONNRESET') && !errorMessage.includes('EPIPE')) {
      logger.warn({ error: errorMessage, status, code, message, id }, 'Failed to send error response');
    }
  }
}

function createApp(): express.Application {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      server: 'image-generation-mcp-server',
      version: '1.0.0',
      activeSessions: transports.size,
    });
  });

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
      // Log connection closure errors but don't treat them as critical
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('aborted') || errorMessage.includes('closed') || errorMessage.includes('ECONNRESET')) {
        logger.warn({ sessionId, error: errorMessage }, 'Client connection closed during request');
      } else {
        logger.error({ sessionId, error: errorMessage }, 'Error in transport.handleRequest');
        sendErrorResponse(res, 500, -32603, 'Internal server error');
      }
    }
  });

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
      // Always clean up session on error
      transports.delete(sessionId);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('aborted') || errorMessage.includes('closed') || errorMessage.includes('ECONNRESET')) {
        logger.warn({ sessionId, error: errorMessage }, 'Connection closed during session termination');
      } else {
        logger.error({ error: errorMessage, sessionId }, 'Error handling session termination');
        sendErrorResponse(res, 500, -32603, 'Error handling session termination');
      }
    }
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = getSessionId(req.headers);
      const requestId = typeof req.body === 'object' && req.body !== null && 'id' in req.body ? req.body.id : null;

      // Handle existing session
      if (sessionId) {
        const transport = transports.get(sessionId);
        if (transport) {
          try {
            await transport.handleRequest(req, res, req.body);
          } catch (transportError) {
            const errorMessage = transportError instanceof Error ? transportError.message : String(transportError);
            // Log connection closure errors but don't treat them as critical
            if (errorMessage.includes('aborted') || errorMessage.includes('closed') || errorMessage.includes('ECONNRESET')) {
              logger.warn({ sessionId, requestId, error: errorMessage }, 'Client connection closed during tool execution');
            } else {
              throw transportError;
            }
          }
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
      const requestId = typeof req.body === 'object' && req.body !== null && 'id' in req.body ? req.body.id : null;
      
      // Log connection closure errors but don't treat them as critical
      if (errorMessage.includes('aborted') || errorMessage.includes('closed') || errorMessage.includes('ECONNRESET')) {
        logger.warn({ requestId, error: errorMessage }, 'Client connection closed during request');
      } else {
        logger.error({ error: errorMessage, requestId }, 'Error handling MCP request');
        sendErrorResponse(res, 500, -32603, 'Internal server error', requestId);
      }
    }
  });

  return app;
}

async function main(): Promise<void> {
  try {
    const app = createApp();
    app.disable('x-powered-by');

    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT }, 'MCP Image Generation Server started');
    });

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
