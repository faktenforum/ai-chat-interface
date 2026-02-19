/**
 * HTTP server utilities for MCP Linux server
 *
 * Extended from mcp-calculator pattern with user-context extraction from headers.
 */

import express, { type Request, type Response } from 'express';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * User context extracted from LibreChat request headers
 */
export interface UserContext {
  userId: string;
  email: string;
  username: string;
}

/**
 * Extracts user context from LibreChat request headers.
 *
 * LibreChat sends these headers when configured with {{LIBRECHAT_USER_*}} placeholders:
 * - X-User-ID: unique user identifier
 * - X-User-Email: user email address
 * - X-User-Username: username
 */
export function extractUserContext(headers: Request['headers']): UserContext | null {
  const userId = headers['x-user-id'];
  const email = headers['x-user-email'];
  const username = headers['x-user-username'];

  if (!email || typeof email !== 'string') {
    return null;
  }

  return {
    userId: typeof userId === 'string' ? userId : '',
    email,
    username: typeof username === 'string' ? username : '',
  };
}

/**
 * Extracts MCP session ID from HTTP request headers
 */
export function getSessionId(headers: Request['headers']): string | undefined {
  const header = headers['mcp-session-id'] || headers['Mcp-Session-Id'];
  return typeof header === 'string' ? header : undefined;
}

/**
 * Sends a JSON-RPC error response
 */
export function sendErrorResponse(
  res: Response,
  status: number,
  code: number,
  message: string,
  id: unknown = null,
): void {
  if (res.headersSent) return;
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id,
  });
}

/**
 * Configuration for creating HTTP server endpoints
 */
export interface HttpServerConfig {
  serverName: string;
  version: string;
  port: number;
  transports: Map<string, StreamableHTTPServerTransport>;
  createServer: () => {
    server: { connect: (transport: StreamableHTTPServerTransport) => Promise<void> };
    transport: StreamableHTTPServerTransport;
  };
  logger?: { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}

/**
 * Creates standard Express endpoints for MCP HTTP server
 */
export function setupMcpEndpoints(app: express.Application, config: HttpServerConfig): void {
  const { serverName, version, transports, createServer, logger } = config;

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      server: serverName,
      version,
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
      await transport.handleRequest(req, res, null);
    } catch (error) {
      logger?.error(
        { error: error instanceof Error ? error.message : String(error), sessionId },
        'Error handling SSE stream request',
      );
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
      logger?.info({ sessionId, totalSessions: transports.size }, 'Session deleted');
    } catch (error) {
      logger?.error(
        { error: error instanceof Error ? error.message : String(error), sessionId },
        'Error handling session termination',
      );
      sendErrorResponse(res, 500, -32603, 'Error handling session termination');
    }
  });

  // Main MCP endpoint (POST /mcp)
  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = getSessionId(req.headers);
      const requestId =
        typeof req.body === 'object' && req.body !== null && 'id' in req.body ? req.body.id : null;

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
      const isInitialize =
        typeof req.body === 'object' &&
        req.body !== null &&
        'method' in req.body &&
        req.body.method === 'initialize';
      if (!isInitialize) {
        sendErrorResponse(res, 400, -32000, 'Bad Request: No session ID provided', requestId);
        return;
      }

      // Create new session for initialize request
      const { server, transport } = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger?.error({ error: errorMessage }, 'Error handling MCP request');
      const requestId =
        typeof req.body === 'object' && req.body !== null && 'id' in req.body ? req.body.id : null;
      sendErrorResponse(res, 500, -32603, 'Internal server error', requestId);
    }
  });
}

/**
 * Sets up graceful shutdown handlers
 */
export function setupGracefulShutdown(
  server: ReturnType<express.Application['listen']>,
  transports: Map<string, StreamableHTTPServerTransport>,
  logger?: { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void },
): void {
  const shutdown = async () => {
    logger?.info('Shutting down...');
    for (const [sessionId, transport] of transports.entries()) {
      try {
        await transport.close();
      } catch (error) {
        logger?.error(
          { error: error instanceof Error ? error.message : String(error), sessionId },
          'Error closing transport',
        );
      }
    }
    transports.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
