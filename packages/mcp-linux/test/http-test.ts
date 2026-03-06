/**
 * HTTP Tests for MCP Linux Server
 *
 * Tests the server's HTTP endpoints (health, MCP protocol).
 * Run: node --experimental-strip-types --experimental-transform-types --no-warnings test/http-test.ts
 */

import { createApp } from '../src/server.ts';

const PORT = 3099; // Test port

/**
 * MCP Streamable HTTP POST requires Accept: application/json, text/event-stream.
 * Without it the SDK returns 406 Not Acceptable.
 */
const MCP_HEADERS = {
  'Accept': 'application/json, text/event-stream',
  'Content-Type': 'application/json',
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function request(
  path: string,
  method: string = 'GET',
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const url = `http://localhost:${PORT}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

async function mcpPost(body: unknown, extraHeaders?: Record<string, string>) {
  return request('/mcp', 'POST', body, { ...MCP_HEADERS, ...extraHeaders });
}

async function runTests(): Promise<void> {
  const app = await createApp();
  const server = app.listen(PORT);

  try {
    console.log('=== MCP Linux HTTP Tests ===\n');

    // Test 1: Health endpoint
    {
      const { status, body } = await request('/health');
      const b = body as Record<string, unknown>;
      assert(status === 200, `Health: expected 200, got ${status}`);
      assert(b.status === 'ok', `Health: expected ok, got ${b.status}`);
      assert(b.server === 'mcp-linux-server', `Health: wrong server name`);
      console.log('✓ GET /health returns 200 with status ok');
    }

    // Test 2: POST /mcp without session ID and not an initialize request → 400
    {
      const { status } = await mcpPost({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
      assert(status === 400, `No session: expected 400, got ${status}`);
      console.log('✓ POST /mcp without session returns 400');
    }

    // Test 3: GET /mcp without session ID → 400
    {
      const { status } = await request('/mcp', 'GET');
      assert(status === 400, `GET no session: expected 400, got ${status}`);
      console.log('✓ GET /mcp without session returns 400');
    }

    // Test 4: GET /mcp with unknown session ID → 404 Not Found (MCP spec §Session Management)
    // Spec: "The server MUST respond to requests with an unknown session ID with HTTP 404."
    // Spec: "The client MUST start a new session by sending a new InitializeRequest."
    {
      const { status, body } = await request('/mcp', 'GET', undefined, {
        'mcp-session-id': '00000000-0000-0000-0000-000000000000',
      });
      assert(status === 404, `GET unknown session: expected 404, got ${status}`);
      const b = body as { error?: { message?: string } };
      assert(b.error?.message === 'Session not found', 'Expected "Session not found" message');
      console.log('✓ GET /mcp with unknown session returns 404');
    }

    // Test 5: Initialize creates a new session → 200 with result
    // Use current protocol version per MCP spec versioning page.
    {
      const { status, body } = await mcpPost(
        {
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
          id: 1,
        },
        { 'X-User-Email': 'test@example.com' },
      );
      assert(status === 200, `Initialize: expected 200, got ${status}`);
      const b = body as Record<string, unknown>;
      assert(b.result !== undefined, 'Initialize: expected result');
      console.log('✓ POST /mcp initialize returns 200');
    }

    console.log('\n=== All tests passed ===');
  } finally {
    server.close();
  }
}

runTests().catch((error) => {
  console.error('Tests failed:', error);
  process.exit(1);
});
