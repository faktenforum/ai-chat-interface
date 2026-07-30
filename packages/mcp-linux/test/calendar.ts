/**
 * Calendar server test, driven through the official MCP SDK client over HTTP -
 * the same path LibreChat takes, credentials in headers included.
 *
 * Needs a real CalDAV server. Radicale is enough:
 *
 *   mkdir -p /tmp/radicale/config /tmp/radicale/data
 *   printf 'caltest:secret\n' > /tmp/radicale/config/users
 *   cat > /tmp/radicale/config/config <<'CONF'
 *   [server]
 *   hosts = 0.0.0.0:5232
 *   [auth]
 *   type = htpasswd
 *   htpasswd_filename = /config/users
 *   htpasswd_encryption = plain
 *   [storage]
 *   filesystem_folder = /data/collections
 *   CONF
 *   podman run -d --rm --name radicale-test -p 127.0.0.1:5232:5232 \
 *     -v /tmp/radicale/config:/config:ro,Z -v /tmp/radicale/data:/data:Z \
 *     docker.io/tomsquest/docker-radicale:latest
 *
 *   cd packages/mcp-linux && npm run test:calendar
 */

import { randomUUID } from 'node:crypto';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { setupMcpEndpoints } from '../src/utils/http-server.ts';
import { createCalendarServer } from '../src/calendar/mcp-server.ts';

const BASE = process.env.TEST_CALDAV_URL ?? 'http://127.0.0.1:5232';
const USER = process.env.TEST_CALDAV_USER ?? 'caltest';
const PASSWORD = process.env.TEST_CALDAV_PASSWORD ?? 'secret';
const PORT = 3997;
/** Each run works in its own calendar, so the suite is rerunnable. */
const TAG = randomUUID().slice(0, 8);

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const json = (result: unknown): any => {
  const typed = result as { isError?: boolean; content: { text: string }[] };
  const text = typed.content[0]?.text ?? '';
  if (typed.isError === true) {
    throw new Error(`tool returned an error: ${text}`);
  }
  return JSON.parse(text);
};

const auth = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;

/** Creates a calendar collection to work in, the way a client would. */
async function createCalendar(): Promise<string> {
  const url = `${BASE}/${USER}/mcp-test-${TAG}/`;
  const response = await fetch(url, {
    method: 'MKCALENDAR',
    headers: { Authorization: auth, 'Content-Type': 'application/xml' },
    body: `<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set><D:prop><D:displayname>MCP Test ${TAG}</D:displayname></D:prop></D:set>
</C:mkcalendar>`,
  });
  assert(response.ok, `MKCALENDAR failed: ${response.status} ${await response.text()}`);
  return url;
}

