/**
 * Per-user mail account, assembled from the request headers.
 *
 * The credentials arrive on every request as LibreChat customUserVars, which it
 * stores encrypted per user - nothing is written to disk here and nothing is
 * cached between requests, so a changed or revoked password takes effect on the
 * next call.
 *
 * Hosts are deliberately not hardcoded. An operator can set MCP_MAIL_IMAP and
 * MCP_MAIL_SMTP so the whole company only fills in address and password, and any
 * user can still override them for a different provider.
 */

export interface MailEndpoint {
  host: string;
  port: number;
  /** Implicit TLS from the first byte, as on 993 and 465. */
  secure: boolean;
}

export interface MailAccount {
  /** The address mail is sent from and, unless overridden, logged in with. */
  address: string;
  login: string;
  password: string;
  imap: MailEndpoint;
  smtp: MailEndpoint;
  /** Display name for the From header, e.g. "Pascal Garber | CORRECTIV". */
  fromName?: string;
}

export class MailNotConfiguredError extends Error {}

type HeaderBag = Record<string, string | string[] | undefined>;

/** Ports that speak TLS immediately; everything else is upgraded with STARTTLS. */
const IMPLICIT_TLS_PORTS = new Set([993, 465]);
const DEFAULT_IMAP_PORT = 993;
const DEFAULT_SMTP_PORT = 465;

function header(headers: HeaderBag, name: string): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  /* An unset customUserVar can arrive as the literal placeholder; that is not a value. */
  if (trimmed === '' || /^\{\{.*\}\}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Parses `host`, `host:port`, `imaps://host:port` and `imap://host:143`.
 *
 * A scheme decides TLS explicitly; without one the port decides, which is what
 * every mail client does and what the numbers in a provider's setup page mean.
 */
export function parseEndpoint(raw: string, defaultPort: number): MailEndpoint {
  let rest = raw.trim();
  let secure: boolean | null = null;

  const scheme = /^([a-z]+):\/\//i.exec(rest);
  if (scheme != null) {
    const name = scheme[1].toLowerCase();
    if (name === 'imaps' || name === 'smtps') {
      secure = true;
    } else if (name === 'imap' || name === 'smtp') {
      secure = false;
    } else {
      throw new MailNotConfiguredError(
        `Unknown scheme "${name}" in "${raw}". Use imap://, imaps://, smtp://, smtps:// or plain host:port.`,
      );
    }
    rest = rest.slice(scheme[0].length);
  }

  rest = rest.replace(/\/+$/, '');
  const colon = rest.lastIndexOf(':');
  const host = colon > 0 ? rest.slice(0, colon) : rest;
  const portText = colon > 0 ? rest.slice(colon + 1) : '';

  if (host === '') {
    throw new MailNotConfiguredError(`No host in "${raw}"`);
  }

  let port = defaultPort;
  if (portText !== '') {
    port = parseInt(portText, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new MailNotConfiguredError(`Invalid port "${portText}" in "${raw}"`);
    }
  }

  return { host, port, secure: secure ?? IMPLICIT_TLS_PORTS.has(port) };
}

/**
 * Whether transport security may be relaxed: certificate checks off, and no
 * insistence on a STARTTLS upgrade. Exists for test servers - GreenMail's plain
 * ports offer neither a valid certificate nor STARTTLS.
 *
 * Never set MCP_MAIL_TLS_INSECURE against a real mailbox. It removes the only
 * protection the password has in transit.
 */
export function insecureTransportAllowed(): boolean {
  return process.env.MCP_MAIL_TLS_INSECURE === 'true';
}

export function tlsRejectUnauthorized(): boolean {
  return !insecureTransportAllowed();
}

export function resolveMailAccount(headers: HeaderBag): MailAccount {
  const address = header(headers, 'x-mail-address');
  const password = header(headers, 'x-mail-password');

  if (address == null || password == null) {
    throw new MailNotConfiguredError(
      'No mail account configured. Open the mail server settings in LibreChat and enter your address and password (an app password where the provider offers one). Never paste it into the chat.',
    );
  }

  const imapText =
    header(headers, 'x-mail-imap') ?? process.env.MCP_MAIL_IMAP ?? null;
  const smtpText =
    header(headers, 'x-mail-smtp') ?? process.env.MCP_MAIL_SMTP ?? null;

  if (imapText == null || smtpText == null) {
    throw new MailNotConfiguredError(
      'No mail server known. Enter the IMAP and SMTP host in the mail server settings, for example "mail.example.org:993" and "mail.example.org:465", or have the operator set MCP_MAIL_IMAP and MCP_MAIL_SMTP.',
    );
  }

  return {
    address,
    login: header(headers, 'x-mail-login') ?? address,
    password,
    imap: parseEndpoint(imapText, DEFAULT_IMAP_PORT),
    smtp: parseEndpoint(smtpText, DEFAULT_SMTP_PORT),
    ...(header(headers, 'x-mail-from-name') != null
      ? { fromName: header(headers, 'x-mail-from-name') as string }
      : {}),
  };
}

/** Reads the account out of an MCP tool's request context. */
export function accountFromExtra(extra: unknown): MailAccount {
  const ctx = extra as { requestInfo?: { headers?: HeaderBag } } | undefined;
  const headers = ctx?.requestInfo?.headers;
  if (headers == null) {
    throw new MailNotConfiguredError(
      'No request headers available, so the mail account cannot be resolved.',
    );
  }
  return resolveMailAccount(headers);
}
