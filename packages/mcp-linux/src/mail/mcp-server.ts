/**
 * The mail MCP server.
 *
 * A separate server rather than more tools on the Linux one, because LibreChat
 * gates credentials per server: mail needs an address and a password before any
 * of its tools make sense, and requiring them here would otherwise hide the
 * terminal tools from everyone who has not set up mail.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserManager } from '../user-manager.ts';
import { registerMailTools } from '../tools/mail.ts';

export const MAIL_SERVER_NAME = 'mcp-mail-server';

export function createMailServer(userManager: UserManager): McpServer {
  const server = new McpServer(
    {
      name: MAIL_SERVER_NAME,
      version: '1.0.0',
    },
    {
      capabilities: { tools: {} },
      instructions: `You can read and send mail from the user's own mailbox over IMAP and SMTP.

CREDENTIALS
- The user's address and password are configured in this server's settings in LibreChat, stored encrypted, and sent to the server with each request. You never see them.
- Never ask the user to type a password, an app password or any other credential into the chat. If a tool reports that no account is configured, tell them to open the mail server settings and enter it there.

READING
- list_mailboxes first when you do not know the folder names: they differ per provider and per language ("Sent" vs "Gesendet"), and every other tool takes a folder path.
- list_messages returns envelopes only - subject, sender, date, flags, attachment_count. Read the text of one with read_message(uid).
- search_messages searches on the mail server, so it covers the whole mailbox rather than what you have already listed. Combine from, subject, text and a date range to narrow it.
- Reading does not mark a message as read. Pass mark_seen: true only when the user asked for it.
- Long bodies are capped and the reply says so. Do not try to work around it by fetching the message again; summarize what you have or ask which part matters.

SENDING
- Show the user the recipients, subject and text and let them confirm before you call send_message. A sent mail cannot be recalled.
- To answer a message, pass reply_to_uid: the threading headers and the "Re:" prefix are handled, the original is flagged as answered, and the sent mail is filed in the Sent folder. Recipients are not inferred - set "to" yourself, from the original's sender.
- Write in the user's language and keep their voice. Do not add a signature they did not ask for.

ATTACHMENTS
- read_message lists attachments with a part id; it does not download them. save_attachment writes one into the Linux workspace and returns the path, so the workspace tools can read, convert or run it.
- To attach a file, give send_message the path relative to the workspace.

DELETING
- delete_message moves to the trash folder. Only permanent: true is irreversible, and that needs the user's explicit yes.`,
    },
  );

  registerMailTools(server, userManager);
  return server;
}
