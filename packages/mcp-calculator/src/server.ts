#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Calculator MCP Server
 *
 * Provides mathematical operations (add, subtract, multiply, divide) via MCP protocol.
 * Uses streamable-http transport for stateless HTTP-based communication.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import { add, subtract, multiply, divide } from './tools/calculator.ts';
import { logger } from './utils/logger.ts';
import { CalculatorError } from './utils/errors.ts';
import { setupMcpEndpoints, setupGracefulShutdown } from './utils/http-server.ts';

const PORT = parseInt(process.env.PORT || '3000', 10);
const SERVER_NAME = 'calculator-mcp-server';
const SERVER_VERSION = '1.0.0';

// Session management
const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Creates and configures the MCP server with all handlers
 */
function createMcpServer() {
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
      instructions: `You have access to a calculator MCP server for performing mathematical operations.

Usage guidelines:
- Always use the calculator tools for mathematical calculations instead of computing manually
- All operations are precise and handle decimal numbers correctly
- Division by zero will return an error - always check for this case when dividing`,
    },
  );

  /**
   * Wraps tool execution with consistent error handling
   */
  const withErrorHandler = (
    toolName: string,
    handler: (args: { a: number; b: number }) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
  ) => {
    return async (args: { a: number; b: number }) => {
      try {
        return await handler(args);
      } catch (error) {
        logger.error(
          { tool: toolName, args, error: error instanceof Error ? error.message : String(error) },
          'Tool execution failed',
        );
        return {
          content: [
            {
              type: 'text',
              text:
                error instanceof CalculatorError
                  ? `Error: ${error.message}`
                  : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    };
  };

  // Register tools
  server.registerTool(
    'add',
    {
      description: 'Adds two numbers together',
      inputSchema: {
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
      },
    },
    withErrorHandler('add', add),
  );

  server.registerTool(
    'subtract',
    {
      description: 'Subtracts the second number from the first number',
      inputSchema: {
        a: z.number().describe('First number (minuend)'),
        b: z.number().describe('Second number (subtrahend)'),
      },
    },
    withErrorHandler('subtract', subtract),
  );

  server.registerTool(
    'multiply',
    {
      description: 'Multiplies two numbers together',
      inputSchema: {
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
      },
    },
    withErrorHandler('multiply', multiply),
  );

  server.registerTool(
    'divide',
    {
      description: 'Divides the first number by the second number. Returns an error if dividing by zero.',
      inputSchema: {
        a: z.number().describe('First number (dividend)'),
        b: z.number().describe('Second number (divisor)'),
      },
    },
    withErrorHandler('divide', divide),
  );

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
      logger.info({ port: PORT, server: SERVER_NAME, version: SERVER_VERSION }, 'MCP Calculator Server started');
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
