# Cursor MongoDB MCP Server Integration

Connect Cursor to the local LibreChat MongoDB database for querying and analysis.

## Setup

### 1. Expose MongoDB Port

The MongoDB service in `docker-compose.local.yml` exposes port 27017 to localhost:

```yaml
mongodb:
  ports:
    - "127.0.0.1:27017:27017"  # Only accessible from localhost
```

**Security:** This is for local development only. Never expose MongoDB ports in production.

### 2. Configure Cursor MCP Server

Configure the MongoDB MCP Server in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mongodb-librechat": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server@latest", "--readOnly"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/LibreChat"
      }
    }
  }
}
```

### 3. Restart Cursor

Restart Cursor IDE to load the MCP configuration.

## Usage

Query your MongoDB database directly in Cursor:

- "List all collections in the LibreChat database"
- "Show me the schema of the conversations collection"
- "Count documents in the users collection"
- "Export the last 10 messages from the messages collection"

## Security

- **Read-Only Mode:** The `--readOnly` flag prevents write operations
- **Localhost Only:** Port is only accessible from localhost, not external networks
- **Production:** Never expose MongoDB ports in production environments

## Troubleshooting

**Cannot connect:**
- Verify MongoDB is running: `docker ps | grep mongodb`
- Check port is exposed: `netstat -tuln | grep 27017` (Linux) or `lsof -i :27017` (macOS)
- Check MongoDB logs: `docker logs mongodb`

**MCP Server not available:**
- Verify `.cursor/mcp.json` has valid JSON syntax
- Restart Cursor IDE completely
- Verify Node.js is installed: `node --version` (should be 20.19.0+)

## References

- [MongoDB MCP Server](https://github.com/mongodb-js/mongodb-mcp-server)
- [Cursor MCP Documentation](https://docs.cursor.com/context/model-context-protocol)
