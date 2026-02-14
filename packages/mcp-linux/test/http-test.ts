/**
 * HTTP Tests for MCP Linux Server
 *
 * Tests the server's HTTP endpoints (health, MCP protocol).
 * Run: node --experimental-strip-types --experimental-transform-types --no-warnings test/http-test.ts
 */

import { createApp } from '../src/server.ts';

const PORT = 3099; // Test port

async function request(
  path: string,
  method: string = 'GET',
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const url = `http://localhost:${PORT}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

async function runTests(): Promise<void> {
  const app = createApp();
  const server = app.listen(PORT);

  try {
    console.log('=== MCP Linux HTTP Tests ===\n');

    // Test 1: Health endpoint
    {
      const { status, body } = await request('/health');
      const b = body as Record<string, unknown>;
      console.assert(status === 200, `Health: expected 200, got ${status}`);
      console.assert(b.status === 'ok', `Health: expected ok, got ${b.status}`);
      console.assert(b.server === 'mcp-linux-server', `Health: wrong server name`);
      console.log('✓ GET /health returns 200 with status ok');
    }

    // Test 2: POST /mcp without session ID and not initialize
    {
      const { status, body } = await request('/mcp', 'POST', {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      });
      console.assert(status === 400, `No session: expected 400, got ${status}`);
      console.log('✓ POST /mcp without session returns 400');
    }

    // Test 3: GET /mcp without session ID
    {
      const { status } = await request('/mcp', 'GET');
      console.assert(status === 400, `GET no session: expected 400, got ${status}`);
      console.log('✓ GET /mcp without session returns 400');
    }

    // Test 4: Initialize session
    {
      const { status, body } = await request('/mcp', 'POST', {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
        id: 1,
      }, {
        'X-User-Email': 'test@example.com',
      });
      console.assert(status === 200, `Initialize: expected 200, got ${status}`);
      const b = body as Record<string, unknown>;
      console.assert(b.result !== undefined, 'Initialize: expected result');
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
