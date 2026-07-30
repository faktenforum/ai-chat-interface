/**
 * Mail server test, driven through the official MCP SDK client over HTTP - the
 * same path LibreChat takes, credentials in headers included.
 *
 * Needs a real IMAP/SMTP server. GreenMail is enough and starts in a second:
 *
 *   podman run -d --rm --name greenmail-test \
 *     -p 127.0.0.1:3025:3025 -p 127.0.0.1:3143:3143 \
 *     -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 \
 *        -Dgreenmail.users=mailtest:secret@example.org" \
 *     docker.io/greenmail/standalone:2.1.9
 *
 *   node --experimental-strip-types --experimental-transform-types --no-warnings \
 *     --experimental-specifier-resolution=node test/mail.ts
 */

import { randomUUID } from 'node:crypto';
import express from 'express';
import { createTransport } from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { setupMcpEndpoints } from '../src/utils/http-server.ts';
import { createMailServer } from '../src/mail/mcp-server.ts';
import { UserManager } from '../src/user-manager.ts';

/* GreenMail's certificate is self-signed, and 3143/3025 are the plain ports. */
process.env.MCP_MAIL_TLS_INSECURE = 'true';

const IMAP = process.env.TEST_IMAP ?? 'imap://127.0.0.1:3143';
const SMTP = process.env.TEST_SMTP ?? 'smtp://127.0.0.1:3025';
const ADDRESS = process.env.TEST_ADDRESS ?? 'mailtest@example.org';
const PASSWORD = process.env.TEST_PASSWORD ?? 'secret';
/* GreenMail's -Dgreenmail.users=login:password@domain makes the login the local part alone,
 * so this also covers the case where the login differs from the address. */
const LOGIN = process.env.TEST_LOGIN ?? 'mailtest';
const PORT = 3999;
/**
 * Every run tags its own messages, so the suite can run repeatedly against the
 * same mailbox without either counting leftovers from an earlier run or having
 * to delete anything it did not create.
 */
const TAG = randomUUID().slice(0, 8);

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/** Unwraps a tool result, turning a tool-reported error into a readable failure. */
const json = (result: unknown): any => {
  const typed = result as { isError?: boolean; content: { text: string }[] };
  const text = typed.content[0]?.text ?? '';
  if (typed.isError === true) {
    throw new Error(`tool returned an error: ${text}`);
  }
  return JSON.parse(text);
};

/** Puts a few messages in the mailbox to read, one of them with an attachment. */
async function seedMailbox(): Promise<void> {
  const transport = createTransport({
    host: '127.0.0.1',
    port: 3025,
    secure: false,
    tls: { rejectUnauthorized: false },
  });
  await transport.sendMail({
    from: 'sender@example.com',
    to: ADDRESS,
    subject: `Quarterly numbers ${TAG}`,
    text: 'The numbers are attached.',
    attachments: [{ filename: 'numbers.csv', content: 'a,b\n1,2\n' }],
  });
  await transport.sendMail({
    from: 'other@example.com',
    to: ADDRESS,
    subject: `Lunch on Thursday? ${TAG}`,
    text: 'Are you free at noon?',
  });
  transport.close();
}

/**
 * GreenMail starts with INBOX alone. Creating a Sent folder is what lets the
 * test check that a sent message is actually filed, which is the part a user
 * notices missing.
 */
