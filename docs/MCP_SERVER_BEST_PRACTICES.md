# MCP Server Best Practices

This document outlines the best practices and patterns for implementing MCP servers in this codebase, based on the reference implementations in `packages/mcp-calculator` and `packages/mcp-image-gen`.

## Reference Implementations

The `mcp-calculator` and `mcp-image-gen` servers serve as reference implementations with all recommended features:

- ✅ Common HTTP server utilities (`src/utils/http-server.ts`)
- ✅ GET `/mcp` Endpoint (returns 404 for stateless servers)
- ✅ DELETE `/mcp` Endpoint for Session Termination
- ✅ POST `/mcp` Endpoint with Request-ID Handling
- ✅ Pino Logger with structured logging
- ✅ Graceful Shutdown Handler
- ✅ Consistent Error-Responses with Request-ID
- ✅ Session Management with proper cleanup logic
- ✅ Health Check Endpoint (`/health`)
- ✅ Clean code structure with separation of concerns

## Standard Endpoints

### Health Check Endpoint

All MCP servers should implement a `/health` endpoint for Docker healthchecks:

```typescript
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    server: 'your-server-name',
    version: '1.0.0',
    activeSessions: transports.size,
  });
});
```

### GET `/mcp` - SSE Stream Endpoint

According to the MCP specification, `StreamableHTTPServerTransport.handleRequest` can handle both POST and GET requests. For GET requests with `Accept: text/event-stream`, the transport automatically processes SSE streams.

```typescript
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
    await transport.handleRequest(req, res, null);
  } catch (error) {
    logger?.error(
      { error: error instanceof Error ? error.message : String(error), sessionId },
      'Error handling SSE stream request',
    );
    sendErrorResponse(res, 500, -32603, 'Internal server error');
  }
});
```

**Note**: The `StreamableHTTPServerTransport.handleRequest` method automatically detects GET requests with `Accept: text/event-stream` headers and handles SSE streaming accordingly. This is the correct implementation according to the MCP specification.

### Using Common HTTP Server Utilities

For packages in `packages/`, use the shared HTTP server utilities:

```typescript
import { setupMcpEndpoints, setupGracefulShutdown } from './utils/http-server.ts';

function createApp(): express.Application {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.disable('x-powered-by');

  setupMcpEndpoints(app, {
    serverName: 'your-server-name',
    version: '1.0.0',
    port: PORT,
    transports,
    createServer: createSession,
    logger,
  });

  return app;
}

// In main():
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, server: SERVER_NAME, version: SERVER_VERSION }, 'Server started');
});

setupGracefulShutdown(server, transports, logger);
```

This reduces code duplication and ensures consistency across all MCP servers.

### DELETE `/mcp` - Session Termination Endpoint

Terminates an existing session:

```typescript
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
```

### POST `/mcp` - Main MCP Endpoint

Handles MCP requests with proper Request-ID handling:

```typescript
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
```

## Logging Patterns

### Pino Logger Configuration

Use Pino for structured logging with consistent configuration:

```typescript
// src/utils/logger.ts
import pino from 'pino';

const logLevel = process.env.LOG_LEVEL || 'info';

export const logger = pino({
  level: logLevel,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

### Structured Logging

Always use structured logging with context objects:

```typescript
// Good
logger.info({ sessionId, totalSessions: transports.size }, 'Session initialized');
logger.error({ error: errorMessage, sessionId }, 'Error handling request');

