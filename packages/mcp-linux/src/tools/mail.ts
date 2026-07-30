/**
 * Mail tools: read, search, send, file away.
 *
 * Credentials never appear in an argument. They arrive as per-user headers that
 * LibreChat substitutes from its encrypted store, so the model cannot see them
 * and must never ask for them - see the server instructions.
 *
 * Attachments are the one place this crosses into the Linux workspace: saving
 * one writes into ~/workspaces/<workspace>/mail/ as the user, and sending one
 * reads from the same place. That is what makes "download the invoice and
 * convert it" a single conversation instead of two disconnected ones.
 */

import fs from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserManager } from '../user-manager.ts';
import { resolveSafePath, ensureFileExists } from '../utils/fs-helper.ts';
import { logger } from '../utils/logger.ts';
import { accountFromExtra } from '../mail/account.ts';
import {
  listMailboxes,
  listMessages,
  readMessage,
  setFlags,
  moveMessage,
  deleteMessage,
  downloadAttachment,
  fetchReplyContext,
  appendToSent,
} from '../mail/imap.ts';
import { sendMail, type OutgoingAttachment } from '../mail/smtp.ts';
import { resolveEmail, errorResult } from './helpers.ts';
import {
  ListMailboxesSchema,
  ListMessagesSchema,
  SearchMessagesSchema,
  ReadMessageSchema,
  SendMessageSchema,
  SetMessageFlagsSchema,
  MoveMessageSchema,
  DeleteMessageSchema,
  SaveAttachmentSchema,
} from '../schemas/mail.schema.ts';

