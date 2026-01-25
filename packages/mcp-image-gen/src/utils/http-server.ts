/**
 * Common HTTP server utilities for MCP servers
 *
 * Provides shared functionality for Express-based MCP servers using streamable-http transport.
 * These utilities handle session management, error responses, and standard endpoint patterns.
 */

import express, { type Request, type Response } from 'express';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * Extracts MCP session ID from HTTP request headers
 *
 * Supports both lowercase and capitalized header names for compatibility.
 *
 * @param headers - Request headers object
 * @returns Session ID if present, undefined otherwise
 */
export function getSessionId(headers: Request['headers']): string | undefined {
  const header = headers['mcp-session-id'] || headers['Mcp-Session-Id'];
  return typeof header === 'string' ? header : undefined;
}

/**
 * Sends a JSON-RPC error response
 *
 * @param res - Express response object
 * @param status - HTTP status code
 * @param code - JSON-RPC error code
 * @param message - Error message
 * @param id - Optional request ID to include in response
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
  /** Server name for health check endpoint */
  serverName: string;
  /** Server version */
  version: string;
  /** Port to listen on */
  port: number;
  /** Session transport map */
  transports: Map<string, StreamableHTTPServerTransport>;
  /** Function to create a new MCP server instance with transport */
  createServer: () => {
    server: { connect: (transport: StreamableHTTPServerTransport) => Promise<void> };
    transport: StreamableHTTPServerTransport;
  };
  /** Optional logger instance */
  logger?: { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}

/**
 * Creates standard Express endpoints for MCP HTTP server
 *
 * Sets up:
 * - GET /health - Health check endpoint
 * - GET /mcp - SSE stream endpoint (returns 404 for stateless servers)
 * - DELETE /mcp - Session termination endpoint
 * - POST /mcp - Main MCP endpoint for requests
 *
 * @param app - Express application instance
 * @param config - Server configuration
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
  // According to MCP specification, StreamableHTTPServerTransport.handleRequest
  // can handle both POST and GET requests, automatically processing SSE streams
  // when Accept: text/event-stream header is present.
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
      // transport.handleRequest automatically handles GET with Accept: text/event-stream
      // It will set appropriate SSE headers and stream responses
      // The transport manages the SSE connection and will keep it open for server-to-client messages
      await transport.handleRequest(req, res, null);
    } catch (error) {
      // Only log errors if the connection is still open and headers haven't been sent
      // Connection closure is normal and shouldn't be treated as an error
      const isConnectionClosed = res.destroyed || res.closed;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isAbortError = errorMessage.includes('aborted') || 
                          errorMessage.includes('terminated') ||
                          errorMessage.includes('ECONNRESET') ||
                          errorMessage.includes('EPIPE');
      
      if (!isConnectionClosed && !isAbortError && !res.headersSent) {
        logger?.error(
          { error: errorMessage, sessionId },
          'Error handling SSE stream request',
        );
        sendErrorResponse(res, 500, -32603, 'Internal server error');
      } else if (isAbortError || isConnectionClosed) {
        // Connection was aborted/terminated - this is normal when client disconnects
        logger?.debug?.(
          { error: errorMessage, sessionId, connectionClosed: isConnectionClosed },
          'SSE stream connection closed',
        );
      }
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
 *
 * @param server - HTTP server instance
 * @param transports - Session transport map
 * @param logger - Optional logger instance
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
