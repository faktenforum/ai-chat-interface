/**
 * Schemas for the calendar tools.
 */

import { z } from 'zod';

const calendarField = z
  .string()
  .url()
  .describe('Calendar URL from list_calendars');

const eventField = z
  .string()
  .url()
  .describe('Event URL from list_events (the .ics resource)');

const rangeFields = {
  from: z
    .string()
    .describe('Start of the window, e.g. "2026-08-01" or "2026-08-01T09:00:00+02:00"'),
  to: z.string().describe('End of the window, exclusive'),
};

export const ListCalendarsSchema = z.object({});

export const ListEventsSchema = z.object({
  ...rangeFields,
  calendar: z
    .string()
    .url()
    .optional()
    .describe('Only this calendar. Without it, every calendar the user has.'),
  search: z
    .string()
    .optional()
    .describe('Only events whose title, description or location contains this text'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Max events to return (default 50)'),
});

export const ReadEventSchema = z.object({
  url: eventField,
});

export const CreateEventSchema = z.object({
  calendar: calendarField,
  summary: z.string().min(1).describe('Title'),
  start: z
    .string()
    .describe(
      'Start. ISO 8601 with an offset for a timed event ("2026-08-01T09:00:00+02:00"), or a date for an all-day one.',
    ),
  end: z.string().describe('End, exclusive. For an all-day event, the day after the last one.'),
  all_day: z.boolean().optional().describe('All-day event (default false)'),
  description: z.string().optional().describe('Notes'),
  location: z.string().optional().describe('Place, room or link'),
  attendees: z
    .array(z.string())
    .optional()
    .describe(
      'Invitee addresses. Whether invitations are actually sent is up to the server.',
    ),
});

export const UpdateEventSchema = z.object({
  url: eventField,
  summary: z.string().optional().describe('New title'),
  start: z.string().optional().describe('New start'),
  end: z.string().optional().describe('New end'),
  all_day: z.boolean().optional().describe('Switch between all-day and timed'),
  description: z.string().optional().describe('New notes'),
  location: z.string().optional().describe('New place'),
});

export const DeleteEventSchema = z.object({
  url: eventField,
});

export const FindFreeTimeSchema = z.object({
  ...rangeFields,
  duration_minutes: z
    .number()
    .int()
    .min(5)
    .describe('How long the slot has to be'),
  calendar: z
    .string()
    .url()
    .optional()
    .describe('Only consider this calendar. Without it, every calendar counts as busy.'),
});
