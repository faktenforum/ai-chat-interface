# MCP Calculator Server

Production-ready MCP (Model Context Protocol) server providing basic arithmetic operations for LibreChat agents.

## Overview

This MCP server implements a calculator tool that can be used by LibreChat agents to perform mathematical operations. It provides four basic operations: addition, subtraction, multiplication, and division.

## Features

- **Four Calculator Tools**: add, subtract, multiply, divide
- **Input Validation**: Zod schema validation for all inputs
- **Error Handling**: Proper error handling for edge cases (e.g., division by zero)
- **Resources**: Server information and calculation history
- **Prompts**: System instructions for LLM integration
- **Production Ready**: Structured logging, health checks, Docker support
- **Security**: Optional API key authentication, non-root Docker user

## Tools

### add
Adds two numbers together.

**Parameters:**
- `a` (number): First number
- `b` (number): Second number

**Example:**
```json
{
  "tool": "add",
  "arguments": {
    "a": 5,
    "b": 3
  }
}
```

**Response:**
```
5 + 3 = 8
```

### subtract
Subtracts the second number from the first number.

**Parameters:**
- `a` (number): First number (minuend)
- `b` (number): Second number (subtrahend)

**Example:**
```json
{
  "tool": "subtract",
  "arguments": {
    "a": 10,
    "b": 4
  }
}
```

**Response:**
```
10 - 4 = 6
```

### multiply
Multiplies two numbers together.

**Parameters:**
- `a` (number): First number
- `b` (number): Second number

**Example:**
```json
{
  "tool": "multiply",
  "arguments": {
    "a": 6,
    "b": 7
  }
}
```

**Response:**
```
6 × 7 = 42
```

### divide
Divides the first number by the second number.

**Parameters:**
- `a` (number): First number (dividend)
- `b` (number): Second number (divisor)

**Example:**
```json
{
  "tool": "divide",
  "arguments": {
    "a": 20,
    "b": 4
  }
}
```

**Response:**
```
20 ÷ 4 = 5
```

**Error Case (Division by Zero):**
```json
{
  "tool": "divide",
  "arguments": {
    "a": 10,
    "b": 0
  }
}
```

**Response:**
```
Error: Division by zero is not allowed
```

## Resources

### calculator://info
Returns server information including version, uptime, and available tools.

### calculator://history
Returns the calculation history (last 100 operations) with timestamps.

## Prompts

### calculator_usage
Provides system instructions for LLMs on how to use the calculator tools effectively.

## Development

### Prerequisites

- Node.js 22+ (LTS recommended)
- npm or yarn
- TypeScript 5.7+

### Setup

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start development server (with watch mode)
npm run dev

# Start production server
npm start
```

### Environment Variables

Create a `.env` file (see `.env.example`):

```env
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
# Optional: API keys for authentication (comma-separated)
# API_KEYS=key1,key2,key3
```

## Docker

### Build

```bash
docker build -t mcp-calculator:latest packages/mcp-calculator/
```

### Run

```bash
docker run -d \
  --name mcp-calculator \
  -p 3000:3000 \
  -e PORT=3000 \
  -e LOG_LEVEL=info \
  mcp-calculator:latest
```

### Health Check

```bash
curl http://localhost:3000/health
```

## Integration with LibreChat

### Configuration

The MCP Calculator server is already configured in `librechat.yaml`:

```yaml
mcpSettings:
  allowedDomains:
    - 'mcp-calculator'  # Docker service name

mcpServers:
  calculator:
    type: streamable-http
    url: http://mcp-calculator:3000/mcp
    headers:
      X-User-ID: "{{LIBRECHAT_USER_ID}}"
      X-User-Name: "{{LIBRECHAT_USER_USERNAME}}"
    timeout: 30000
    initTimeout: 10000
    title: "Calculator"
    description: "Performs basic arithmetic operations"
    serverInstructions: |
      Use the calculator for mathematical operations...
    chatMenu: true
    startup: true
```

### Docker Compose

Add to your `docker-compose.local.yml` or `docker-compose.prod.yml`:

```bash
docker compose -f docker-compose.local.yml \
               -f docker-compose.mcp-calculator.yml \
               --env-file .env.local up -d