/** Cap on what may be attached, so one tool call cannot post a DVD image. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const asText = (result: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
});

export function registerMailTools(
  server: McpServer,
  userManager: UserManager,
): void {
  /** Resolves the Linux account, creating it if this user has never had one. */
  const workspaceOwner = async (
    email: string,
  ): Promise<{ username: string; uid: number }> => {
    const mapping = await userManager.ensureUser(email);
    return { username: mapping.username, uid: mapping.uid };
  };

  server.registerTool(
    'list_mailboxes',
    {
      description:
        'List the mail folders with their message and unread counts. Start here when you do not know the folder names - they differ per provider and per language. Returns: path, name, special_use (\\Sent, \\Trash, ...), messages, unseen.',
      inputSchema: ListMailboxesSchema.shape,
    },
    async (_args, extra) => {
      try {
        return asText(await listMailboxes(accountFromExtra(extra)));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_messages',
    {
      description:
        'List messages in a mailbox, newest first. Returns envelopes only - uid, subject, from, to, date, flags, attachment_count, size - not the text. Read one with read_message. Page further back with offset.',
      inputSchema: ListMessagesSchema.shape,
    },
    async (args, extra) => {
      try {
        return asText(await listMessages(accountFromExtra(extra), args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'search_messages',
    {
      description:
        'Search a mailbox on the server: sender, subject, body text, date range, unread state. Combining fields narrows the result. The search runs on the mail server, so it covers the whole mailbox and not just what was listed.',
      inputSchema: SearchMessagesSchema.shape,
    },
    async (args, extra) => {
      try {
        return asText(await listMessages(accountFromExtra(extra), args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'read_message',
    {
      description:
        'Read one message: headers, body text and the list of attachments. HTML-only mail is converted to text. Long bodies are capped, and the reply tells you when that happened. Reading does not mark the message as read unless you pass mark_seen.',
      inputSchema: ReadMessageSchema.shape,
    },
    async (args, extra) => {
      try {
        return asText(await readMessage(accountFromExtra(extra), args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'send_message',
    {
      description:
        'Send a mail from the user\'s own address. Pass reply_to_uid to answer a message - the threading headers and the "Re:" prefix are handled for you, but the recipients are not, so set `to` yourself. Attachments are read from the Linux workspace by path. The sent mail is filed in the Sent folder. Always show the user what you are about to send before sending it.',
      inputSchema: SendMessageSchema.shape,
    },
    async (args, extra) => {
      try {
        const account = accountFromExtra(extra);
        const email = resolveEmail(extra);

        let subject = args.subject;
        let inReplyTo: string | undefined;
        let references: string[] | undefined;

        if (args.reply_to_uid != null) {
          const context = await fetchReplyContext(account, {
            mailbox: args.reply_to_mailbox ?? 'INBOX',
            uid: args.reply_to_uid,
          });
          if (!/^re:/i.test(subject) && context.subject !== '') {
            subject = /^re:/i.test(context.subject)
              ? context.subject
              : `Re: ${context.subject}`;
          }
          inReplyTo = context.messageId;
          references = [
            ...context.references,
            ...(context.messageId != null ? [context.messageId] : []),
          ];
        }

        const attachments: OutgoingAttachment[] = [];
        for (const relativePath of args.attachments ?? []) {
          const { username } = await workspaceOwner(email);
          const absolute = await resolveSafePath(
            username,
            args.workspace,
            relativePath,
          );
          await ensureFileExists(absolute);
          const stat = await fs.stat(absolute);
          if (stat.size > MAX_ATTACHMENT_BYTES) {
            throw new Error(
              `${relativePath} is ${stat.size} bytes, over the ${MAX_ATTACHMENT_BYTES} byte attachment limit. Share it with create_download_link instead.`,
            );
          }
          attachments.push({
            filename: basename(relativePath),
            content: await fs.readFile(absolute),
          });
        }

        const result = await sendMail(account, {
          to: args.to,
          subject,
          body: args.body,
          ...(args.cc != null ? { cc: args.cc } : {}),
          ...(args.bcc != null ? { bcc: args.bcc } : {}),
          ...(inReplyTo != null ? { in_reply_to: inReplyTo } : {}),
          ...(references != null ? { references } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        });

        let sentFolder: string | null = null;
        try {
          sentFolder = await appendToSent(account, result.raw);
        } catch (error) {
          /* The mail is already delivered; a failed copy is worth reporting, not throwing. */
          logger.warn({ error }, 'Could not append the sent message to Sent');
        }

        if (args.reply_to_uid != null) {
          try {
            await setFlags(account, {
              mailbox: args.reply_to_mailbox ?? 'INBOX',
              uid: args.reply_to_uid,
              answered: true,
            });
          } catch (error) {
            logger.warn({ error }, 'Could not flag the original as answered');
          }
        }

        return asText({
          message_id: result.message_id,
          subject,
          accepted: result.accepted,
          rejected: result.rejected,
          attachments: attachments.map((attachment) => attachment.filename),
          filed_in: sentFolder,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'set_message_flags',
    {
      description:
        'Mark a message read or unread, star it, or mark it answered. Pass only the flags you want to change.',
      inputSchema: SetMessageFlagsSchema.shape,
    },
    async (args, extra) => {
      try {
        return asText(await setFlags(accountFromExtra(extra), args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'move_message',
    {
      description:
        'Move a message to another mailbox. Use list_mailboxes for the exact target path.',
      inputSchema: MoveMessageSchema.shape,
    },
    async (args, extra) => {
      try {
        return asText(await moveMessage(accountFromExtra(extra), args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'delete_message',
    {
      description:
        'Move a message to the trash folder, which the server names itself. Only with permanent: true is it gone for good - ask the user before doing that.',
      inputSchema: DeleteMessageSchema.shape,
    },
    async (args, extra) => {
      try {
        return asText(await deleteMessage(accountFromExtra(extra), args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'save_attachment',
    {
      description:
        'Save an attachment into the Linux workspace and return its path, so the other tools - read_workspace_file, execute_command, create_download_link - can work with it. Get the part id from read_message.',
      inputSchema: SaveAttachmentSchema.shape,
    },
    async (args, extra) => {
      try {
        const account = accountFromExtra(extra);
        const email = resolveEmail(extra);
        const { username, uid } = await workspaceOwner(email);

        const attachment = await downloadAttachment(account, {
          mailbox: args.mailbox,
          uid: args.uid,
          part: args.part,
        });

        /* Keep the sender's filename but not their choice of directory. */
        const safeName = basename(attachment.filename).replace(/[/\\]/g, '_');
        const relativePath = `${args.directory}/${safeName}`;
        const absolute = await resolveSafePath(
          username,
          args.workspace,
          relativePath,
        );

        await fs.mkdir(dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, attachment.content);
        /* Written by root, so hand it to the user or their shell cannot touch it. */
        await fs.chown(dirname(absolute), uid, uid).catch(() => undefined);
        await fs.chown(absolute, uid, uid);

        return asText({
          path: `~/workspaces/${args.workspace}/${relativePath}`,
          workspace: args.workspace,
          workspace_path: relativePath,
          filename: safeName,
          content_type: attachment.contentType,
          bytes: attachment.content.length,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
