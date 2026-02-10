# @ai-chat-interface/mcp-linux

MCP Linux Server — Per-user isolated Linux terminal environments with persistent git workspaces.

## Quick Start

```bash
# Install dependencies
npm install

# Run locally (requires running as root for user management)
npm run dev
```

## Docker

```bash
# Build
docker build -t mcp-linux .

# Run
docker run -p 3015:3015 -v mcp_linux_homes:/home -v mcp_linux_data:/app/data mcp-linux
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3015` | Server port |
| `LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`) |
| `WORKER_IDLE_TIMEOUT` | `1800000` | Worker idle timeout in ms (30 min) |
| `GIT_SSH_KEY` | — | Base64-encoded SSH private key for git access |

## Documentation

See [docs/MCP_LINUX.md](../../docs/MCP_LINUX.md) for full documentation.
