# Calculator MCP Server

MCP server providing basic arithmetic operations for LibreChat agents.

## Overview

This server implements the Model Context Protocol (MCP) to provide mathematical calculation tools. It uses the `streamable-http` transport for stateless HTTP-based communication.

## Tools

- **`add(a, b)`**: Adds two numbers together
- **`subtract(a, b)`**: Subtracts the second number from the first
- **`multiply(a, b)`**: Multiplies two numbers
- **`divide(a, b)`**: Divides the first number by the second (returns error if dividing by zero)

## Features

- ✅ Stateless HTTP transport (streamable-http)
- ✅ Session management
- ✅ Graceful shutdown
- ✅ Structured logging (Pino)
- ✅ Health check endpoint
- ✅ Error handling with Request-ID support

## Development

```bash
npm install
npm run build
npm start
```

## Environment Variables

- `PORT`: Server port (default: `3000`)
- `LOG_LEVEL`: Logging level (default: `info`)

## Architecture

The server uses:
- **Express.js** for HTTP server
- **@modelcontextprotocol/sdk** for MCP protocol implementation
- **Pino** for structured logging
- **Zod** for input validation

## License

MIT
