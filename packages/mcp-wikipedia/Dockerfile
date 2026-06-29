# Wikipedia MCP server (streamable-http). Wraps the upstream `wikipedia-mcp` pip package.
# https://pypi.org/project/wikipedia-mcp/
FROM python:3.12-slim
RUN pip install --no-cache-dir wikipedia-mcp==2.0.1
RUN useradd --create-home --uid 1000 appuser
USER appuser
ENV MCP_WIKIPEDIA_PORT=3017
EXPOSE 3017
# Optional WIKIPEDIA_ACCESS_TOKEN env raises Wikipedia API rate limits.
CMD ["sh", "-c", "wikipedia-mcp --transport streamable-http --host 0.0.0.0 --port ${MCP_WIKIPEDIA_PORT:-3017} --path /mcp"]
