/**
 * IMAP access for the mail server.
 *
 * Every call opens its own connection and logs out again. That costs a few
 * hundred milliseconds but keeps the server stateless: no pooled sockets to go
 * stale between turns, no credentials held in memory after a request, and a
 * revoked password stops working immediately.
 *
 * Responses are kept small on purpose. Mail is long and the model pays for every
 * character twice - once on the way in, once in the context of the next tool
 * round - so bodies are capped and attachments are listed rather than fetched.
 */

import { ImapFlow } from 'imapflow';
import type { ListResponse, MessageStructureObject } from 'imapflow';
import { convert as htmlToText } from 'html-to-text';
import { capOutput, type CappedOutput } from '../utils/cap-output.ts';
import { tlsRejectUnauthorized, type MailAccount } from './account.ts';

export interface MailboxSummary {
  path: string;
  name: string;
  /** \Sent, \Drafts, \Trash, \Junk, \Archive - set when the server says so. */
  special_use?: string;
  messages?: number;
  unseen?: number;
}

export interface AttachmentInfo {
  /** IMAP body part, e.g. "2" or "1.3". Needed to save the attachment. */
  part: string;
  filename: string;
  content_type: string;
  size?: number;
}

export interface MessageSummary {
  uid: number;
  subject: string;
  from: string;
  to: string[];
  date: string | null;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  size?: number;
  attachment_count: number;
}

export interface MessageDetail extends MessageSummary, CappedOutput {
  cc: string[];
  reply_to: string[];
  message_id?: string;
  in_reply_to?: string;
  /** "text" or "html" - html means there was no plain-text alternative. */
  body_source: 'text' | 'html' | 'none';
  attachments: AttachmentInfo[];
}

/** Long enough for a real mail, short enough not to eat the minute's tokens. */
const DEFAULT_BODY_CHARS = 8_000;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function bodyCharLimit(): number {
  const configured = parseInt(process.env.MCP_MAIL_MAX_BODY_CHARS || '', 10);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_BODY_CHARS;
}

