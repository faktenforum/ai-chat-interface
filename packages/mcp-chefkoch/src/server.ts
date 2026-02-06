#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Chefkoch MCP Server
 *
 * Provides tools to query recipes from chefkoch.de (get recipe, search, random, daily).
 * Uses streamable-http transport for stateless HTTP-based communication.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import { getRecipe } from './tools/get-recipe.ts';
import { searchRecipesTool } from './tools/search-recipes.ts';
import { getRandomRecipeTool } from './tools/get-random-recipe.ts';
import { getDailyRecipesTool } from './tools/get-daily-recipes.ts';
import { logger } from './utils/logger.ts';
import { ChefkochError } from './utils/errors.ts';
import { setupMcpEndpoints, setupGracefulShutdown } from './utils/http-server.ts';

const PORT = parseInt(process.env.PORT || '3014', 10);
const SERVER_NAME = 'mcp-chefkoch';
const SERVER_VERSION = '1.0.0';

const transports = new Map<string, StreamableHTTPServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: `You have access to Chefkoch.de recipe tools. Use them to find and display recipes (ingredients, instructions, times, ratings). Chefkoch Plus recipes return limited data; prefer non-Plus results when possible.`,
    },
  );

  type TextContent = { type: 'text'; text: string };
  const withErrorHandler = <T>(
    toolName: string,
    handler: (args: T) => Promise<{ content: TextContent[] }>,
  ) => {
    return async (args: T) => {
      try {
        return await handler(args);
      } catch (error) {
        logger.error(
          { tool: toolName, error: error instanceof Error ? error.message : String(error) },
          'Tool execution failed',
        );
        const content: TextContent[] = [
          {
            type: 'text',
            text:
              error instanceof ChefkochError
                ? `Error: ${error.message}`
                : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ];
        return { content, isError: true };
      }
    };
  };

  server.registerTool(
    'get_recipe',
    {
      description: 'Get a single recipe by URL or recipe ID from chefkoch.de',
      inputSchema: {
        url: z.string().url().optional().describe('Full URL of the recipe'),
        recipeId: z.string().optional().describe('Recipe ID or path (e.g. 745721177147257/Lasagne.html)'),
      },
    },
    withErrorHandler('get_recipe', getRecipe),
  );

  server.registerTool(
    'search_recipes',
    {
      description: 'Search recipes on chefkoch.de with optional filters (prep time, rating, category, etc.)',
      inputSchema: {
        query: z.string().describe('Search query'),
        page: z.number().int().min(1).optional().describe('Page number'),
        prep_times: z.enum(['15', '30', '60', '120', 'Alle']).optional(),
        ratings: z.enum(['Alle', '2', '3', '4', 'Top']).optional(),
        sort: z.enum(['Empfehlung', 'Bewertung', 'Neuheiten']).optional(),
        properties: z.array(z.string()).optional(),
        health: z.array(z.string()).optional(),
        categories: z.array(z.string()).optional(),
        countries: z.array(z.string()).optional(),
        meal_type: z.array(z.string()).optional(),
      },
    },
    withErrorHandler('search_recipes', searchRecipesTool),
  );

  server.registerTool(
    'get_random_recipe',
    {
      description: 'Get a random recipe from chefkoch.de (skips Plus recipes)',
      inputSchema: {},
    },
    withErrorHandler('get_random_recipe', getRandomRecipeTool),
  );

  server.registerTool(
    'get_daily_recipes',
    {
      description: "Get today's recipe suggestions: 'kochen' (cooking) or 'backen' (baking)",
      inputSchema: {
        type: z.enum(['kochen', 'backen']).describe("'kochen' or 'backen'"),
      },
    },
    withErrorHandler('get_daily_recipes', getDailyRecipesTool),
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
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT, server: SERVER_NAME, version: SERVER_VERSION }, 'MCP Chefkoch Server started');
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
