/**
 * Per-user CalDAV account, assembled from the request headers.
 *
 * Same shape as the mail account and for the same reasons: the credentials come
 * from LibreChat's encrypted per-user store on every request, nothing is written
 * to disk, nothing is cached, and the base URL is a deployment default that any
 * user can override.
 *
 * CalDAV, not the Nextcloud API - so this works against Nextcloud, Radicale,
 * Baikal, Fastmail and anything else that speaks the standard.
 */

export interface CalendarAccount {
  /** Base URL or a full principal/collection URL; discovery starts here. */
  baseUrl: string;
  username: string;
  password: string;
}

export class CalendarNotConfiguredError extends Error {}

type HeaderBag = Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '' || /^\{\{.*\}\}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function resolveCalendarAccount(headers: HeaderBag): CalendarAccount {
  const username = header(headers, 'x-caldav-username');
  const password = header(headers, 'x-caldav-password');
  const baseUrl = header(headers, 'x-caldav-url') ?? process.env.MCP_CALDAV_URL ?? null;

  if (username == null || password == null) {
    throw new CalendarNotConfiguredError(
      'No calendar account configured. Open the calendar server settings in LibreChat and enter your user name and an app password. Never paste it into the chat.',
    );
  }
  if (baseUrl == null) {
    throw new CalendarNotConfiguredError(
      'No calendar server known. Enter the CalDAV URL in the calendar server settings, for example "https://cloud.example.org", or have the operator set MCP_CALDAV_URL.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new CalendarNotConfiguredError(
      `"${baseUrl}" is not a URL. It should look like https://cloud.example.org`,
    );
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new CalendarNotConfiguredError(
      'The calendar URL must use https - the password is sent with every request.',
    );
  }

  return { baseUrl: parsed.toString().replace(/\/+$/, ''), username, password };
}

export function accountFromExtra(extra: unknown): CalendarAccount {
  const ctx = extra as { requestInfo?: { headers?: HeaderBag } } | undefined;
  const headers = ctx?.requestInfo?.headers;
  if (headers == null) {
    throw new CalendarNotConfiguredError(
      'No request headers available, so the calendar account cannot be resolved.',
    );
  }
  return resolveCalendarAccount(headers);
}
