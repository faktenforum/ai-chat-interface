# Firecrawl MCP Tools

Tool recommendations for Firecrawl MCP server integration.

## Recommended Tools

**Core:**
- `firecrawl_search` - Web search with content extraction
- `firecrawl_scrape` - Single URL content extraction
- `firecrawl_extract` - Structured data extraction with LLM
- `firecrawl_map` - Discover website URLs
- `firecrawl_batch_scrape` - Multiple URLs with rate limiting

**Advanced (use with caution):**
- `firecrawl_crawl` - Multi-page crawl (always set `maxDepth` and `limit`)
- `firecrawl_check_crawl_status` - Check crawl job status

## Configuration

**Auto-load all tools:**
```json
{ "mcpServers": ["firecrawl"] }
```

**Explicit selection (recommended):**
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

## Testing

```bash
npm install -g @modelcontextprotocol/inspector
export FIRECRAWL_API_KEY=fc-YOUR_API_KEY
mcp-inspector stdio npx -y firecrawl-mcp
```

## Common Issues

- Missing API key: Set `FIRECRAWL_API_KEY`
- Rate limiting: Implement retry logic
- Token overflow: Reduce `limit` and `maxDepth`
- Timeout: Increase `timeout` parameter
