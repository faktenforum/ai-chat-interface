# MCP Calculator Server

MCP server providing basic arithmetic operations for LibreChat agents.

## Tools

- `add(a, b)`: Adds two numbers
- `subtract(a, b)`: Subtracts b from a
- `multiply(a, b)`: Multiplies two numbers
- `divide(a, b)`: Divides a by b (returns error if b is zero)

## Development

```bash
npm install
npm run build
npm start
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `LOG_LEVEL`: Logging level (default: info)

## License

MIT