// Bad
logger.info(`Session initialized: ${sessionId}`);
logger.error(`Error: ${errorMessage}`);
```

## Error Handling Patterns

### Error Response Function

Implement a consistent error response function that supports Request-ID:

```typescript
function sendErrorResponse(res: Response, status: number, code: number, message: string, id: unknown = null): void {
  if (res.headersSent) {
    return;
  }
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id,
  });
}
```

### Request-ID Handling

Always extract and include Request-ID in error responses:

```typescript
const requestId = typeof req.body === 'object' && req.body !== null && 'id' in req.body ? req.body.id : null;
sendErrorResponse(res, 404, -32000, 'Session not found', requestId);
```

## Session Management

### Session ID Extraction

Extract session ID from headers (supporting both lowercase and capitalized variants):

```typescript
function getSessionId(headers: Request['headers']): string | undefined {
  const header = headers['mcp-session-id'] || headers['Mcp-Session-Id'];
  return typeof header === 'string' ? header : undefined;
}
```

### Session Storage

Use a Map to store active sessions:

```typescript
const transports = new Map<string, StreamableHTTPServerTransport>();
```

### Session Cleanup

Properly clean up sessions on close:

```typescript
server.server.onclose = async () => {
  const sid = transport.sessionId;
  if (sid && transports.has(sid)) {
    logger.info({ sessionId: sid, totalSessions: transports.size - 1 }, 'Session closed');
    transports.delete(sid);
  }
};
```

## Graceful Shutdown

Implement graceful shutdown handlers for SIGTERM and SIGINT:

```typescript
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
```

## Express Configuration

### Basic Setup

```typescript
const app = express();
app.use(express.json({ limit: '10mb' }));
app.disable('x-powered-by');
```

### Server Initialization

```typescript
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'MCP Server started');
});
```

## Environment Variables

Standard environment variables:

- `PORT`: Server port (required for HTTP mode)
- `LOG_LEVEL`: Logging level (`debug`, `info`, `warn`, `error`, default: `info`)

## Code Structure

### Recommended File Structure

```
src/
├── server.ts          # Main server file with Express setup
├── tools/             # Tool implementations
│   └── your-tool.ts
├── utils/
│   ├── logger.ts      # Pino logger configuration
│   └── errors.ts      # Custom error classes (optional)
└── schemas/           # Zod schemas for validation
    └── your-schema.ts
```

## Common Patterns

### Session Creation

```typescript
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
```

## Checklist for New MCP Servers

When creating a new MCP server, ensure:

- [ ] Health check endpoint (`/health`)
- [ ] GET `/mcp` endpoint for SSE streams
- [ ] DELETE `/mcp` endpoint for session termination
- [ ] POST `/mcp` endpoint with Request-ID handling
- [ ] Pino logger with structured logging
- [ ] Graceful shutdown handlers (SIGTERM, SIGINT)
- [ ] Consistent error responses with Request-ID
- [ ] Proper session management and cleanup
- [ ] `x-powered-by` header disabled
- [ ] JSON body parser with appropriate limit (e.g., `10mb`)

## Notes for Submodules

For MCP servers in `dev/` (external Git submodules):

- These must function independently and cannot share packages
- Copy the patterns from the reference implementation
- Use the same Pino logger configuration
- Follow the same endpoint structure
- Implement the same error handling patterns

## Code Organization

### Shared Utilities (Packages Only)

For MCP servers in `packages/`, use the shared HTTP server utilities located in `src/utils/http-server.ts`:

- `getSessionId()` - Extract session ID from headers
- `sendErrorResponse()` - Send JSON-RPC error responses
- `setupMcpEndpoints()` - Configure all standard MCP endpoints
- `setupGracefulShutdown()` - Set up graceful shutdown handlers

This reduces code duplication and ensures consistency. For servers in `dev/` (submodules), copy these patterns manually.

### Code Structure Best Practices

1. **Separation of Concerns**: Keep server setup, tool handlers, and utilities in separate files
2. **Constants**: Define server name and version as constants at the top
3. **Error Handling**: Use consistent error handling patterns with proper error types
4. **Documentation**: Include JSDoc comments for all exported functions
5. **Type Safety**: Use TypeScript types consistently throughout

## References

- Reference Implementations:
  - `packages/mcp-calculator/src/server.ts`
  - `packages/mcp-image-gen/src/server.ts`
- Shared Utilities: `packages/mcp-calculator/src/utils/http-server.ts`
- MCP Specification: https://modelcontextprotocol.io/specification
- LibreChat MCP Documentation: `dev/librechat-doc/pages/docs/features/mcp.mdx`
