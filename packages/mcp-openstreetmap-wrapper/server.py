#!/usr/bin/env python3
"""
Wrapper script to run osm-mcp-server with HTTP transport using FastMCP.
This allows the stdio-only osm-mcp-server to be accessed via HTTP/streamable-http.
"""
import os
import subprocess
import sys
from pathlib import Path

def main():
    port = os.environ.get("PORT", "3004")
    host = os.environ.get("HOST", "0.0.0.0")
    transport = os.environ.get("TRANSPORT", "streamable-http")
    path = os.environ.get("PATH", "/mcp")
    
    # Start osm-mcp-server as subprocess with stdio
    # FastMCP will wrap it and expose via HTTP
    try:
        # Use fastmcp to run the stdio server with HTTP transport
        cmd = [
            "fastmcp", "run",
            "--transport", transport,
            "--host", host,
            "--port", port,
            "--path", path,
            "uvx", "osm-mcp-server"
        ]
        
        print(f"Starting osm-mcp-server with {transport} transport on {host}:{port}{path}", file=sys.stderr)
        sys.stderr.flush()
        
        # Execute the command
        os.execvp("fastmcp", cmd)
    except Exception as e:
        print(f"Error starting server: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
