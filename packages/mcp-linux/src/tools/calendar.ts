/**
 * Calendar tools over CalDAV.
 *
 * Credentials never appear in an argument - they arrive as per-user headers from
 * LibreChat's encrypted store, the same way the mail server gets them.
 *
 * Every tool takes and returns URLs rather than ids. A CalDAV event is addressed
 * by its resource URL, and handing that back is what lets a later update or
 * delete hit the right object without a second lookup.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { accountFromExtra, type CalendarAccount } from '../calendar/account.ts';
import {
  listCalendars,
  fetchRange,
  fetchObject,
  putObject,
  deleteObject,
  type CalendarCollection,
} from '../calendar/caldav.ts';
import {
  parseEvents,
  buildEvent,
  applyChanges,
  freeSlots,
  type EventSummary,
} from '../calendar/events.ts';
import { errorResult } from './helpers.ts';
import {
  ListCalendarsSchema,
  ListEventsSchema,
  ReadEventSchema,
  CreateEventSchema,
  UpdateEventSchema,
  DeleteEventSchema,
  FindFreeTimeSchema,
} from '../schemas/calendar.schema.ts';

const DEFAULT_EVENT_LIMIT = 50;

const asText = (result: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
});

function parseWindow(from: string, to: string): { from: Date; to: Date } {
  const start = new Date(/^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00Z` : from);
  const end = new Date(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T00:00:00Z` : to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(
      'from and to must be dates or ISO 8601 timestamps, e.g. "2026-08-01" or "2026-08-01T09:00:00+02:00"',
    );
  }
  if (end <= start) {
    throw new Error('to must be after from');
  }
  return { from: start, to: end };
}

/** Which calendars a range query should cover. */
async function targetCalendars(
  account: CalendarAccount,
  only: string | undefined,
): Promise<CalendarCollection[]> {
  if (only != null) {
    return [{ url: only, name: only, read_only: false }];
  }
  return listCalendars(account);
}

async function eventsInRange(
  account: CalendarAccount,
  calendars: CalendarCollection[],
  from: Date,
  to: Date,
): Promise<EventSummary[]> {
  const perCalendar = await Promise.all(
    calendars.map(async (calendar) => {
      const objects = await fetchRange(account, calendar.url, from, to);
      return parseEvents(objects, from, to).map((event) => ({
        ...event,
        calendar: calendar.name,
      }));
    }),
  );
  return perCalendar.flat().sort((a, b) => a.start.localeCompare(b.start));
}

