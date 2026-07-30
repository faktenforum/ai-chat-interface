/**
 * Guards the multi-endpoint wiring in server.ts: three MCP servers on one
 * container, each with its own tool list, plus one health endpoint that counts
 * all three.
 *
 * Runs the real `createApp()`, so a path, a session map or a factory wired to the
 * wrong endpoint fails here. No credentials and no root needed - listing tools
 * does not touch a mailbox, a calendar or a Linux account.
 *
 *   node --experimental-strip-types --experimental-transform-types --no-warnings \
 *     --experimental-specifier-resolution=node test/endpoints.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/server.ts';

const PORT = 3996;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function toolsAt(path: string): Promise<string[]> {
  const client = new Client({ name: 'mcp-endpoint-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}${path}`), {
      requestInit: { headers: { 'X-User-Email': 'endpoint.suite@example.com' } },
    }),
  );
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  await client.close();
  return names;
}

async function main(): Promise<void> {
  const app = await createApp();
  const http = app.listen(PORT, '127.0.0.1');

  console.log('=== endpoints ===\n');

  const linux = await toolsAt('/mcp');
  const mail = await toolsAt('/mcp/mail');
  const calendar = await toolsAt('/mcp/calendar');

  assert(linux.includes('execute_command'), '/mcp carries the terminal tools');
  assert(linux.includes('start_job'), '/mcp carries the job tools');
  assert(mail.includes('list_mailboxes'), '/mcp/mail carries the mail tools');
  assert(calendar.includes('list_calendars'), '/mcp/calendar carries the calendar tools');
  console.log(`✓ each endpoint serves its own tools (${linux.length}/${mail.length}/${calendar.length})`);

  /* The point of separate servers: a mail tool must not show up in the Linux
   * tool list, or its missing credentials would gate the terminal too. */
  assert(!linux.includes('list_mailboxes'), 'the Linux server does not carry mail tools');
  assert(!linux.includes('list_calendars'), 'nor calendar tools');
  assert(!mail.includes('execute_command'), 'the mail server does not carry Linux tools');
  assert(!mail.includes('list_calendars'), 'nor calendar tools');
  assert(!calendar.includes('list_mailboxes'), 'the calendar server does not carry mail tools');
  console.log('✓ the tool lists stay separate, so credentials gate one server at a time');

  const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  assert(health.status === 'ok', 'health reports ok');
  assert(
    'linux' in health.sessions && 'mail' in health.sessions && 'calendar' in health.sessions,
    `health counts all three, got ${JSON.stringify(health.sessions)}`,
  );
  console.log('✓ one health endpoint counts the sessions of all three');

  http.close();
  console.log('\n=== All tests passed ===');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