async function createSentFolder(): Promise<void> {
  const client = new ImapFlow({
    host: '127.0.0.1',
    port: 3143,
    secure: false,
    auth: { user: LOGIN, pass: PASSWORD },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.mailboxCreate('Sent');
  } catch {
    /* Already there from an earlier run. */
  }
  await client.logout();
}

async function main(): Promise<void> {
  await createSentFolder();
  await seedMailbox();

  const userManager = new UserManager();
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  setupMcpEndpoints(app, {
    serverName: 'mcp-mail-test',
    version: '1.0.0',
    port: PORT,
    path: '/mcp/mail',
    transports,
    createServer: () => {
      const server = createMailServer(userManager);
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: false,
        onsessioninitialized: (id: string): void => {
          transports.set(id, transport);
        },
      });
      return { server, transport };
    },
  });
  const http = app.listen(PORT, '127.0.0.1');

  const client = new Client({ name: 'mcp-mail-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp/mail`), {
      requestInit: {
        headers: {
          'X-User-Email': 'mail.suite@example.com',
          'X-User-ID': 'mail-suite',
          'X-User-Username': 'mailsuite',
          'X-Mail-Address': ADDRESS,
          'X-Mail-Password': PASSWORD,
          'X-Mail-Login': LOGIN,
          'X-Mail-Imap': IMAP,
          'X-Mail-Smtp': SMTP,
          'X-Mail-From-Name': 'Mail Suite',
        },
      },
    }),
  );

  console.log('=== mail ===\n');

  {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of [
      'list_mailboxes',
      'list_messages',
      'search_messages',
      'read_message',
      'send_message',
      'set_message_flags',
      'move_message',
      'delete_message',
      'save_attachment',
    ]) {
      assert(names.includes(tool), `${tool} is registered`);
    }
    console.log(`✓ all nine mail tools are exposed`);
  }

  {
    const result = json(await client.callTool({ name: 'list_mailboxes', arguments: {} }));
    const paths = result.mailboxes.map((m: { path: string }) => m.path);
    assert(paths.includes('INBOX'), `INBOX is listed, got ${paths.join(', ')}`);
    const inbox = result.mailboxes.find((m: { path: string }) => m.path === 'INBOX');
    assert(inbox.messages >= 2, `INBOX counts the seeded messages, got ${inbox.messages}`);
    assert(inbox.unseen >= 2, `and reports them unread, got ${inbox.unseen}`);
    console.log('✓ list_mailboxes reports paths with message and unread counts');
  }

  let attachmentUid = 0;
  {
    const result = json(
      await client.callTool({ name: 'list_messages', arguments: { mailbox: 'INBOX', limit: 2 } }),
    );
    assert(result.total >= 2, `total is the mailbox size, got ${result.total}`);
    assert(result.messages.length === 2, 'the limit is honoured');
    assert(
      result.messages[0].subject === `Lunch on Thursday? ${TAG}`,
      `newest first, got "${result.messages[0].subject}"`,
    );
    const withAttachment = result.messages.find(
      (m: { attachment_count: number }) => m.attachment_count > 0,
    );
    assert(withAttachment != null, 'the attachment is counted without downloading it');
    assert(withAttachment.seen === false, 'a fresh message is unread');
    assert(/sender@example.com/.test(withAttachment.from), 'the sender is reported');
    attachmentUid = withAttachment.uid;
    console.log('✓ list_messages returns envelopes, newest first, with attachment counts');
  }

  {
    const bySubject = json(
      await client.callTool({
        name: 'search_messages',
        arguments: { mailbox: 'INBOX', subject: `Quarterly numbers ${TAG}` },
      }),
    );
    assert(bySubject.messages.length === 1, `subject search narrows, got ${bySubject.messages.length}`);

    const byText = json(
      await client.callTool({
        name: 'search_messages',
        arguments: { mailbox: 'INBOX', text: 'free at noon', subject: TAG },
      }),
    );
    assert(byText.messages.length === 1, 'body search works on the server');
    assert(
      byText.messages[0].subject === `Lunch on Thursday? ${TAG}`,
      'and finds the right one',
    );

    const unread = json(
      await client.callTool({
        name: 'search_messages',
        arguments: { mailbox: 'INBOX', unread_only: true, subject: TAG },
      }),
    );
    assert(unread.messages.length === 2, `both are still unread, got ${unread.messages.length}`);
    console.log('✓ search_messages filters by subject, body text and unread state');
  }

  {
    const message = json(
      await client.callTool({
        name: 'read_message',
        arguments: { mailbox: 'INBOX', uid: attachmentUid },
      }),
    );
    assert(/numbers are attached/.test(message.output ?? message.body ?? ''), 'the body text is returned');
    assert(message.body_source === 'text', `plain text is preferred, got ${message.body_source}`);
    assert(message.attachments.length === 1, 'the attachment is listed');
    assert(
      message.attachments[0].filename === 'numbers.csv',
      `with its filename, got ${message.attachments[0].filename}`,
    );
    assert(message.seen === false, 'reading alone does not mark it read');
    console.log('✓ read_message returns body and attachment list without marking it read');
  }

  {
    json(
      await client.callTool({
        name: 'set_message_flags',
        arguments: { mailbox: 'INBOX', uid: attachmentUid, seen: true, flagged: true },
      }),
    );
    const after = json(
      await client.callTool({
        name: 'list_messages',
        arguments: { mailbox: 'INBOX' },
      }),
    );
    const changed = after.messages.find((m: { uid: number }) => m.uid === attachmentUid);
    assert(changed.seen === true, 'the message is now read');
    assert(changed.flagged === true, 'and starred');
    console.log('✓ set_message_flags changes only the flags it was given');
  }

  {
    const sent = json(
      await client.callTool({
        name: 'send_message',
        arguments: {
          to: [ADDRESS],
          subject: `Sent from the test ${TAG}`,
          body: 'Hello from the mail server test.',
        },
      }),
    );
    assert(sent.accepted.includes(ADDRESS), `the recipient was accepted, got ${JSON.stringify(sent.accepted)}`);
    assert(sent.message_id != null, 'a message id is reported');

    /* GreenMail delivers to itself, so the mail arrives in the same INBOX. */
    const arrived = json(
      await client.callTool({
        name: 'search_messages',
        arguments: { mailbox: 'INBOX', subject: `Sent from the test ${TAG}` },
      }),
    );
    assert(arrived.messages.length === 1, 'the sent mail was delivered');
    assert(
      /Mail Suite/.test(arrived.messages[0].from),
      `the From display name is used, got "${arrived.messages[0].from}"`,
    );
    assert(
      sent.filed_in === 'Sent',
      `the sent mail is filed in the Sent folder, got ${sent.filed_in}`,
    );
    const filed = json(
      await client.callTool({
        name: 'search_messages',
        arguments: { mailbox: 'Sent', subject: `Sent from the test ${TAG}` },
      }),
    );
    assert(filed.messages.length === 1, 'and can be found there afterwards');
    console.log('✓ send_message delivers and files a copy in Sent');
  }

  {
    const inbox = json(
      await client.callTool({
        name: 'search_messages',
        arguments: { mailbox: 'INBOX', subject: `Lunch on Thursday? ${TAG}` },
      }),
    );
    const uid = inbox.messages[0].uid;

    const reply = json(
      await client.callTool({
        name: 'send_message',
        arguments: {
          to: [ADDRESS],
          subject: 'ignored',
          body: 'Noon works.',
          reply_to_uid: uid,
          reply_to_mailbox: 'INBOX',
        },
      }),
    );
    assert(
      reply.subject === `Re: Lunch on Thursday? ${TAG}`,
      `the Re: prefix is derived from the original, got "${reply.subject}"`,
    );

    const original = json(
      await client.callTool({
        name: 'read_message',
        arguments: { mailbox: 'INBOX', uid },
      }),
    );
    assert(original.answered === true, 'the original is flagged as answered');
    console.log('✓ send_message threads a reply and flags the original');
  }

  {
    const moved = json(
      await client.callTool({
        name: 'move_message',
        arguments: { mailbox: 'INBOX', uid: attachmentUid, target: 'INBOX' },
      }),
    );
    assert(moved.to === 'INBOX', 'move reports source and destination');
    console.log('✓ move_message reports where the message went');
  }

  {
    const before = json(
      await client.callTool({
        name: 'search_messages',
        arguments: { mailbox: 'INBOX', subject: TAG },
      }),
    );
    const uid = before.messages[0].uid;
    const deleted = json(
      await client.callTool({
        name: 'delete_message',
        arguments: { mailbox: 'INBOX', uid, permanent: true },
      }),
    );
    assert(deleted.deleted === true, 'permanent delete reports it removed the message');

    const after = json(
      await client.callTool({
        name: 'search_messages',
        arguments: { mailbox: 'INBOX', subject: TAG },
      }),
    );
    assert(
      after.messages.length === before.messages.length - 1,
      `one fewer of this run's messages, ${before.messages.length} -> ${after.messages.length}`,
    );
    console.log('✓ delete_message removes a message');
  }

  await client.close();

  /* An unconfigured account must fail with an instruction, not a stack trace. */
  {
    const bare = new Client({ name: 'mcp-mail-test-bare', version: '1.0.0' });
    await bare.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp/mail`), {
        requestInit: { headers: { 'X-User-Email': 'nobody@example.com' } },
      }),
    );
    const result = (await bare.callTool({ name: 'list_mailboxes', arguments: {} })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    assert(result.isError === true, 'a missing account is an error');
    assert(
      /server settings/.test(result.content[0].text),
      `and says where to fix it, got: ${result.content[0].text}`,
    );
    assert(
      !/password/i.test(result.content[0].text.split('settings')[0]),
      'without asking for the password in chat',
    );
    await bare.close();
    console.log('✓ an unconfigured account points at the settings, not at the chat');
  }

  http.close();
  console.log('\n=== All tests passed ===');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
