/**
 * The calendar MCP server.
 *
 * Separate from the mail server even though both are "the user's personal data":
 * they need different credentials, and LibreChat gates credentials per server, so
 * combining them would mean nobody gets a calendar until they also set up mail.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCalendarTools } from '../tools/calendar.ts';

export const CALENDAR_SERVER_NAME = 'mcp-calendar-server';

export function createCalendarServer(): McpServer {
  const server = new McpServer(
    {
      name: CALENDAR_SERVER_NAME,
      version: '1.0.0',
    },
    {
      capabilities: { tools: {} },
      instructions: `You can read and change the user's calendars over CalDAV.

CREDENTIALS
- The user name and password are configured in this server's settings in LibreChat, stored encrypted, and sent with each request. You never see them.
- Never ask the user to type a password into the chat. If a tool reports that no account is configured, tell them to open the calendar server settings and enter it there.

READING
- list_calendars first: every other tool takes a calendar URL, and those URLs cannot be guessed. It also tells you which calendars are read-only.
- list_events needs a window (from, to). Repeating events are expanded, so each occurrence appears with its own times. Without a calendar argument it covers all of them.
- Dates without a time are read as UTC midnight. When the user says "tomorrow", work out the actual date first and pass it explicitly.
- find_free_time answers "when could we meet" directly. Use it instead of listing events and reasoning about gaps yourself - it merges overlapping events and treats all-day events as busy for the whole day.

WRITING
- Always show the user the title, the day and the time before you create or change anything. A calendar is often shared, so a wrong entry is visible to other people.
- Times need an offset: "2026-08-01T09:00:00+02:00". Without one the event lands in UTC and shows up at the wrong hour.
- The end is exclusive. An all-day event on 1 August runs from 2026-08-01 to 2026-08-02.
- update_event keeps everything you do not mention - alarms, attendee replies, the repeat rule. Pass only what changes. If someone else changed the event first, the call fails instead of overwriting them; read it again and reapply.
- update_event and delete_event affect the whole series of a repeating event, not the single occurrence you looked at. Say so before doing it.
- delete_event is irreversible. Ask first.`,
    },
  );

  registerCalendarTools(server);
  return server;
}
