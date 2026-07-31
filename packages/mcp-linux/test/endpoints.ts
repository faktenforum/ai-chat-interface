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
import { idleSessionIds } from '../src/utils/http-server.ts';

const PORT = 3996;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function connect(path: string): Promise<Client> {
  const client = new Client({ name: 'mcp-endpoint-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}${path}`), {
      requestInit: { headers: { 'X-User-Email': 'endpoint.suite@example.com' } },
    }),
  );
  return client;
}

async function toolsAt(path: string): Promise<string[]> {
  const client = await connect(path);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  await client.close();
  return names;
}

const health = async (): Promise<Record<string, any>> =>
  (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()) as Record<string, any>;

/** Polls until the predicate holds, so the assertion does not race the socket. */
async function waitFor(
  predicate: () => Promise<boolean>,
  what: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/**
 * The idle-timeout policy, asserted without a clock. This is the bug that showed
 * up in production as "404 with active session - session lost, triggering
 * reconnection" every 35 minutes: a client that holds its stream open sends no
 * requests, so measuring idleness by the last request evicted it while it was
 * connected.
 */
function checkIdlePolicy(): void {
  const minute = 60_000;
  const now = 10 * minute;
  const lastActivity = new Map([
    ['fresh', now - minute],
    ['stale', now - 31 * minute],
    ['stale-but-streaming', now - 31 * minute],
  ]);

  const evicted = idleSessionIds({
    lastActivity,
    openStreams: new Set(['stale-but-streaming']),
    idleTimeoutMs: 30 * minute,
    now,
  });

  assert(evicted.includes('stale'), 'an idle session with no stream is evicted');
  assert(!evicted.includes('fresh'), 'a recently used session is kept');
  assert(
    !evicted.includes('stale-but-streaming'),
    'a session whose client holds the stream open is kept, however old its last request',
  );
  assert(evicted.length === 1, `exactly one eviction, got ${evicted.join(', ')}`);

  /* Exactly at the timeout counts as idle - the boundary decides whether the
   * cleanup ever fires at all for a client on a tidy interval. */
  const atBoundary = idleSessionIds({
    lastActivity: new Map([['edge', now - 30 * minute]]),
    openStreams: new Set(),
    idleTimeoutMs: 30 * minute,
    now,
  });
  assert(atBoundary.length === 1, 'a session idle for exactly the timeout is evicted');

  console.log('✓ idle eviction skips sessions whose stream is still open');
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

  const report = await health();
  assert(report.status === 'ok', 'health reports ok');
  assert(
    'linux' in report.sessions && 'mail' in report.sessions && 'calendar' in report.sessions,
    `health counts all three, got ${JSON.stringify(report.sessions)}`,
  );
  console.log('✓ one health endpoint counts the sessions of all three');

  checkIdlePolicy();

  {
    /* The policy above is only worth anything if the server actually reports a
     * held-open stream, so drive it with a real client. */
    const before = (await health()).openStreams;
    assert(before === 0, `no streams before connecting, got ${before}`);

    const client = await connect('/mcp');
    await waitFor(async () => (await health()).openStreams === 1, 'the stream to register');

    await client.close();
    await waitFor(async () => (await health()).openStreams === 0, 'the stream to deregister');
    console.log('✓ a connected client is counted as an open stream, and released on close');
  }

  http.close();
  console.log('\n=== All tests passed ===');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
