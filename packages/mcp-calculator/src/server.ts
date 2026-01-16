#!/usr/bin/env node
import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHttpServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { add, subtract, multiply, divide, getHistory, clearHistory } from './tools/calculator.js';
import { logger } from './utils/logger.js';
import { CalculatorError } from './utils/errors.js';
import type {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_KEYS = process.env.API_KEYS ? process.env.API_KEYS.split(',').map((k) => k.trim()) : [];

/**
 * Create and configure the MCP server
 */
function createMCPServer(): Server {
  const server = new Server(
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
    },
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'add',
          description: 'Adds two numbers together',
          inputSchema: {
            type: 'object',
            properties: {
              a: {
                type: 'number',
                description: 'First number',
              },
              b: {
                type: 'number',
                description: 'Second number',
              },
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
              a: {
                type: 'number',
                description: 'First number (minuend)',
              },
              b: {
                type: 'number',
                description: 'Second number (subtrahend)',
              },
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
              a: {
                type: 'number',
                description: 'First number',
              },
              b: {
                type: 'number',
                description: 'Second number',
              },
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
              a: {
                type: 'number',
                description: 'First number (dividend)',
              },
              b: {
                type: 'number',
                description: 'Second number (divisor)',
              },
            },
            required: ['a', 'b'],
          },
        },
      ],
    };
  });

  // Handle tool calls
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
      logger.error({ tool: name, args, error }, 'Tool execution failed');
      
      if (error instanceof CalculatorError) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
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
    };
  });

  // Read resources
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
      const history = getHistory();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(history, null, 2),
          },
        ],
      };
    }

    throw new CalculatorError(`Unknown resource: ${uri}`, 'UNKNOWN_RESOURCE');
  });

  // List available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: 'calculator_usage',
          description: 'Instructions on how to use the calculator tools',
        },
      ],
    };
  });

  // Get prompt
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

Always use these tools for calculations instead of computing manually. The tools provide accurate results and handle edge cases like division by zero.

Example usage:
- To calculate 5 + 3, use the add tool with a=5 and b=3
- To calculate 10 / 2, use the divide tool with a=10 and b=2
- Division by zero will return an error message

The calculator maintains a history of recent calculations that can be accessed via resources.`,
            },
          },
        ],
      };
    }

    throw new CalculatorError(`Unknown prompt: ${name}`, 'UNKNOWN_PROMPT');
  });

  // Error handler
  server.onerror = (error) => {
    logger.error({ error }, 'MCP server error');
  };

  return server;
}

/**
 * Create Express app with MCP server
 */
function createApp(): express.Application {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.text({ type: 'text/plain' }));

  // Request logging middleware
  app.use((req: Request, res: Response, next: express.NextFunction) => {
    logger.info(
      {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
      'Incoming request',
    );
    next();
  });

  // Optional API key authentication
  const authenticate = (req: Request, res: Response, next: express.NextFunction): void => {
    if (API_KEYS.length === 0) {
      // No API keys configured, allow all requests
      next();
      return;
    }

    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    
    if (!apiKey || typeof apiKey !== 'string' || !API_KEYS.includes(apiKey)) {
      res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
      return;
    }

    next();
  };

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
    });
  });

  // MCP endpoint (streamable-http)
  // Note: StreamableHttpServerTransport handles the full request/response cycle
  // We create a new transport instance per request
  app.post('/mcp', authenticate, async (req: Request, res: Response) => {
    try {
      // Create a new MCP server instance for this request
      // (The SDK may handle connection pooling internally)
      const requestServer = createMCPServer();
      
      // Create transport - it will handle the request body and response
      const transport = new StreamableHttpServerTransport('/mcp', res);
      
      // Connect the server to the transport
      // The transport will process the request body from req and send responses via res
      await requestServer.connect(transport);
      
      // The transport handles everything from here
      // It reads from the request and writes to the response
    } catch (error) {
      logger.error({ error }, 'Error handling MCP request');
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  return app;
}

/**
 * Start the server
 */
async function main(): Promise<void> {
  try {
    const app = createApp();

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(
        {
          port: PORT,
          nodeEnv: process.env.NODE_ENV || 'development',
          hasApiKeys: API_KEYS.length > 0,
        },
        'MCP Calculator Server started',
      );
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      process.exit(0);
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start server if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { createApp, createMCPServer };