export async function withImap<T>(
  account: MailAccount,
  run: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    auth: { user: account.login, pass: account.password },
    /* imapflow logs every command at info level, including the login line. */
    logger: false,
    tls: { rejectUnauthorized: tlsRejectUnauthorized() },
  });

  await client.connect();
  try {
    return await run(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

interface AddressLike {
  name?: string;
  address?: string;
}

function formatAddress(entry: AddressLike | undefined): string {
  if (entry == null) {
    return '';
  }
  const address = entry.address ?? '';
  const name = entry.name?.trim();
  return name != null && name !== '' && name !== address
    ? `${name} <${address}>`
    : address;
}

function formatAddresses(entries: AddressLike[] | undefined): string[] {
  return (entries ?? []).map(formatAddress).filter((value) => value !== '');
}

/** Walks the body structure, collecting anything a reader would call a file. */
function collectAttachments(
  node: MessageStructureObject | undefined,
  found: AttachmentInfo[] = [],
): AttachmentInfo[] {
  if (node == null) {
    return found;
  }
  if (node.childNodes != null && node.childNodes.length > 0) {
    for (const child of node.childNodes) {
      collectAttachments(child, found);
    }
    return found;
  }

  const filename =
    node.dispositionParameters?.filename ?? node.parameters?.name ?? null;
  const isAttachment =
    node.disposition?.toLowerCase() === 'attachment' || filename != null;
  if (!isAttachment || node.part == null) {
    return found;
  }

  found.push({
    part: node.part,
    filename: filename ?? `part-${node.part}`,
    content_type: node.type,
    ...(node.size != null ? { size: node.size } : {}),
  });
  return found;
}

/**
 * Picks the part to show. Plain text wins; HTML is converted only when there is
 * no alternative, because the conversion loses structure.
 */
function pickBodyPart(
  node: MessageStructureObject | undefined,
): { part: string; type: 'text' | 'html' } | null {
  if (node == null) {
    return null;
  }
  if (node.childNodes != null && node.childNodes.length > 0) {
    let html: { part: string; type: 'text' | 'html' } | null = null;
    for (const child of node.childNodes) {
      const found = pickBodyPart(child);
      if (found == null) {
        continue;
      }
      if (found.type === 'text') {
        return found;
      }
      html ??= found;
    }
    return html;
  }

  if (node.disposition?.toLowerCase() === 'attachment' || node.part == null) {
    return null;
  }
  if (node.type === 'text/plain') {
    return { part: node.part, type: 'text' };
  }
  if (node.type === 'text/html') {
    return { part: node.part, type: 'html' };
  }
  return null;
}

async function readStream(stream: AsyncIterable<Buffer>): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  /* Stop reading once the cap is reached; a 5 MB HTML newsletter is not worth the wait. */
  const ceiling = bodyCharLimit() * 4;
  for await (const chunk of stream) {
    chunks.push(chunk);
    total += chunk.length;
    if (total >= ceiling) {
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function mailboxSummary(entry: ListResponse): MailboxSummary {
  return {
    path: entry.path,
    name: entry.name,
    ...(entry.specialUse != null ? { special_use: entry.specialUse } : {}),
    ...(entry.status?.messages != null ? { messages: entry.status.messages } : {}),
    ...(entry.status?.unseen != null ? { unseen: entry.status.unseen } : {}),
  };
}

export async function listMailboxes(
  account: MailAccount,
): Promise<{ mailboxes: MailboxSummary[] }> {
  return withImap(account, async (client) => {
    const entries = await client.list({
      statusQuery: { messages: true, unseen: true },
    });
    return { mailboxes: entries.map(mailboxSummary) };
  });
}

export interface ListMessagesOptions {
  mailbox: string;
  limit?: number;
  offset?: number;
  unread_only?: boolean;
  from?: string;
  subject?: string;
  text?: string;
  since?: string;
  before?: string;
}

function boundedLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(value, 1), MAX_LIST_LIMIT);
}

function parseDate(value: string | undefined, label: string): Date | undefined {
  if (value == null) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} date: ${value}`);
  }
  return date;
}

/** True when the caller asked for anything the server has to search for. */
function hasFilters(options: ListMessagesOptions): boolean {
  return (
    options.unread_only === true ||
    options.from != null ||
    options.subject != null ||
    options.text != null ||
    options.since != null ||
    options.before != null
  );
}

export async function listMessages(
  account: MailAccount,
  options: ListMessagesOptions,
): Promise<{
  mailbox: string;
  total: number;
  returned: number;
  offset: number;
  messages: MessageSummary[];
}> {
  const limit = boundedLimit(options.limit);
  const offset = Math.max(options.offset ?? 0, 0);

  return withImap(account, async (client) => {
    const mailbox = await client.mailboxOpen(options.mailbox, {
      readOnly: true,
    });
    const exists = mailbox.exists;

    let uids: number[];
    if (hasFilters(options)) {
      const found = await client.search(
        {
          ...(options.unread_only === true ? { seen: false } : {}),
          ...(options.from != null ? { from: options.from } : {}),
          ...(options.subject != null ? { subject: options.subject } : {}),
          ...(options.text != null ? { body: options.text } : {}),
          ...(parseDate(options.since, 'since') != null
            ? { since: parseDate(options.since, 'since') }
            : {}),
          ...(parseDate(options.before, 'before') != null
            ? { before: parseDate(options.before, 'before') }
            : {}),
        },
        { uid: true },
      );
      /* Newest first, which is the order a reader expects. */
      uids = (found === false ? [] : found).sort((a, b) => b - a);
    } else {
      if (exists === 0) {
        return {
          mailbox: mailbox.path,
          total: 0,
          returned: 0,
          offset,
          messages: [],
        };
      }
      const highest = Math.max(exists - offset, 0);
      const lowest = Math.max(highest - limit + 1, 1);
      if (highest < 1) {
        return {
          mailbox: mailbox.path,
          total: exists,
          returned: 0,
          offset,
          messages: [],
        };
      }
      const found = await client.search(
        { seq: `${lowest}:${highest}` },
        { uid: true },
      );
      uids = (found === false ? [] : found).sort((a, b) => b - a);
    }

    const total = hasFilters(options) ? uids.length : exists;
    const page = hasFilters(options) ? uids.slice(offset, offset + limit) : uids;

    const messages: MessageSummary[] = [];
    if (page.length > 0) {
      for await (const message of client.fetch(
        page.join(','),
        { uid: true, envelope: true, flags: true, size: true, bodyStructure: true },
        { uid: true },
      )) {
        messages.push({
          uid: message.uid,
          subject: message.envelope?.subject ?? '',
          from: formatAddress(message.envelope?.from?.[0]),
          to: formatAddresses(message.envelope?.to),
          date: message.envelope?.date?.toISOString() ?? null,
          seen: message.flags?.has('\\Seen') ?? false,
          flagged: message.flags?.has('\\Flagged') ?? false,
          answered: message.flags?.has('\\Answered') ?? false,
          ...(message.size != null ? { size: message.size } : {}),
          attachment_count: collectAttachments(message.bodyStructure).length,
        });
      }
      /* fetch returns in sequence order, so restore the requested order. */
      const rank = new Map(page.map((uid, index) => [uid, index]));
      messages.sort((a, b) => (rank.get(a.uid) ?? 0) - (rank.get(b.uid) ?? 0));
    }

    return {
      mailbox: mailbox.path,
      total,
      returned: messages.length,
      offset,
      messages,
    };
  });
}

export async function readMessage(
  account: MailAccount,
  options: { mailbox: string; uid: number; mark_seen?: boolean },
): Promise<MessageDetail> {
  return withImap(account, async (client) => {
    await client.mailboxOpen(options.mailbox, {
      readOnly: options.mark_seen !== true,
    });

    const message = await client.fetchOne(
      String(options.uid),
      { uid: true, envelope: true, flags: true, size: true, bodyStructure: true },
      { uid: true },
    );
    if (message === false) {
      throw new Error(`No message with uid ${options.uid} in ${options.mailbox}`);
    }

    const attachments = collectAttachments(message.bodyStructure);
    const bodyPart = pickBodyPart(message.bodyStructure);

    let body = '';
    let bodySource: MessageDetail['body_source'] = 'none';
    if (bodyPart != null) {
      const download = await client.download(
        String(options.uid),
        bodyPart.part,
        { uid: true },
      );
      const raw = await readStream(download.content);
      body =
        bodyPart.type === 'html'
          ? htmlToText(raw, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] })
          : raw;
      bodySource = bodyPart.type;
    }

    if (options.mark_seen === true) {
      await client.messageFlagsAdd(String(options.uid), ['\\Seen'], {
        uid: true,
      });
    }

    const capped = capOutput(body, bodyCharLimit());

    return {
      uid: message.uid,
      subject: message.envelope?.subject ?? '',
      from: formatAddress(message.envelope?.from?.[0]),
      to: formatAddresses(message.envelope?.to),
      cc: formatAddresses(message.envelope?.cc),
      reply_to: formatAddresses(message.envelope?.replyTo),
      date: message.envelope?.date?.toISOString() ?? null,
      seen: options.mark_seen === true || (message.flags?.has('\\Seen') ?? false),
      flagged: message.flags?.has('\\Flagged') ?? false,
      answered: message.flags?.has('\\Answered') ?? false,
      ...(message.size != null ? { size: message.size } : {}),
      ...(message.envelope?.messageId != null
        ? { message_id: message.envelope.messageId }
        : {}),
      ...(message.envelope?.inReplyTo != null
        ? { in_reply_to: message.envelope.inReplyTo }
        : {}),
      attachment_count: attachments.length,
      attachments,
      body_source: bodySource,
      ...capped,
    };
  });
}

export async function setFlags(
  account: MailAccount,
  options: {
    mailbox: string;
    uid: number;
    seen?: boolean;
    flagged?: boolean;
    answered?: boolean;
  },
): Promise<{ uid: number; changed: string[] }> {
  const add: string[] = [];
  const remove: string[] = [];
  const track = (flag: string, wanted: boolean | undefined): void => {
    if (wanted === true) {
      add.push(flag);
    } else if (wanted === false) {
      remove.push(flag);
    }
  };
  track('\\Seen', options.seen);
  track('\\Flagged', options.flagged);
  track('\\Answered', options.answered);

  if (add.length === 0 && remove.length === 0) {
    throw new Error('Nothing to change: set at least one of seen, flagged, answered.');
  }

  return withImap(account, async (client) => {
    await client.mailboxOpen(options.mailbox);
    const uid = String(options.uid);
    if (add.length > 0) {
      await client.messageFlagsAdd(uid, add, { uid: true });
    }
    if (remove.length > 0) {
      await client.messageFlagsRemove(uid, remove, { uid: true });
    }
    return { uid: options.uid, changed: [...add, ...remove] };
  });
}

export async function moveMessage(
  account: MailAccount,
  options: { mailbox: string; uid: number; target: string },
): Promise<{ uid: number; from: string; to: string }> {
  return withImap(account, async (client) => {
    await client.mailboxOpen(options.mailbox);
    const result = await client.messageMove(String(options.uid), options.target, {
      uid: true,
    });
    if (result === false) {
      throw new Error(
        `Could not move uid ${options.uid} to ${options.target}. Check the target path with list_mailboxes.`,
      );
    }
    return {
      uid: options.uid,
      from: result.path,
      to: result.destination,
    };
  });
}

/** Resolves the server's own Trash folder, falling back to the usual names. */
export async function findSpecialUse(
  client: ImapFlow,
  specialUse: string,
  fallbackNames: string[],
): Promise<string | null> {
  const entries = await client.list();
  const byFlag = entries.find((entry) => entry.specialUse === specialUse);
  if (byFlag != null) {
    return byFlag.path;
  }
  const lowered = fallbackNames.map((name) => name.toLowerCase());
  const byName = entries.find((entry) => lowered.includes(entry.name.toLowerCase()));
  return byName?.path ?? null;
}

export async function downloadAttachment(
  account: MailAccount,
  options: { mailbox: string; uid: number; part: string },
): Promise<{ filename: string; contentType: string; content: Buffer }> {
  return withImap(account, async (client) => {
    await client.mailboxOpen(options.mailbox, { readOnly: true });
    const download = await client.download(
      String(options.uid),
      options.part,
      { uid: true },
    );
    const chunks: Buffer[] = [];
    for await (const chunk of download.content) {
      chunks.push(chunk);
    }
    return {
      filename: download.meta.filename ?? `part-${options.part}`,
      contentType: download.meta.contentType,
      content: Buffer.concat(chunks),
    };
  });
}

/**
 * Fetches what a reply needs: the ids for threading and the original text to
 * quote. Kept separate so send_message does not have to download a whole
 * message just to answer it.
 */
export async function fetchReplyContext(
  account: MailAccount,
  options: { mailbox: string; uid: number },
): Promise<{
  subject: string;
  messageId?: string;
  references: string[];
  to: string[];
  cc: string[];
}> {
  return withImap(account, async (client) => {
    await client.mailboxOpen(options.mailbox, { readOnly: true });
    const message = await client.fetchOne(
      String(options.uid),
      { uid: true, envelope: true, headers: ['references'] },
      { uid: true },
    );
    if (message === false) {
      throw new Error(`No message with uid ${options.uid} in ${options.mailbox}`);
    }

    const headerText = message.headers?.toString('utf8') ?? '';
    const referenceIds = (headerText.match(/<[^>]+>/g) ?? []).map((id) => id);
    const replyTo = formatAddresses(message.envelope?.replyTo);
    const from = formatAddresses(message.envelope?.from);

    return {
      subject: message.envelope?.subject ?? '',
      ...(message.envelope?.messageId != null
        ? { messageId: message.envelope.messageId }
        : {}),
      references: referenceIds,
      to: replyTo.length > 0 ? replyTo : from,
      cc: formatAddresses(message.envelope?.cc),
    };
  });
}

/** Appends a sent message to the Sent folder, the way a mail client does. */
export async function appendToSent(
  account: MailAccount,
  raw: Buffer,
): Promise<string | null> {
  return withImap(account, async (client) => {
    const path = await findSpecialUse(client, '\\Sent', [
      'Sent',
      'Sent Items',
      'Gesendet',
      'Gesendete Objekte',
    ]);
    if (path == null) {
      return null;
    }
    await client.append(path, raw, ['\\Seen']);
    return path;
  });
}

export async function deleteMessage(
  account: MailAccount,
  options: { mailbox: string; uid: number; permanent?: boolean },
): Promise<{ uid: number; moved_to?: string; deleted: boolean }> {
  return withImap(account, async (client) => {
    await client.mailboxOpen(options.mailbox);

    if (options.permanent === true) {
      await client.messageDelete(String(options.uid), { uid: true });
      return { uid: options.uid, deleted: true };
    }

    const trash = await findSpecialUse(client, '\\Trash', [
      'Trash',
      'Deleted Items',
      'Papierkorb',
      'Gelöschte Objekte',
    ]);
    if (trash == null) {
      throw new Error(
        'No trash folder found. Pass permanent: true to delete irreversibly, or move_message to a folder of your choice.',
      );
    }
    if (trash === options.mailbox) {
      await client.messageDelete(String(options.uid), { uid: true });
      return { uid: options.uid, deleted: true };
    }
    await client.messageMove(String(options.uid), trash, { uid: true });
    return { uid: options.uid, moved_to: trash, deleted: false };
  });
}