```

### Testing in LibreChat

1. Start the MCP Calculator server (via Docker Compose)
2. Start LibreChat
3. Create or edit an Agent in LibreChat
4. Enable the "calculator" MCP server in the agent configuration
5. Test calculations in a chat conversation

**Example Chat:**
```
User: "What is 15 + 27?"
Agent: [Uses calculator tool] "15 + 27 = 42"
```

## Production Deployment

### Docker Hub / Registry

For Portainer deployment, publish the image to a registry:

```bash
# Tag for registry
docker tag mcp-calculator:latest ghcr.io/faktenforum/mcp-calculator:latest
docker tag mcp-calculator:latest ghcr.io/faktenforum/mcp-calculator:1.0.0

# Push to registry
docker push ghcr.io/faktenforum/mcp-calculator:latest
docker push ghcr.io/faktenforum/mcp-calculator:1.0.0
```

### Portainer Configuration

1. Create a new stack in Portainer
2. Use `docker-compose.prod.yml` + `docker-compose.mcp-calculator.yml`
3. Set environment variables in Portainer:
   - `NODE_ENV=production`
   - `PORT=3000`
   - `LOG_LEVEL=info`
   - `MCP_CALCULATOR_API_KEYS` (optional, comma-separated)
4. Deploy the stack

### Security Best Practices

- **API Keys**: Set `API_KEYS` environment variable for authentication
- **Network**: Use Docker networks to isolate services
- **Health Checks**: Monitor health endpoint for service status
- **Logging**: Use structured logging (Pino) for production monitoring
- **Resource Limits**: Set CPU/memory limits in Docker Compose
- **Non-Root User**: Container runs as non-root user (appuser)

## API Endpoints

### POST /mcp
MCP protocol endpoint for tool calls, resource access, and prompts.

**Headers:**
- `Content-Type: application/json`
- `X-API-Key` (optional, if API keys are configured)

**Request Body:**
MCP JSON-RPC protocol messages.

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-XX...",
  "uptime": 123.45,
  "version": "1.0.0"
}
```

## Architecture

```
┌─────────────────┐
│  LibreChat     │
│  (Agent)       │
└────────┬────────┘
         │ HTTP POST /mcp
         │ (streamable-http)
         ▼
┌─────────────────┐
│ MCP Calculator  │
│   Server        │
│  (Express)      │
└────────┬────────┘
         │
         ├─► Tools (add, subtract, multiply, divide)
         ├─► Resources (info, history)
         └─► Prompts (usage instructions)
```

## Logging

The server uses [Pino](https://getpino.io/) for structured logging.

**Log Levels:**
- `error`: Errors and exceptions
- `warn`: Warnings (e.g., division by zero attempts)
- `info`: General information (server start, tool calls)
- `debug`: Detailed debugging information

**Example Log Output:**
```json
{
  "level": "INFO",
  "time": "2026-01-XX...",
  "msg": "Addition performed",
  "operation": "add",
  "a": 5,
  "b": 3,
  "result": 8
}
```

## Error Handling

All errors are properly typed and return user-friendly messages:

- **DivisionByZeroError**: Division by zero attempts
- **InvalidInputError**: Invalid input parameters
- **ValidationError**: Schema validation failures
- **CalculatorError**: General calculator errors

## Testing

### Manual Testing

```bash
# Health check
curl http://localhost:3000/health

# Test MCP endpoint (requires MCP protocol knowledge)
# Use LibreChat integration for full testing
```

### Integration Testing

1. Start the server: `npm run dev`
2. Start LibreChat with MCP Calculator configured
3. Create an agent with calculator tools enabled
4. Test calculations in chat interface

## Troubleshooting

### Server won't start

- Check port availability: `lsof -i :3000`
- Verify environment variables
- Check logs for errors

### LibreChat can't connect

- Verify `mcpSettings.allowedDomains` includes `mcp-calculator`
- Check Docker network connectivity
- Verify URL in `librechat.yaml` matches service name
- Check server logs for connection errors

### Tools not appearing in LibreChat

- Verify MCP server is running: `curl http://mcp-calculator:3000/health`
- Check LibreChat logs for MCP initialization errors
- Verify `startup: true` in `librechat.yaml`
- Restart LibreChat after configuration changes

## License

MIT

## Contributing

This server serves as a template for creating additional MCP servers. When creating new servers:

1. Follow the same project structure
2. Use the same security practices
3. Implement proper error handling
4. Add comprehensive documentation
5. Include Docker support
6. Integrate with LibreChat configuration

## See Also

- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
- [LibreChat MCP Documentation](https://docs.librechat.ai/features/mcp)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
