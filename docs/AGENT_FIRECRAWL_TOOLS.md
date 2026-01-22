# Firecrawl Tools for Research Assistant

Tool recommendations and testing guide for integrating Firecrawl MCP server with LibreChat agents.

## Recommended Tools

Based on [Firecrawl MCP Server documentation](https://github.com/firecrawl/firecrawl-mcp-server/) and research assistant requirements:

### Core Tools

- **`firecrawl_search`**: Web search with optional content extraction. Use when source URLs are unknown.
- **`firecrawl_scrape`**: Extract content from a single URL. Use for detailed analysis and citation.
- **`firecrawl_extract`**: Structured data extraction with LLM support. Use for extracting specific facts, numbers, or entities.
- **`firecrawl_map`**: Discover all indexed URLs on a website. Use for systematic domain exploration.
- **`firecrawl_batch_scrape`**: Efficiently scrape multiple known URLs with built-in rate limiting.

### Advanced Tools (Use with Caution)

- **`firecrawl_crawl`**: Asynchronous multi-page crawl. **Warning**: Responses can be very large. Always use `maxDepth` and `limit` parameters.
- **`firecrawl_check_crawl_status`**: Check status of asynchronous crawl jobs. Required when using `firecrawl_crawl`.

## Configuration

### Option 1: Auto-load All Tools

```json
{
  "mcpServers": ["firecrawl"]
}
```

### Option 2: Explicit Tool Selection (Recommended)

```json
{
  "mcpServers": ["firecrawl"],
  "mcpTools": [
    "firecrawl_search_mcp_firecrawl",
    "firecrawl_scrape_mcp_firecrawl",
    "firecrawl_extract_mcp_firecrawl",
    "firecrawl_map_mcp_firecrawl",
    "firecrawl_batch_scrape_mcp_firecrawl"
  ]
}
```

### Option 3: With Crawl Functionality

```json
{
  "mcpServers": ["firecrawl"],
  "mcpTools": [
    "firecrawl_search_mcp_firecrawl",
    "firecrawl_scrape_mcp_firecrawl",
    "firecrawl_extract_mcp_firecrawl",
    "firecrawl_map_mcp_firecrawl",
    "firecrawl_batch_scrape_mcp_firecrawl",
    "firecrawl_crawl_mcp_firecrawl",
    "firecrawl_check_crawl_status_mcp_firecrawl"
  ]
}
```

## Manual Testing with MCP Inspector

### Setup

```bash
# Install MCP Inspector
npm install -g @modelcontextprotocol/inspector

# Start Firecrawl MCP Server
export FIRECRAWL_API_KEY=fc-YOUR_API_KEY
npx -y firecrawl-mcp

# Start Inspector
mcp-inspector
# Or with explicit connection:
mcp-inspector stdio npx -y firecrawl-mcp
```

### Test Examples

#### `firecrawl_search`

```json
{
  "name": "firecrawl_search",
  "arguments": {
    "query": "latest advancements in quantum computing 2024",
    "limit": 3,
    "lang": "en",
    "country": "us",
    "scrapeOptions": {
      "formats": ["markdown"],
      "onlyMainContent": true
    }
  }
}
```

#### `firecrawl_scrape`

```json
{
  "name": "firecrawl_scrape",
  "arguments": {
    "url": "https://www.firecrawl.dev/",
    "formats": ["markdown"],
    "onlyMainContent": true,
    "waitFor": 1000,
    "timeout": 30000
  }
}
```

#### `firecrawl_extract`

```json
{
  "name": "firecrawl_extract",
  "arguments": {
    "urls": ["https://www.firecrawl.dev/"],
    "prompt": "Extract the main purpose or tagline of Firecrawl, and list the key features mentioned on the page",
    "schema": {
      "type": "object",
      "properties": {
        "tagline": { "type": "string" },
        "features": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["tagline", "features"]
    }
  }
}
```

#### `firecrawl_crawl` (with limits)

```json
{
  "name": "firecrawl_crawl",
  "arguments": {
    "url": "https://www.firecrawl.dev/*",
    "maxDepth": 1,
    "limit": 5,
    "allowExternalLinks": false,
    "deduplicateSimilarURLs": true
  }
}
```

**Important**: Always set `maxDepth` and `limit` to prevent token overflow.

## Common Issues

1. **Missing API Key**: Set `FIRECRAWL_API_KEY` environment variable
2. **Rate Limiting**: Wait between requests or implement retry logic
3. **Token Overflow**: Reduce `limit` and `maxDepth` parameters
4. **Timeout**: Increase `timeout` parameter or check network connectivity
