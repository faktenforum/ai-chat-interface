# Wikipedia MCP Tools

Tool recommendations and usage guide for Wikipedia MCP server integration.

## ⚠️ Current Status: Disabled

**The Wikipedia MCP server is currently disabled due to SSE transport compatibility issues between FastMCP and LibreChat.**

The server runs correctly and responds to requests, but LibreChat's SSE client closes the connection immediately after establishing it. This is a known compatibility issue with FastMCP-based servers and LibreChat's SSE transport implementation.

**Related Issues:**
- [LibreChat Discussion #10424](https://github.com/danny-avila/LibreChat/discussions/10424) - Streamable-HTTP Transport Closes Immediately
- [LibreChat Discussion #9621](https://github.com/danny-avila/LibreChat/discussions/9621) - Transport error: SSE stream disconnected

**Workaround:** The server can be re-enabled once:
1. The compatibility issue is resolved in LibreChat or FastMCP
2. Or wikipedia-mcp adds support for streamable-http transport (newer MCP spec)

**Server Status:** The Docker container runs successfully, but the MCP connection fails during initialization.

## Available Tools

The Wikipedia MCP server provides the following tools for accessing Wikipedia information:

### Core Search & Retrieval

- **`search_wikipedia`** - Search Wikipedia for articles matching a query
  - Parameters: `query` (string), `limit` (integer, optional, default: 10)
  - Returns: List of search results with titles, snippets, and metadata

- **`get_article`** - Get the full content of a Wikipedia article
  - Parameters: `title` (string)
  - Returns: Article content including text, summary, sections, links, and categories

- **`get_summary`** - Get a concise summary of a Wikipedia article
  - Parameters: `title` (string)
  - Returns: Text summary of the article

### Section & Link Discovery

- **`get_sections`** - Get the sections of a Wikipedia article
  - Parameters: `title` (string)
  - Returns: Structured list of article sections with their content

- **`get_links`** - Get the links contained within a Wikipedia article
  - Parameters: `title` (string)
  - Returns: List of links to other Wikipedia articles

- **`get_related_topics`** - Get topics related to a Wikipedia article
  - Parameters: `title` (string), `limit` (integer, optional, default: 10)
  - Returns: List of related topics with relevance information

### Advanced Features

- **`get_coordinates`** - Get the coordinates of a Wikipedia article (for location-based articles)
  - Parameters: `title` (string)
  - Returns: Coordinate information including latitude, longitude, and metadata

- **`summarize_article_for_query`** - Get a summary tailored to a specific query
  - Parameters: `title` (string), `query` (string), `max_length` (integer, optional, default: 250)
  - Returns: Focused summary based on the query

- **`summarize_article_section`** - Get a summary of a specific section
  - Parameters: `title` (string), `section_title` (string), `max_length` (integer, optional, default: 150)
  - Returns: Summary of the specified section

- **`extract_key_facts`** - Extract key facts from an article
  - Parameters: `title` (string), `topic_within_article` (string, optional), `count` (integer, optional, default: 5)
  - Returns: List of extracted facts

- **`test_wikipedia_connectivity`** - Test connectivity to Wikipedia API
  - Parameters: None
  - Returns: Connection status, response time, and diagnostics

## Configuration

### Agent Configuration

**Auto-load all tools:**
```json
{
  "mcpServers": ["wikipedia"]
}
```

**Explicit selection (recommended for focused agents):**
```json
{
  "mcpServers": ["wikipedia"],
  "mcpTools": [
    "search_wikipedia_mcp_wikipedia",
    "get_article_mcp_wikipedia",
    "get_summary_mcp_wikipedia",
    "get_sections_mcp_wikipedia",
    "get_links_mcp_wikipedia",
    "get_related_topics_mcp_wikipedia"
  ]
}
```

### Language Configuration

The Wikipedia MCP server supports multiple languages and country codes:

**Environment Variables:**
- `MCP_WIKIPEDIA_LANGUAGE` - Language code (e.g., `de`, `fr`, `ja`, `zh-hans`)
- `MCP_WIKIPEDIA_ACCESS_TOKEN` - Optional Personal Access Token to avoid rate limiting

**Supported Languages:**
- English (`en`) - Default
- German (`de`)
- French (`fr`)
- Japanese (`ja`)
- Chinese Simplified (`zh-hans`)
- Chinese Traditional (`zh-tw`)
- And 140+ other languages

**Country Codes:**
The server also supports intuitive country codes:
- `US`, `UK`, `CA` → English
- `DE` → German
- `FR` → French
- `JP` → Japanese
- `CN` → Simplified Chinese
- `TW` → Traditional Chinese

## Usage Examples

### Basic Search

```
User: "Search Wikipedia for information about quantum computing"
Agent: Uses `search_wikipedia` with query "quantum computing"
```

### Article Retrieval

```
User: "Tell me about artificial intelligence from Wikipedia"
Agent: Uses `search_wikipedia` to find article, then `get_summary` or `get_article`
```

### Related Topics Discovery

```
User: "What topics are related to machine learning?"
Agent: Uses `search_wikipedia` to find "Machine learning" article, then `get_related_topics`
```

### Location-Based Queries

```
User: "What are the coordinates of the Eiffel Tower?"
Agent: Uses `get_coordinates` with title "Eiffel Tower"
```

### Focused Summaries

```
User: "Summarize the history section of the Wikipedia article about Python programming"
Agent: Uses `summarize_article_section` with title "Python (programming language)" and section "History"
```

## Best Practices

1. **Search First**: Use `search_wikipedia` to find the correct article title before using other tools
2. **Use Summaries**: Prefer `get_summary` over `get_article` for token efficiency
3. **Limit Results**: Always set reasonable `limit` values to avoid token overflow
4. **Handle Errors**: Check for article existence before retrieving full content
5. **Rate Limiting**: Use `MCP_WIKIPEDIA_ACCESS_TOKEN` if experiencing 403 errors

## Testing

### Local Testing

```bash
# Test Docker service
docker compose up -d mcp-wikipedia
docker compose logs mcp-wikipedia

# Test connectivity (from within Docker network)
docker compose exec mcp-wikipedia python -c "import socket; s=socket.socket(); s.connect(('localhost', 3002)); print('Connected')"
```

### LibreChat Integration

1. Restart LibreChat to load new MCP configuration
2. Verify Wikipedia appears in MCP servers list
3. Test Wikipedia search tool in chat
4. Test article retrieval tool

## Common Issues

### Rate Limiting (403 Errors)

**Solution**: Set `MCP_WIKIPEDIA_ACCESS_TOKEN` environment variable with a Wikipedia Personal Access Token.

To obtain a token:
1. Create a Wikipedia account
2. Go to Preferences → User profile → Personal access tokens
3. Generate a new token
4. Add to `.env.local`: `MCP_WIKIPEDIA_ACCESS_TOKEN=your_token_here`

### Article Not Found

**Solution**: 
- Verify exact spelling of article titles (case-sensitive)
- Use `search_wikipedia` first to find the correct title
- Check if article exists in the configured language

### Empty Search Results

**Solution**:
- Use `test_wikipedia_connectivity` tool to check API access
- Verify query spelling and try broader terms
- Check firewall/proxy settings for `*.wikipedia.org`

### Large Articles Exceeding Token Limits

**Solution**:
- Use `get_summary` instead of `get_article`
- Use `get_sections` to retrieve specific sections
- Use `summarize_article_for_query` for focused content

## Language-Specific Examples

### German Wikipedia

Set `MCP_WIKIPEDIA_LANGUAGE=de` in environment:

```
User: "Suche auf Wikipedia nach Informationen über künstliche Intelligenz"
Agent: Searches German Wikipedia and retrieves German-language content
```

### Japanese Wikipedia

Set `MCP_WIKIPEDIA_LANGUAGE=ja` in environment:

```
User: "Tell me about Tokyo from Japanese Wikipedia"
Agent: Retrieves content from Japanese Wikipedia edition
```

## References

- [Wikipedia MCP Server Repository](https://github.com/Rudra-ravi/wikipedia-mcp)
- [Wikipedia API Documentation](https://www.mediawiki.org/wiki/API:Main_page)
- [MCP Protocol Specification](https://modelcontextprotocol.io)
