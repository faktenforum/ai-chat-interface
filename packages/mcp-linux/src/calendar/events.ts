/**
 * iCalendar in and out.
 *
 * Reading goes through ical.js, which knows about TZID references, floating
 * times and recurrence rules - none of which can be handled with string work.
 * Recurring events are expanded on the client rather than asking the server to
 * expand them: the CalDAV `expand` element is optional and servers disagree
 * about it, while every server returns the RRULE.
 *
 * Writing is done by hand, because a VEVENT is short and predictable and the
 * only two things that matter - escaping and 75-octet line folding - are easier
 * to get right explicitly than to verify through a library.
 */

import { randomUUID } from 'node:crypto';
import ICAL from 'ical.js';
import type { CalendarObject } from './caldav.ts';

export interface EventSummary {
  /** URL of the .ics resource; the handle for update_event and delete_event. */
  url: string;
  uid: string;
  summary: string;
  /** ISO 8601 with offset, or YYYY-MM-DD when all_day. */
  start: string;
  end: string;
  all_day: boolean;
  location?: string;
  description?: string;
  organizer?: string;
  attendees?: string[];
  status?: string;
  /** True when this is one occurrence of a repeating event. */
  recurring: boolean;
  etag?: string;
}

/** A repeating event cannot be expanded forever; a range still needs a ceiling. */
const MAX_OCCURRENCES_PER_EVENT = 200;

function timeToString(time: ICAL.Time): string {
  if (time.isDate) {
    return time.toString().slice(0, 10);
  }
  return time.toJSDate().toISOString();
}

function personText(value: string | null | undefined): string | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  return value.replace(/^mailto:/i, '');
}

function summarize(
  event: ICAL.Event,
  object: CalendarObject,
  start: ICAL.Time,
  end: ICAL.Time,
  recurring: boolean,
): EventSummary {
  const attendees = event.attendees
    .map((attendee) => personText(attendee.getFirstValue() as string))
    .filter((value): value is string => value != null);

  return {
    url: object.url,
    uid: event.uid,
    summary: event.summary ?? '',
    start: timeToString(start),
    end: timeToString(end),
    all_day: start.isDate === true,
    ...(event.location != null && event.location !== ''
      ? { location: event.location }
      : {}),
    ...(event.description != null && event.description !== ''
      ? { description: event.description }
      : {}),
    ...(personText(event.organizer) != null
      ? { organizer: personText(event.organizer) as string }
      : {}),
    ...(attendees.length > 0 ? { attendees } : {}),
    ...(event.component.getFirstPropertyValue('status') != null
      ? { status: String(event.component.getFirstPropertyValue('status')) }
      : {}),
    recurring,
    ...(object.etag != null ? { etag: object.etag } : {}),
  };
}

/**
 * Turns raw calendar objects into concrete occurrences inside [from, to).
 *
 * The server's time-range filter already selected the objects; the expansion
 * here is what turns "every Monday" into the Mondays that actually fall in the
 * window.
 */
export function parseEvents(
  objects: CalendarObject[],
  from: Date,
  to: Date,
): EventSummary[] {
  const results: EventSummary[] = [];
  const rangeStart = ICAL.Time.fromJSDate(from, true);
  const rangeEnd = ICAL.Time.fromJSDate(to, true);

  for (const object of objects) {
    let component: ICAL.Component;
    try {
      component = new ICAL.Component(ICAL.parse(object.ics));
    } catch {
      /* A single unparseable object must not take the whole listing down. */
      continue;
    }

    for (const vevent of component.getAllSubcomponents('vevent')) {
      let event: ICAL.Event;
      try {
        event = new ICAL.Event(vevent);
      } catch {
        continue;
      }

      /* Overrides of a recurring event carry RECURRENCE-ID and are emitted by the
       * iterator of the master event, so listing them again would double them. */
      if (event.isRecurrenceException()) {
        continue;
      }

      if (!event.isRecurring()) {
        results.push(summarize(event, object, event.startDate, event.endDate, false));
        continue;
      }

      const duration = event.duration;
      const iterator = event.iterator();
      let occurrence = iterator.next();
      let emitted = 0;
      while (occurrence != null && emitted < MAX_OCCURRENCES_PER_EVENT) {
        if (occurrence.compare(rangeEnd) >= 0) {
          break;
        }
        const occurrenceEnd = occurrence.clone();
        occurrenceEnd.addDuration(duration);
        if (occurrenceEnd.compare(rangeStart) > 0) {
          const details = event.getOccurrenceDetails(occurrence);
          results.push(
            summarize(
              new ICAL.Event(details.item.component),
              object,
              details.startDate,
              details.endDate,
              true,
            ),
          );
          emitted += 1;
        }
        occurrence = iterator.next();
      }
    }
  }

  return results.sort((a, b) => a.start.localeCompare(b.start));
}

/** RFC 5545 escaping for a text value. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Content lines are folded at 75 octets, counted in bytes and not characters. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) {
    return line;
  }
  const parts: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let take = Math.min(75 - (parts.length > 0 ? 1 : 0), bytes.length - offset);
    /* Never split a multi-byte character: back off until the slice decodes cleanly. */
    while (take > 1) {
      const slice = bytes.subarray(offset, offset + take);
      if (!slice.toString('utf8').includes('�')) {
        break;
      }
      take -= 1;
    }
    parts.push(
      (parts.length > 0 ? ' ' : '') + bytes.subarray(offset, offset + take).toString('utf8'),
    );
    offset += take;
  }
  return parts.join('\r\n');
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export interface EventInput {
  summary: string;
  /** ISO 8601 with offset, or YYYY-MM-DD for an all-day event. */
  start: string;
  end: string;
  all_day?: boolean;
  description?: string;
  location?: string;
  attendees?: string[];
}

