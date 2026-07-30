/**
 * CalDAV client: discovery, reading a time range, and writing events.
 *
 * Written against RFC 4791 rather than any one server's API, so Nextcloud,
 * Radicale, Baikal and Fastmail all work the same way. Discovery follows the
 * standard chain - well-known URI, current-user-principal, calendar-home-set,
 * then the collections in that home - because none of those paths can be
 * guessed reliably: Nextcloud puts calendars under /remote.php/dav/calendars/,
 * Radicale under a bare user path, and both are configurable.
 */

import { XMLParser } from 'fast-xml-parser';
import type { CalendarAccount } from './account.ts';

const DAV_NS = 'DAV:';
const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav';
const APPLE_NS = 'http://apple.com/ns/ical/';

export interface CalendarCollection {
  /** Absolute URL of the collection; every other call takes this. */
  url: string;
  name: string;
  color?: string;
  description?: string;
  read_only: boolean;
}

export interface CalendarObject {
  /** Absolute URL of the .ics resource - the handle for update and delete. */
  url: string;
  etag?: string;
  ics: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function authHeader(account: CalendarAccount): string {
  const token = Buffer.from(`${account.username}:${account.password}`).toString('base64');
  return `Basic ${token}`;
}

async function request(
  account: CalendarAccount,
  url: string,
  init: {
    method: string;
    body?: string;
    headers?: Record<string, string>;
    /** PROPFIND and REPORT need a Depth; PUT and DELETE must not send one. */
    depth?: string;
  },
): Promise<Response> {
  const response = await fetch(url, {
    method: init.method,
    headers: {
      Authorization: authHeader(account),
      ...(init.depth != null ? { Depth: init.depth } : {}),
      ...(init.body != null ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}),
      ...init.headers,
    },
    ...(init.body != null ? { body: init.body } : {}),
    redirect: 'follow',
  });

  if (response.status === 401) {
    throw new Error(
      'The calendar server rejected the credentials. Check the user name and app password in the calendar server settings.',
    );
  }
  return response;
}

/** Every href in a multistatus, paired with the properties that came back OK. */
interface PropfindEntry {
  href: string;
  props: Record<string, unknown>;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function parseMultistatus(xml: string): PropfindEntry[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const multistatus = (parsed.multistatus ?? {}) as Record<string, unknown>;
  return asArray(multistatus.response as Record<string, unknown>[]).map((response) => {
    const props: Record<string, unknown> = {};
    for (const propstat of asArray(response.propstat as Record<string, unknown>[])) {
      const status = String(propstat.status ?? '');
      /* A 404 propstat means "I do not have that property", not an error. */
      if (!/\s2\d\d\s/.test(status)) {
        continue;
      }
      Object.assign(props, (propstat.prop ?? {}) as Record<string, unknown>);
    }
    return { href: String(response.href ?? ''), props };
  });
}

function absolute(base: string, href: string): string {
  return new URL(href, base).toString();
}

function firstHref(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  const record = value as Record<string, unknown>;
  const href = record.href;
  if (typeof href === 'string') {
    return href;
  }
  const list = asArray(href as string[]);
  return list.length > 0 ? String(list[0]) : null;
}

/**
 * Resolves the calendar home from whatever the user pasted: a bare hostname, a
 * principal URL, or the calendar home itself.
 */
async function findCalendarHome(account: CalendarAccount): Promise<string> {
  const candidates = [account.baseUrl, `${account.baseUrl}/.well-known/caldav`];

  for (const candidate of candidates) {
    const response = await request(account, candidate, {
      method: 'PROPFIND',
      depth: '0',
      body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}">
  <d:prop><d:current-user-principal/><c:calendar-home-set/></d:prop>
</d:propfind>`,
    });
    if (!response.ok && response.status !== 207) {
      continue;
    }

    const entries = parseMultistatus(await response.text());
    const props = entries[0]?.props ?? {};

    const home = firstHref(props['calendar-home-set']);
    if (home != null) {
      return absolute(candidate, home);
    }

    const principal = firstHref(props['current-user-principal']);
    if (principal == null) {
      continue;
    }
    const principalUrl = absolute(candidate, principal);
    const homeResponse = await request(account, principalUrl, {
      method: 'PROPFIND',
      depth: '0',
      body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`,
    });
    const homeHref = firstHref(
      parseMultistatus(await homeResponse.text())[0]?.props['calendar-home-set'],
    );
    if (homeHref != null) {
      return absolute(principalUrl, homeHref);
    }
  }

  throw new Error(
    `Could not find a calendar home under ${account.baseUrl}. Check the URL - for Nextcloud the base URL of the instance is enough, e.g. https://cloud.example.org`,
  );
}

