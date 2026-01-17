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

const transports = new Map<string, StreamableHTTPServerTransport>();

function getSessionId(headers: Request['headers']): string | undefined {
  const header = headers['mcp-session-id'];
  if (typeof header === 'string') {
    return header;
  }
  if (Array.isArray(header) && header.length > 0 && typeof header[0] === 'string') {
    return header[0];
  }
  return undefined;
}

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

      if (error instanceof CalculatorError) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Unexpected error: ${errorMessage}`,
          },
        ],
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

function createApp(): express.Application {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      server: {
        name: 'calculator-mcp-server',
        version: '1.0.0'
      },
      transport: 'streamable-http',
      activeSessions: transports.size
    });
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req.headers);

    if (!sessionId) {
      if (!res.headersSent) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No session ID provided' },
          id: null,
        });
      }
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      logger.warn({ sessionId, totalSessions: transports.size }, 'GET: Session not found');
      if (!res.headersSent) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: Session not found' },
          id: null,
        });
      }
      return;
    }

    try {
      req.socket.setTimeout(0);
      req.socket.setNoDelay(true);
      req.socket.setKeepAlive(true, 60000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ sessionId, error: errorMessage }, 'Error configuring socket');
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ sessionId, error: errorMessage }, 'Error in transport.handleRequest');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = getSessionId(req.headers);

    if (!sessionId) {
      if (!res.headersSent) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
      }
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      if (!res.headersSent) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
      }
      return;
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, sessionId }, 'Error handling session termination');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Error handling session termination' },
          id: null,
        });
      }
    }
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = getSessionId(req.headers);

      if (sessionId) {
        const transport = transports.get(sessionId);
        if (transport) {
          await transport.handleRequest(req, res, req.body);
          return;
        }
        if (!res.headersSent) {
          const requestId = typeof req.body === 'object' && req.body !== null && 'id' in req.body
            ? (req.body as { id: unknown }).id
            : null;
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: Invalid session ID' },
            id: requestId,
          });
        }
        return;
      }

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
          transports.delete(sid);
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Error handling MCP request');
      if (!res.headersSent) {
        const requestId = typeof req.body === 'object' && req.body !== null && 'id' in req.body
          ? (req.body as { id: unknown }).id
          : null;
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: requestId,
        });
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
      logger.info({ port: PORT }, 'MCP Calculator Server started');
    });

    server.timeout = 0;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    const shutdown = async () => {
      logger.info('Shutting down...');
      for (const [sessionId, transport] of transports.entries()) {
        try {
          await transport.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error({ error: errorMessage, sessionId }, 'Error closing transport');
        }
      }
      transports.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
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