/** Puts a weekly event straight on the server, so expansion has something to expand. */
async function seedWeeklyEvent(calendarUrl: string): Promise<void> {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//test//EN',
    'BEGIN:VEVENT',
    `UID:weekly-${TAG}`,
    'DTSTAMP:20260701T000000Z',
    'DTSTART:20260803T080000Z',
    'DTEND:20260803T083000Z',
    'RRULE:FREQ=WEEKLY;COUNT=6',
    `SUMMARY:Standup ${TAG}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const response = await fetch(`${calendarUrl}weekly-${TAG}.ics`, {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'text/calendar; charset=utf-8' },
    body: ics,
  });
  assert(response.ok, `seeding the weekly event failed: ${response.status}`);
}

async function main(): Promise<void> {
  const calendarUrl = await createCalendar();
  await seedWeeklyEvent(calendarUrl);

  const transports = new Map<string, StreamableHTTPServerTransport>();
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  setupMcpEndpoints(app, {
    serverName: 'mcp-calendar-test',
    version: '1.0.0',
    port: PORT,
    path: '/mcp/calendar',
    transports,
    createServer: () => {
      const server = createCalendarServer();
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: false,
        onsessioninitialized: (id: string): void => {
          transports.set(id, transport);
        },
      });
      return { server, transport };
    },
  });
  const http = app.listen(PORT, '127.0.0.1');

  const client = new Client({ name: 'mcp-calendar-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp/calendar`), {
      requestInit: {
        headers: {
          'X-User-Email': 'cal.suite@example.com',
          'X-Caldav-Url': BASE,
          'X-Caldav-Username': USER,
          'X-Caldav-Password': PASSWORD,
        },
      },
    }),
  );

  console.log('=== calendar ===\n');

  {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of [
      'list_calendars',
      'list_events',
      'read_event',
      'create_event',
      'update_event',
      'delete_event',
      'find_free_time',
    ]) {
      assert(names.includes(tool), `${tool} is registered`);
    }
    console.log('✓ all seven calendar tools are exposed');
  }

  let mine = '';
  {
    const result = json(await client.callTool({ name: 'list_calendars', arguments: {} }));
    const found = result.calendars.find((c: { name: string }) => c.name === `MCP Test ${TAG}`);
    assert(
      found != null,
      `discovery found this run's calendar, got ${result.calendars.map((c: { name: string }) => c.name).join(', ')}`,
    );
    assert(found.read_only === false, 'and reports it writable');
    mine = found.url;
    console.log(`✓ list_calendars discovers collections from the base URL alone`);
  }

  {
    /* The seeded series runs weekly from Mon 3 Aug, six times. */
    const twoWeeks = json(
      await client.callTool({
        name: 'list_events',
        arguments: { calendar: mine, from: '2026-08-03', to: '2026-08-17' },
      }),
    );
    assert(
      twoWeeks.events.length === 2,
      `a repeating event is expanded per occurrence, got ${twoWeeks.events.length}`,
    );
    assert(twoWeeks.events.every((e: { recurring: boolean }) => e.recurring), 'marked as recurring');
    assert(
      twoWeeks.events[0].start === '2026-08-03T08:00:00.000Z',
      `first occurrence at the series start, got ${twoWeeks.events[0].start}`,
    );
    assert(
      twoWeeks.events[1].start === '2026-08-10T08:00:00.000Z',
      `second one a week later, got ${twoWeeks.events[1].start}`,
    );

    const whole = json(
      await client.callTool({
        name: 'list_events',
        arguments: { calendar: mine, from: '2026-08-01', to: '2026-10-01' },
      }),
    );
    assert(whole.events.length === 6, `COUNT=6 is respected, got ${whole.events.length}`);

    const outside = json(
      await client.callTool({
        name: 'list_events',
        arguments: { calendar: mine, from: '2026-07-01', to: '2026-08-01' },
      }),
    );
    assert(outside.events.length === 0, `nothing before the series, got ${outside.events.length}`);
    console.log('✓ list_events expands a weekly series and respects the window');
  }

  let created = '';
  {
    const result = json(
      await client.callTool({
        name: 'create_event',
        arguments: {
          calendar: mine,
          summary: `Review ${TAG}`,
          start: '2026-08-04T14:00:00+02:00',
          end: '2026-08-04T15:30:00+02:00',
          description: 'Semicolons; commas, and\nnewlines need escaping',
          location: 'Room 2',
          attendees: ['someone@example.org'],
        },
      }),
    );
    created = result.url;
    assert(/\.ics$/.test(created), `the event URL is returned, got ${created}`);

    const listed = json(
      await client.callTool({
        name: 'list_events',
        arguments: { calendar: mine, from: '2026-08-04', to: '2026-08-05', search: 'Review' },
      }),
    );
    assert(listed.events.length === 1, `the new event is found, got ${listed.events.length}`);
    assert(
      listed.events[0].start === '2026-08-04T12:00:00.000Z',
      `the offset is honoured rather than dropped, got ${listed.events[0].start}`,
    );
    assert(listed.events[0].location === 'Room 2', 'the location survives');
    assert(
      listed.events[0].description === 'Semicolons; commas, and\nnewlines need escaping',
      `escaped text comes back intact, got ${JSON.stringify(listed.events[0].description)}`,
    );
    assert(
      listed.events[0].attendees?.[0] === 'someone@example.org',
      'the attendee comes back without the mailto prefix',
    );
    console.log('✓ create_event writes a timed event with escaping and offsets intact');
  }

  {
    const allDay = json(
      await client.callTool({
        name: 'create_event',
        arguments: {
          calendar: mine,
          summary: `Away ${TAG}`,
          start: '2026-08-06',
          end: '2026-08-07',
          all_day: true,
        },
      }),
    );
    const listed = json(
      await client.callTool({
        name: 'list_events',
        arguments: { calendar: mine, from: '2026-08-06', to: '2026-08-07', search: 'Away' },
      }),
    );
    assert(listed.events.length === 1, 'the all-day event is found');
    assert(listed.events[0].all_day === true, 'and reported as all-day');
    assert(
      listed.events[0].start === '2026-08-06',
      `with a plain date, got ${listed.events[0].start}`,
    );
    assert(allDay.url !== created, 'each event gets its own resource');
    console.log('✓ create_event writes an all-day event as a date, not a timestamp');
  }

  {
    const event = json(await client.callTool({ name: 'read_event', arguments: { url: created } }));
    assert(event.summary === `Review ${TAG}`, 'read_event returns the title');
    assert(typeof event.ics === 'string' && /BEGIN:VEVENT/.test(event.ics), 'and the raw object');
    console.log('✓ read_event returns one event in full');
  }

  {
    json(
      await client.callTool({
        name: 'update_event',
        arguments: { url: created, summary: `Review moved ${TAG}`, start: '2026-08-04T16:00:00+02:00', end: '2026-08-04T17:00:00+02:00' },
      }),
    );
    const event = json(await client.callTool({ name: 'read_event', arguments: { url: created } }));
    assert(event.summary === `Review moved ${TAG}`, 'the title changed');
    assert(
      event.start === '2026-08-04T14:00:00.000Z',
      `the new time took effect, got ${event.start}`,
    );
    assert(event.location === 'Room 2', 'what was not mentioned is kept');
    assert(
      event.attendees?.[0] === 'someone@example.org',
      'including the attendee, which a rebuild would have dropped',
    );
    console.log('✓ update_event changes only what it was given');
  }

  {
    /* Standup runs 08:00-08:30 UTC on 10 Aug; Review is on the 4th, so the 10th
     * has exactly one busy block. */
    const result = json(
      await client.callTool({
        name: 'find_free_time',
        arguments: {
          calendar: mine,
          from: '2026-08-10T06:00:00Z',
          to: '2026-08-10T12:00:00Z',
          duration_minutes: 60,
        },
      }),
    );
    assert(result.slots.length === 2, `the busy block splits the window, got ${result.slots.length}`);
    assert(result.slots[0].end === '2026-08-10T08:00:00.000Z', 'the first gap ends when the meeting starts');
    assert(result.slots[1].start === '2026-08-10T08:30:00.000Z', 'the second starts when it ends');
    assert(
      result.slots.every((s: { minutes: number }) => s.minutes >= 60),
      'nothing shorter than asked for is returned',
    );

    const long = json(
      await client.callTool({
        name: 'find_free_time',
        arguments: {
          calendar: mine,
          from: '2026-08-10T06:00:00Z',
          to: '2026-08-10T12:00:00Z',
          duration_minutes: 300,
        },
      }),
    );
    assert(long.slots.length === 0, `no gap is five hours long, got ${long.slots.length}`);
    console.log('✓ find_free_time returns the gaps around real events');
  }

  {
    json(await client.callTool({ name: 'delete_event', arguments: { url: created } }));
    const listed = json(
      await client.callTool({
        name: 'list_events',
        arguments: { calendar: mine, from: '2026-08-04', to: '2026-08-05', search: 'Review' },
      }),
    );
    assert(listed.events.length === 0, `the event is gone, got ${listed.events.length}`);
    console.log('✓ delete_event removes an event');
  }

  await client.close();

  {
    const bare = new Client({ name: 'mcp-calendar-test-bare', version: '1.0.0' });
    await bare.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp/calendar`), {
        requestInit: { headers: { 'X-User-Email': 'nobody@example.com' } },
      }),
    );
    const result = (await bare.callTool({ name: 'list_calendars', arguments: {} })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    assert(result.isError === true, 'a missing account is an error');
    assert(
      /server settings/.test(result.content[0].text),
      `and says where to fix it, got: ${result.content[0].text}`,
    );
    await bare.close();
    console.log('✓ an unconfigured account points at the settings, not at the chat');
  }

  http.close();
  console.log('\n=== All tests passed ===');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
