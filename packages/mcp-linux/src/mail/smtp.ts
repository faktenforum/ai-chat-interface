/**
 * Sending mail.
 *
 * The message is composed once into a raw MIME buffer, then that same buffer is
 * both handed to SMTP and appended to the Sent folder - so what the recipient
 * gets and what the user later finds in Sent are the same message, not two
 * renderings of it.
 */

import { createTransport } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import {
  insecureTransportAllowed,
  tlsRejectUnauthorized,
  type MailAccount,
} from './account.ts';

export interface OutgoingAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendOptions {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  /** Threading headers, when this is a reply. */
  in_reply_to?: string;
  references?: string[];
  attachments?: OutgoingAttachment[];
}

export interface SendResult {
  message_id: string;
  accepted: string[];
  rejected: string[];
  raw: Buffer;
}

export async function sendMail(
  account: MailAccount,
  options: SendOptions,
): Promise<SendResult> {
  const from =
    account.fromName != null
      ? { name: account.fromName, address: account.address }
      : account.address;

  const mail = {
    from,
    to: options.to,
    subject: options.subject,
    text: options.body,
    ...(options.cc != null && options.cc.length > 0 ? { cc: options.cc } : {}),
    ...(options.bcc != null && options.bcc.length > 0 ? { bcc: options.bcc } : {}),
    ...(options.in_reply_to != null ? { inReplyTo: options.in_reply_to } : {}),
    ...(options.references != null && options.references.length > 0
      ? { references: options.references }
      : {}),
    ...(options.attachments != null && options.attachments.length > 0
      ? {
          attachments: options.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.content,
            ...(attachment.contentType != null
              ? { contentType: attachment.contentType }
              : {}),
          })),
        }
      : {}),
  };

  const raw = await new MailComposer(mail).compile().build();

  const transport = createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    /* On a submission port the upgrade is not optional - refuse to send credentials in
     * clear. Only a deliberately insecure test setup may skip it. */
    requireTLS: !account.smtp.secure && !insecureTransportAllowed(),
    auth: { user: account.login, pass: account.password },
    tls: { rejectUnauthorized: tlsRejectUnauthorized() },
  });

  try {
    const info = await transport.sendMail({
      envelope: {
        from: account.address,
        to: [...options.to, ...(options.cc ?? []), ...(options.bcc ?? [])],
      },
      raw,
    });
    return {
      message_id: info.messageId,
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
      raw,
    };
  } finally {
    transport.close();
  }
}
