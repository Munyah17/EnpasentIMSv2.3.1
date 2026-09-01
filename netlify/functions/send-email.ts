import type { Handler } from '@netlify/functions'
import nodemailer from 'nodemailer'

/**
 * Sends outgoing mail via the company's own SMTP server (a cPanel host —
 * see database/../REBUILD_INSTRUCTIONS or ops notes for the mailbox list)
 * so credentials never reach the browser. Configure via Netlify env vars:
 *
 *   SMTP_HOST     — e.g. c3.my-control-panel.com
 *   SMTP_PORT     — defaults to 465
 *   SMTP_SECURE   — "true" for port 465 (implicit TLS), "false" for 587 (STARTTLS). Defaults to true.
 *   SMTP_PASSWORD — shared across the role mailboxes (see src/lib/mailboxes.ts);
 *                   update this — and split into per-mailbox vars if any
 *                   mailbox's password ever diverges — once real passwords are set.
 *
 * The SMTP *username* is always the `from` address itself (cPanel mail
 * authenticates as the full mailbox address), so no separate username var
 * is needed as long as every mailbox shares one password.
 *
 * Without SMTP_HOST configured, returns { simulated: true } so the client
 * (src/lib/mailService.ts) can fall back gracefully — e.g. before the
 * mailboxes actually exist yet.
 */

interface SendEmailBody {
  to: string
  cc?: string
  subject: string
  text: string
  from?: string
  fromName?: string
  replyTo?: string
  /** Base64 payload (no data: URI prefix) — e.g. a generated policy report PDF. */
  attachmentBase64?: string
  attachmentFilename?: string
}

let cachedTransporter: nodemailer.Transporter | null = null

function getTransporter() {
  if (cachedTransporter) return cachedTransporter
  const host = process.env.SMTP_HOST
  const password = process.env.SMTP_PASSWORD
  if (!host || !password) return null
  cachedTransporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: (process.env.SMTP_SECURE ?? 'true') === 'true',
    auth: { user: process.env.SMTP_DEFAULT_USER ?? undefined, pass: password },
  })
  return cachedTransporter
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let body: SendEmailBody
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  if (!body.to || !body.subject || !body.text) {
    return { statusCode: 400, body: JSON.stringify({ error: 'to, subject, and text are required' }) }
  }

  const host = process.env.SMTP_HOST
  const password = process.env.SMTP_PASSWORD
  if (!host || !password) {
    return { statusCode: 200, body: JSON.stringify({ simulated: true, reason: 'SMTP_HOST/SMTP_PASSWORD not configured' }) }
  }

  const fromAddress = body.from || process.env.SMTP_FALLBACK_FROM || `noreply@${host.replace(/^mail\./, '')}`
  const fromHeader = body.fromName ? `${body.fromName} <${fromAddress}>` : fromAddress

  try {
    const transporter = getTransporter()
    if (!transporter) {
      return { statusCode: 200, body: JSON.stringify({ simulated: true, reason: 'SMTP not configured' }) }
    }
    const info = await transporter.sendMail({
      from: fromHeader,
      // cPanel mailboxes typically must send AS themselves — authenticate
      // per-send as the actual from address rather than one fixed account,
      // so "from" genuinely matches who the SMTP session logged in as.
      ...(process.env.SMTP_DEFAULT_USER ? {} : { auth: { user: fromAddress, pass: password } }),
      to: body.to,
      cc: body.cc,
      replyTo: body.replyTo,
      subject: body.subject,
      text: body.text,
      attachments: body.attachmentBase64 && body.attachmentFilename ? [{
        filename: body.attachmentFilename,
        content: Buffer.from(body.attachmentBase64, 'base64'),
      }] : undefined,
    } as nodemailer.SendMailOptions)
    return { statusCode: 200, body: JSON.stringify({ success: true, id: info.messageId }) }
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: `Failed to send via SMTP: ${e}` }) }
  }
}