function isCalendar(props: Record<string, unknown>): boolean {
  const resourceType = props.resourcetype as Record<string, unknown> | undefined;
  if (resourceType == null || !('calendar' in resourceType)) {
    return false;
  }
  /* A calendar that only holds todos or journals is not one we can show events from. */
  const supported = props['supported-calendar-component-set'] as
    | Record<string, unknown>
    | undefined;
  if (supported == null) {
    return true;
  }
  const comps = asArray(supported.comp as Record<string, string>[]);
  return comps.length === 0 || comps.some((comp) => comp['@_name'] === 'VEVENT');
}

function isReadOnly(props: Record<string, unknown>): boolean {
  const privilegeSet = props['current-user-privilege-set'] as
    | Record<string, unknown>
    | undefined;
  if (privilegeSet == null) {
    return false;
  }
  const privileges = asArray(privilegeSet.privilege as Record<string, unknown>[]);
  if (privileges.length === 0) {
    return false;
  }
  return !privileges.some((privilege) => 'write' in privilege || 'write-content' in privilege);
}

export async function listCalendars(
  account: CalendarAccount,
): Promise<CalendarCollection[]> {
  const home = await findCalendarHome(account);
  const response = await request(account, home, {
    method: 'PROPFIND',
    depth: '1',
    body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}" xmlns:a="${APPLE_NS}">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <d:current-user-privilege-set/>
    <c:calendar-description/>
    <c:supported-calendar-component-set/>
    <a:calendar-color/>
  </d:prop>
</d:propfind>`,
  });

  if (!response.ok && response.status !== 207) {
    throw new Error(`Listing calendars failed: ${response.status} ${response.statusText}`);
  }

  return parseMultistatus(await response.text())
    .filter((entry) => isCalendar(entry.props))
    .map((entry) => {
      const url = absolute(home, entry.href);
      const name = String(entry.props.displayname ?? '') || decodeURIComponent(url.replace(/\/$/, '').split('/').pop() ?? url);
      const color = entry.props['calendar-color'];
      const description = entry.props['calendar-description'];
      return {
        url,
        name,
        ...(typeof color === 'string' && color !== '' ? { color } : {}),
        ...(typeof description === 'string' && description !== ''
          ? { description }
          : {}),
        read_only: isReadOnly(entry.props),
      };
    });
}

/** Fetches the raw iCalendar objects overlapping a time range. */
export async function fetchRange(
  account: CalendarAccount,
  calendarUrl: string,
  from: Date,
  to: Date,
): Promise<CalendarObject[]> {
  const response = await request(account, calendarUrl, {
    method: 'REPORT',
    depth: '1',
    body: `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${icalDateTime(from)}" end="${icalDateTime(to)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`,
  });

  if (!response.ok && response.status !== 207) {
    throw new Error(
      `Reading ${calendarUrl} failed: ${response.status} ${response.statusText}`,
    );
  }

  return parseMultistatus(await response.text())
    .filter((entry) => typeof entry.props['calendar-data'] === 'string')
    .map((entry) => ({
      url: absolute(calendarUrl, entry.href),
      ...(typeof entry.props.getetag === 'string'
        ? { etag: entry.props.getetag }
        : {}),
      ics: String(entry.props['calendar-data']),
    }));
}

export async function fetchObject(
  account: CalendarAccount,
  url: string,
): Promise<CalendarObject> {
  const response = await request(account, url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Reading ${url} failed: ${response.status} ${response.statusText}`);
  }
  const etag = response.headers.get('etag');
  return {
    url,
    ...(etag != null ? { etag } : {}),
    ics: await response.text(),
  };
}

export async function putObject(
  account: CalendarAccount,
  url: string,
  ics: string,
  options: { etag?: string; create?: boolean } = {},
): Promise<{ url: string; etag?: string }> {
  const response = await request(account, url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      /* Guards against overwriting a change someone else made in the meantime. */
      ...(options.create === true ? { 'If-None-Match': '*' } : {}),
      ...(options.etag != null ? { 'If-Match': options.etag } : {}),
    },
    body: ics,
  });

  if (response.status === 412) {
    throw new Error(
      'The event changed on the server since it was read. Read it again and reapply the change.',
    );
  }
  if (!response.ok) {
    throw new Error(
      `Writing ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
  const etag = response.headers.get('etag');
  return { url, ...(etag != null ? { etag } : {}) };
}

export async function deleteObject(
  account: CalendarAccount,
  url: string,
  etag?: string,
): Promise<void> {
  const response = await request(account, url, {
    method: 'DELETE',
    headers: etag != null ? { 'If-Match': etag } : {},
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Deleting ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
}

/** UTC form CalDAV expects in a time-range filter: 20260801T090000Z. */
export function icalDateTime(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}
