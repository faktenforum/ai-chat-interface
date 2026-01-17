#!/usr/bin/env node
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import express, { type Request, type Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { add, subtract, multiply, divide, getHistory } from './tools/calculator.js';
import { logger } from './utils/logger.js';
import { CalculatorError } from './utils/errors.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

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
  const server = new Server(
    {
      name: 'calculator-mcp-server',
      version: '1.0.0',
    },
    {
      instructions: 'MCP Server providing basic arithmetic operations: add, subtract, multiply, divide',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'add',
        description: 'Adds two numbers together',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' },
          },
          required: ['a', 'b'],
        },
      },
      {
        name: 'subtract',
        description: 'Subtracts the second number from the first number',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number', description: 'First number (minuend)' },
            b: { type: 'number', description: 'Second number (subtrahend)' },
          },
          required: ['a', 'b'],
        },
      },
      {
        name: 'multiply',
        description: 'Multiplies two numbers together',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' },
          },
          required: ['a', 'b'],
        },
      },
      {
        name: 'divide',
        description: 'Divides the first number by the second number. Returns an error if dividing by zero.',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number', description: 'First number (dividend)' },
            b: { type: 'number', description: 'Second number (divisor)' },
          },
          required: ['a', 'b'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'add':
          return await add(args);
        case 'subtract':
          return await subtract(args);
        case 'multiply':
          return await multiply(args);
        case 'divide':
          return await divide(args);
        default:
          throw new CalculatorError(`Unknown tool: ${name}`, 'UNKNOWN_TOOL');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ tool: name, args, error: errorMessage }, 'Tool execution failed');

      return {
        content: [{ type: 'text', text: error instanceof CalculatorError ? `Error: ${error.message}` : `Unexpected error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'calculator://info',
        name: 'Server Information',
        description: 'Information about the calculator MCP server',
        mimeType: 'application/json',
      },
      {
        uri: 'calculator://history',
        name: 'Calculation History',
        description: 'Recent calculation history (last 100 operations)',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'calculator://info') {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                name: 'calculator-mcp-server',
                version: '1.0.0',
                description: 'MCP Server providing basic arithmetic operations',
                tools: ['add', 'subtract', 'multiply', 'divide'],
                uptime: process.uptime(),
                nodeVersion: process.version,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (uri === 'calculator://history') {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(getHistory(), null, 2),
          },
        ],
      };
    }

    throw new CalculatorError(`Unknown resource: ${uri}`, 'UNKNOWN_RESOURCE');
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'calculator_usage',
        description: 'Instructions on how to use the calculator tools',
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;

    if (name === 'calculator_usage') {
      return {
        messages: [
          {
            role: 'system',
            content: {
              type: 'text',
              text: `You have access to calculator tools for performing mathematical operations:

Available tools:
- add(a, b): Adds two numbers together
- subtract(a, b): Subtracts b from a
- multiply(a, b): Multiplies two numbers
- divide(a, b): Divides a by b (returns error if b is zero)

Always use these tools for calculations instead of computing manually.`,
            },
          },
        ],
      };
    }

    throw new CalculatorError(`Unknown prompt: ${name}`, 'UNKNOWN_PROMPT');
  });

  return { server };
}

/**
 * Creates a new session for an initialize request
 */
function createSession(): { server: Server; transport: StreamableHTTPServerTransport } {
  const { server } = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId: string) => {
      logger.info({ sessionId, totalSessions: transports.size + 1 }, 'Session initialized');
      transports.set(sessionId, transport);
    },
  });

  server.onclose = async () => {
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
      server: 'calculator-mcp-server',
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
      logger.info({ port: PORT }, 'MCP Calculator Server started');
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