function dateValue(value: string, allDay: boolean, label: string): string {
  if (allDay) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match == null) {
      throw new Error(`${label} must be a date like 2026-08-01 for an all-day event`);
    }
    return `${match[1]}${match[2]}${match[3]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `${label} is not a date and time. Use ISO 8601 with an offset, e.g. 2026-08-01T09:00:00+02:00`,
    );
  }
  return stamp(date);
}

/**
 * Builds a complete VCALENDAR for a new event. The uid doubles as the file name,
 * which is what makes the create idempotent from the caller's side.
 */
export function buildEvent(input: EventInput, now = new Date()): {
  uid: string;
  ics: string;
} {
  const uid = randomUUID();
  const allDay = input.all_day === true;
  const suffix = allDay ? ';VALUE=DATE' : '';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//faktenforum//mcp-calendar//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART${suffix}:${dateValue(input.start, allDay, 'start')}`,
    `DTEND${suffix}:${dateValue(input.end, allDay, 'end')}`,
    `SUMMARY:${escapeText(input.summary)}`,
    ...(input.description != null
      ? [`DESCRIPTION:${escapeText(input.description)}`]
      : []),
    ...(input.location != null ? [`LOCATION:${escapeText(input.location)}`] : []),
    ...(input.attendees ?? []).map(
      (attendee) =>
        `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${attendee.replace(/^mailto:/i, '')}`,
    ),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return { uid, ics: lines.map(fold).join('\r\n') + '\r\n' };
}

export interface EventChanges {
  summary?: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  description?: string;
  location?: string;
}

/**
 * Applies changes to an existing object, keeping everything the caller did not
 * mention - alarms, attendee replies, recurrence rules, custom properties. A
 * rebuild from scratch would silently drop all of it.
 */
export function applyChanges(
  ics: string,
  changes: EventChanges,
  now = new Date(),
): string {
  const component = new ICAL.Component(ICAL.parse(ics));
  const vevent = component.getFirstSubcomponent('vevent');
  if (vevent == null) {
    throw new Error('That calendar object holds no event.');
  }

  if (changes.summary != null) {
    vevent.updatePropertyWithValue('summary', changes.summary);
  }
  if (changes.description != null) {
    vevent.updatePropertyWithValue('description', changes.description);
  }
  if (changes.location != null) {
    vevent.updatePropertyWithValue('location', changes.location);
  }

  const existingStart = vevent.getFirstPropertyValue('dtstart') as ICAL.Time | null;
  const allDay = changes.all_day ?? existingStart?.isDate ?? false;

  const setTime = (name: 'dtstart' | 'dtend', value: string): void => {
    const time = allDay
      ? ICAL.Time.fromDateString(value.slice(0, 10))
      : ICAL.Time.fromJSDate(new Date(value), true);
    vevent.removeAllProperties(name);
    const property = new ICAL.Property(name, vevent);
    property.setValue(time);
    vevent.addProperty(property);
  };

  if (changes.start != null) {
    setTime('dtstart', changes.start);
  }
  if (changes.end != null) {
    setTime('dtend', changes.end);
  }

  /* A change the server has not seen needs a new DTSTAMP, and clients use
   * SEQUENCE to decide whose copy is newer. */
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(now, true));
  const sequence = Number(vevent.getFirstPropertyValue('sequence') ?? 0);
  vevent.updatePropertyWithValue('sequence', sequence + 1);

  return component.toString();
}

export interface FreeSlot {
  start: string;
  end: string;
  minutes: number;
}

/**
 * The gaps between busy blocks inside a window. All-day events are treated as
 * busy for the whole day, which is what a reader means by "I am away Friday".
 */
export function freeSlots(
  events: EventSummary[],
  from: Date,
  to: Date,
  minimumMinutes: number,
): FreeSlot[] {
  const busy = events
    .filter((event) => event.status !== 'CANCELLED')
    .map((event) => {
      const start = event.all_day
        ? new Date(`${event.start}T00:00:00Z`)
        : new Date(event.start);
      const end = event.all_day
        ? new Date(`${event.end}T00:00:00Z`)
        : new Date(event.end);
      return { start, end };
    })
    .filter((block) => block.end > from && block.start < to)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: { start: Date; end: Date }[] = [];
  for (const block of busy) {
    const last = merged[merged.length - 1];
    if (last != null && block.start <= last.end) {
      if (block.end > last.end) {
        last.end = block.end;
      }
      continue;
    }
    merged.push({ start: new Date(block.start), end: new Date(block.end) });
  }

  const slots: FreeSlot[] = [];
  let cursor = from;
  for (const block of [...merged, { start: to, end: to }]) {
    const gapEnd = block.start < to ? block.start : to;
    const minutes = Math.floor((gapEnd.getTime() - cursor.getTime()) / 60000);
    if (minutes >= minimumMinutes) {
      slots.push({
        start: cursor.toISOString(),
        end: gapEnd.toISOString(),
        minutes,
      });
    }
    if (block.end > cursor) {
      cursor = block.end;
    }
    if (cursor >= to) {
      break;
    }
  }

  return slots;
}