export function registerCalendarTools(server: McpServer): void {
  server.registerTool(
    'list_calendars',
    {
      description:
        'List the calendars this account can see, with their URLs. Every other calendar tool takes one of those URLs, so start here. read_only marks calendars shared with the user that they cannot write to.',
      inputSchema: ListCalendarsSchema.shape,
    },
    async (_args, extra) => {
      try {
        const calendars = await listCalendars(accountFromExtra(extra));
        return asText({ calendars });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_events',
    {
      description:
        'List events in a time window, across all calendars or one. Repeating events are expanded, so each occurrence in the window appears once with its own times. Every event carries the URL needed to change or delete it.',
      inputSchema: ListEventsSchema.shape,
    },
    async (args, extra) => {
      try {
        const account = accountFromExtra(extra);
        const window = parseWindow(args.from, args.to);
        const calendars = await targetCalendars(account, args.calendar);
        let events = await eventsInRange(account, calendars, window.from, window.to);

        if (args.search != null && args.search !== '') {
          const needle = args.search.toLowerCase();
          events = events.filter((event) =>
            [event.summary, event.description, event.location]
              .filter((value): value is string => value != null)
              .some((value) => value.toLowerCase().includes(needle)),
          );
        }

        const limit = args.limit ?? DEFAULT_EVENT_LIMIT;
        return asText({
          from: window.from.toISOString(),
          to: window.to.toISOString(),
          calendars: calendars.length,
          total: events.length,
          returned: Math.min(events.length, limit),
          events: events.slice(0, limit),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'read_event',
    {
      description:
        'Read one event in full: description, location, attendees, status and, for a repeating event, its rule. Use the url from list_events.',
      inputSchema: ReadEventSchema.shape,
    },
    async (args, extra) => {
      try {
        const account = accountFromExtra(extra);
        const object = await fetchObject(account, args.url);
        /* A window wide enough that the first occurrence of anything is included. */
        const events = parseEvents(
          [object],
          new Date(0),
          new Date('2999-12-31T00:00:00Z'),
        );
        if (events.length === 0) {
          throw new Error('That calendar object holds no event.');
        }
        return asText({ ...events[0], ics: object.ics });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'create_event',
    {
      description:
        'Create an event. Times need an offset ("2026-08-01T09:00:00+02:00") so the event lands at the intended hour; the end is exclusive, and for an all-day event that means the day after the last one. Show the user what you are about to create before calling this - other people may see their calendar.',
      inputSchema: CreateEventSchema.shape,
    },
    async (args, extra) => {
      try {
        const account = accountFromExtra(extra);
        const { uid, ics } = buildEvent({
          summary: args.summary,
          start: args.start,
          end: args.end,
          ...(args.all_day != null ? { all_day: args.all_day } : {}),
          ...(args.description != null ? { description: args.description } : {}),
          ...(args.location != null ? { location: args.location } : {}),
          ...(args.attendees != null ? { attendees: args.attendees } : {}),
        });
        const url = `${args.calendar.replace(/\/+$/, '')}/${uid}.ics`;
        const written = await putObject(account, url, ics, { create: true });
        return asText({
          url: written.url,
          uid,
          summary: args.summary,
          start: args.start,
          end: args.end,
          all_day: args.all_day === true,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'update_event',
    {
      description:
        'Change an existing event. Pass only the fields that change; everything else - alarms, attendee replies, the repeat rule - is kept. If someone else changed the event in the meantime the call fails rather than overwriting them. Changing one occurrence of a repeating event changes the whole series.',
      inputSchema: UpdateEventSchema.shape,
    },
    async (args, extra) => {
      try {
        const account = accountFromExtra(extra);
        const object = await fetchObject(account, args.url);
        const updated = applyChanges(object.ics, {
          ...(args.summary != null ? { summary: args.summary } : {}),
          ...(args.start != null ? { start: args.start } : {}),
          ...(args.end != null ? { end: args.end } : {}),
          ...(args.all_day != null ? { all_day: args.all_day } : {}),
          ...(args.description != null ? { description: args.description } : {}),
          ...(args.location != null ? { location: args.location } : {}),
        });
        const written = await putObject(account, args.url, updated, {
          ...(object.etag != null ? { etag: object.etag } : {}),
        });
        const events = parseEvents(
          [{ url: args.url, ics: updated }],
          new Date(0),
          new Date('2999-12-31T00:00:00Z'),
        );
        return asText({ url: written.url, event: events[0] ?? null });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'delete_event',
    {
      description:
        'Delete an event. This is irreversible and, for a repeating event, removes the whole series - ask the user first.',
      inputSchema: DeleteEventSchema.shape,
    },
    async (args, extra) => {
      try {
        const account = accountFromExtra(extra);
        const object = await fetchObject(account, args.url).catch(() => null);
        await deleteObject(account, args.url, object?.etag);
        return asText({ url: args.url, deleted: true });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'find_free_time',
    {
      description:
        'Find the gaps in a window that are at least duration_minutes long, counting every calendar as busy unless one is named. All-day events block the whole day. Use this instead of reading a list of events and reasoning about the gaps yourself.',
      inputSchema: FindFreeTimeSchema.shape,
    },
    async (args, extra) => {
      try {
        const account = accountFromExtra(extra);
        const window = parseWindow(args.from, args.to);
        const calendars = await targetCalendars(account, args.calendar);
        const events = await eventsInRange(
          account,
          calendars,
          window.from,
          window.to,
        );
        const slots = freeSlots(
          events,
          window.from,
          window.to,
          args.duration_minutes,
        );
        return asText({
          from: window.from.toISOString(),
          to: window.to.toISOString(),
          duration_minutes: args.duration_minutes,
          busy_events: events.length,
          slots,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
