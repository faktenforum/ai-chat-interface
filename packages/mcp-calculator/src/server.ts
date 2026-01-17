#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import { add, subtract, multiply, divide, getHistory } from './tools/calculator.ts';
import { logger } from './utils/logger.ts';
import { CalculatorError } from './utils/errors.ts';

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
  const server = new McpServer(
    {
      name: 'calculator-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      instructions: `You have access to a calculator MCP server for performing mathematical operations.

Usage guidelines:
- Always use the calculator tools for mathematical calculations instead of computing manually
- The calculator maintains a history of recent operations (last 100) - use get_history tool to retrieve it
- All operations are precise and handle decimal numbers correctly
- Division by zero will return an error - always check for this case when dividing`,
    },
  );

  // Register tools
  server.registerTool('add', {
    description: 'Adds two numbers together',
    inputSchema: {
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    },
  }, async (args: { a: number; b: number }) => {
    try {
      return await add(args);
    } catch (error) {
      logger.error({ tool: 'add', args, error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
      return {
        content: [{ type: 'text', text: error instanceof CalculatorError ? `Error: ${error.message}` : `Unexpected error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  server.registerTool('subtract', {
    description: 'Subtracts the second number from the first number',
    inputSchema: {
      a: z.number().describe('First number (minuend)'),
      b: z.number().describe('Second number (subtrahend)'),
    },
  }, async (args: { a: number; b: number }) => {
    try {
      return await subtract(args);
    } catch (error) {
      logger.error({ tool: 'subtract', args, error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
      return {
        content: [{ type: 'text', text: error instanceof CalculatorError ? `Error: ${error.message}` : `Unexpected error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  server.registerTool('multiply', {
    description: 'Multiplies two numbers together',
    inputSchema: {
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    },
  }, async (args: { a: number; b: number }) => {
    try {
      return await multiply(args);
    } catch (error) {
      logger.error({ tool: 'multiply', args, error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
      return {
        content: [{ type: 'text', text: error instanceof CalculatorError ? `Error: ${error.message}` : `Unexpected error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  server.registerTool('divide', {
    description: 'Divides the first number by the second number. Returns an error if dividing by zero.',
    inputSchema: {
      a: z.number().describe('First number (dividend)'),
      b: z.number().describe('Second number (divisor)'),
    },
  }, async (args: { a: number; b: number }) => {
    try {
      return await divide(args);
    } catch (error) {
      logger.error({ tool: 'divide', args, error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
      return {
        content: [{ type: 'text', text: error instanceof CalculatorError ? `Error: ${error.message}` : `Unexpected error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  server.registerTool('get_history', {
    description: 'Retrieves the calculation history (last 100 operations). Returns a list of recent calculations with operation type, operands, result, and timestamp.',
    inputSchema: {
      limit: z.number().optional().describe('Maximum number of history entries to return (default: all, max: 100)'),
    },
  }, async (args: { limit?: number }) => {
    try {
      const history = getHistory();
      const limit = args.limit ? Math.min(args.limit, 100) : history.length;
      const limitedHistory = history.slice(0, limit);

      if (limitedHistory.length === 0) {
        return {
          content: [{ type: 'text', text: 'No calculation history available.' }],
        };
      }

      const historyText = limitedHistory
        .map((entry, index) => {
          const timestamp = entry.timestamp.toISOString();
          return `${index + 1}. ${entry.operation}(${entry.a}, ${entry.b}) = ${entry.result} [${timestamp}]`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Calculation History (${limitedHistory.length} ${limitedHistory.length === 1 ? 'entry' : 'entries'}):\n\n${historyText}`,
          },
        ],
      };
    } catch (error) {
      logger.error({ tool: 'get_history', args, error: error instanceof Error ? error.message : String(error) }, 'Tool execution failed');
      return {
        content: [{ type: 'text', text: `Unexpected error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // Register resources
  server.registerResource('info', 'calculator://info', {
    description: 'Information about the calculator MCP server',
    mimeType: 'application/json',
  }, async () => {
    return {
      contents: [
        {
          uri: 'calculator://info',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              name: 'calculator-mcp-server',
              version: '1.0.0',
              description: 'MCP Server providing basic arithmetic operations',
              tools: ['add', 'subtract', 'multiply', 'divide', 'get_history'],
              uptime: process.uptime(),
              nodeVersion: process.version,
            },
            null,
            2,
          ),
        },
      ],
    };
  });

  server.registerResource('history', 'calculator://history', {
    description: 'Recent calculation history (last 100 operations)',
    mimeType: 'application/json',
  }, async () => {
    return {
      contents: [
        {
          uri: 'calculator://history',
          mimeType: 'application/json',
          text: JSON.stringify(getHistory(), null, 2),
        },
      ],
    };
  });

  // Register prompts
  server.registerPrompt('calculator_usage', {
    description: 'Instructions on how to use the calculator tools',
  }, async () => {
    return {
      messages: [
        {
          role: 'user',
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
