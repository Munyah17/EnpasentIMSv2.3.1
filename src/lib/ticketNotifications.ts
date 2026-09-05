import type { Ticket, TicketStatus } from '../types'
import { sendEmail, getNotifSettings } from './mailService'
import { sendSms } from './smsService'
import { MAILBOXES } from './mailboxes'
import { db } from './db'
import { ADMIN_ALERT_NUMBERS } from './signupNotifications'

/**
 * Support ticket lifecycle notifications: office hears about a new ticket,
 * the client hears back the moment staff reply or the ticket's status
 * changes. Before this, tickets.create()/update() in db.ts sent nothing at
 * all — a client had no way to know a reply or resolution had happened
 * short of logging back in and checking.
 */

async function getClientContact(ticket: Ticket): Promise<{ email: string; phone: string }> {
  const { data } = await db.clients.get(ticket.clientId)
  return { email: data?.email ?? '', phone: data?.phone ?? '' }
}

function statusLabel(status: TicketStatus): string {
  return status.replace('_', ' ').toUpperCase()
}

export async function notifyTicketCreated(ticket: Ticket): Promise<void> {
  const cfg = getNotifSettings()
  void sendEmail({
    to: MAILBOXES.admin,
    subject: `[New Ticket] ${ticket.ticketNumber}: ${ticket.subject}`,
    from: MAILBOXES.admin,
    body: `A new support ticket has been submitted.

Ticket Number: ${ticket.ticketNumber}
Client:        ${ticket.clientName}
Category:      ${ticket.category}
Priority:      ${ticket.priority}
Status:        ${statusLabel(ticket.status)}

${ticket.description}${cfg.signature ? `\n\n---\n${cfg.signature}` : ''}`,
  }).catch(() => { /**/ })

  const alert = `Enpasent: New support ticket ${ticket.ticketNumber} from ${ticket.clientName} (${ticket.priority}). ${ticket.subject}`
  const recipients = [...new Set([...ADMIN_ALERT_NUMBERS, cfg.superAdminPhone].filter(Boolean))] as string[]
  for (const number of recipients) void sendSms(number, alert).catch(() => { /**/ })
}

/** Fired when staff added at least one new reply and saved. `replyText` is
 *  the newest staff message, quoted so the client isn't just told "you have
 *  a reply" with no idea what it says. */
export async function notifyTicketReplied(ticket: Ticket, replyText: string): Promise<void> {
  const cfg = getNotifSettings()
  const client = await getClientContact(ticket)

  if (client.email) {
    void sendEmail({
      to: client.email,
      subject: `New reply on ticket ${ticket.ticketNumber}: ${ticket.subject}`,
      from: MAILBOXES.admin,
      body: `Dear ${ticket.clientName},

There's a new reply on your support ticket ${ticket.ticketNumber} (${ticket.subject}), currently ${statusLabel(ticket.status)}.

"${replyText}"

If this doesn't resolve things, just reply and we'll pick it back up.${cfg.signature ? `\n\n---\n${cfg.signature}` : ''}`,
    }).catch(() => { /**/ })
  }
  if (client.phone) {
    void sendSms(client.phone,
      `Enpasent Multiple Agent: You have a new reply on ticket ${ticket.ticketNumber} (${statusLabel(ticket.status)}). Check your email or log in for details.`,
    ).catch(() => { /**/ })
  }
}

export async function notifyTicketStatusChanged(ticket: Ticket, oldStatus: TicketStatus): Promise<void> {
  if (ticket.status === oldStatus) return
  const cfg = getNotifSettings()
  const client = await getClientContact(ticket)

  const reopened = oldStatus !== 'open' && ticket.status === 'open'
  const summary = reopened
    ? `Your ticket ${ticket.ticketNumber} (${ticket.subject}) has been reopened and is back with our team.`
    : `Your ticket ${ticket.ticketNumber} (${ticket.subject}) is now ${statusLabel(ticket.status)}.`

  if (client.email) {
    void sendEmail({
      to: client.email,
      subject: `Ticket ${ticket.ticketNumber} update: ${statusLabel(ticket.status)}`,
      from: MAILBOXES.admin,
      body: `Dear ${ticket.clientName},

${summary}
${ticket.status === 'resolved' || ticket.status === 'closed'
  ? '\nIf this doesn\'t fully address things, you can reopen the ticket and we\'ll take another look.'
  : ''}${cfg.signature ? `\n\n---\n${cfg.signature}` : ''}`,
    }).catch(() => { /**/ })
  }
  if (client.phone) {
    void sendSms(client.phone, `Enpasent Multiple Agent: ${summary}`).catch(() => { /**/ })
  }
}
