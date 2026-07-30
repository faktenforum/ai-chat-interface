/**
 * Schemas for the mail tools.
 */

import { z } from 'zod';

const mailboxField = z
  .string()
  .min(1)
  .default('INBOX')
  .describe('Mailbox path as reported by list_mailboxes (default: "INBOX")');

const uidField = z
  .number()
  .int()
  .min(1)
  .describe('Message uid from list_messages or search_messages');

export const ListMailboxesSchema = z.object({});

export const ListMessagesSchema = z.object({
  mailbox: mailboxField,
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('How many messages to return, newest first (default 20, max 100)'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Skip this many of the newest messages, to page further back'),
  unread_only: z.boolean().optional().describe('Only messages without the \\Seen flag'),
});

export const SearchMessagesSchema = z.object({
  mailbox: mailboxField,
  from: z.string().optional().describe('Substring of the sender address or name'),
  subject: z.string().optional().describe('Substring of the subject'),
  text: z.string().optional().describe('Substring anywhere in the message body'),
  since: z
    .string()
    .optional()
    .describe('Only messages on or after this date, e.g. "2026-07-01"'),
  before: z.string().optional().describe('Only messages before this date'),
  unread_only: z.boolean().optional().describe('Only messages without the \\Seen flag'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
  offset: z.number().int().min(0).optional().describe('Skip this many results'),
});

export const ReadMessageSchema = z.object({
  mailbox: mailboxField,
  uid: uidField,
  mark_seen: z
    .boolean()
    .optional()
    .describe('Mark the message as read (default false - reading does not change state)'),
});

export const SendMessageSchema = z.object({
  to: z.array(z.string().min(3)).min(1).describe('Recipient addresses'),
  subject: z.string().describe('Subject line'),
  body: z.string().describe('Message text. Plain text; no HTML.'),
  cc: z.array(z.string().min(3)).optional().describe('Cc addresses'),
  bcc: z.array(z.string().min(3)).optional().describe('Bcc addresses'),
  reply_to_uid: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Reply to this message: sets the threading headers and prefixes "Re:" when needed. Recipients still come from `to`.',
    ),
  reply_to_mailbox: z
    .string()
    .optional()
    .describe('Mailbox holding reply_to_uid (default "INBOX")'),
  attachments: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Paths of files to attach, relative to the workspace, e.g. "reports/summary.pdf"',
    ),
  workspace: z
    .string()
    .default('default')
    .describe('Workspace the attachment paths are relative to (default: "default")'),
});

export const SetMessageFlagsSchema = z.object({
  mailbox: mailboxField,
  uid: uidField,
  seen: z.boolean().optional().describe('Mark read (true) or unread (false)'),
  flagged: z.boolean().optional().describe('Add or remove the star'),
  answered: z.boolean().optional().describe('Mark as answered'),
});

export const MoveMessageSchema = z.object({
  mailbox: mailboxField,
  uid: uidField,
  target: z.string().min(1).describe('Destination mailbox path'),
});

export const DeleteMessageSchema = z.object({
  mailbox: mailboxField,
  uid: uidField,
  permanent: z
    .boolean()
    .optional()
    .describe(
      'Delete irreversibly instead of moving to trash. Default false, which moves it to the trash folder.',
    ),
});

export const SaveAttachmentSchema = z.object({
  mailbox: mailboxField,
  uid: uidField,
  part: z
    .string()
    .min(1)
    .describe('Attachment part id from read_message, e.g. "2" or "1.3"'),
  workspace: z
    .string()
    .default('default')
    .describe('Workspace to save into (default: "default")'),
  directory: z
    .string()
    .default('mail')
    .describe('Directory inside the workspace (default: "mail")'),
});
