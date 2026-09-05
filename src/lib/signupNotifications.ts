import type { Policy, Client } from '../types'
import { sendSms } from './smsService'
import { sendEmail, getNotifSettings } from './mailService'
import { MAILBOXES } from './mailboxes'
import { premiumPeriodLabel } from './productUtils'
import { db } from './db'

/**
 * Fires the moment a policy is registered, by whatever route -- an agent in
 * the office, or a self-service checkout on the public site.
 *
 * Both the new client and the Enpasent office are told immediately: the
 * client gets confirmation of what was registered, and the office gets a
 * heads-up they can act on without opening the system.
 *
 * Enpasent is the broker the client actually deals with -- it places
 * business with almost every insurer in Zimbabwe, Motions included -- so
 * every client-facing message here speaks as Enpasent. Which insurer ends
 * up carrying the risk is a separate fact, shown on the policy itself, never
 * baked into the greeting.
 *
 * Everything here is best-effort and never rethrows. A registration that
 * succeeded must not appear to fail because a text message or a mailbox was
 * temporarily unreachable.
 */

/** Office lines that receive a text on every new registration. */
export const ADMIN_ALERT_NUMBERS = [
  '+263780086175',
  '+263780086176',
  '+263780086177',
  '+263780086178',
]

function money(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * A client registered on the CRM, before any policy exists. Deliberately
 * worded as "registered", never "covered" -- someone on file without a
 * policy has no cover, and telling them otherwise would be the worst kind
 * of mistake for an insurer to make by SMS.
 */
export async function notifyClientRegistered(client: Client, registeredBy?: string): Promise<void> {
  const cfg = getNotifSettings()

  if (client.phone) {
    void sendSms(
      client.phone,
      `Enpasent Multiple Agent: Welcome ${client.name.split(' ')[0]}, your details are registered with us. An agent will be in touch to arrange cover.`,
    ).catch(() => { /**/ })
  }

  if (client.email) {
    void sendEmail({
      to: client.email,
      subject: 'Welcome to Enpasent Multiple Agent',
      from: MAILBOXES.noreply,
      body: `Dear ${client.name},

Your details have been registered with Enpasent Multiple Agent.

Name:        ${client.name}
National ID: ${client.nationalId || 'not given'}
Phone:       ${client.phone || 'not given'}

Please note this registration does not itself put any cover in place. One of our agents will contact you to arrange a policy suited to you.${cfg.signature ? `\n\n---\n${cfg.signature}` : ''}`,
    }).catch(() => { /**/ })
  }

  // Staff only. The client's own SMS and email above say nothing about this:
  // every insurer on the list is screened and under agreement, so a
  // The office's queue of people still to be asked which insurer they want.
  // Says only that the question is outstanding -- naming what the record
  // currently holds would put an internal arrangement into a text message.
  const provisional = client.insurerProvisional && client.insurer
    ? ' Insurer still to be confirmed.'
    : ''
  const alert = `Enpasent: New client registered. ${client.name}, ${client.phone || 'no phone'}${registeredBy ? `, by ${registeredBy}` : ''}. No policy yet.${provisional}`
  const recipients = [...new Set([...ADMIN_ALERT_NUMBERS, cfg.superAdminPhone].filter(Boolean))] as string[]
  for (const number of recipients) {
    void sendSms(number, alert).catch(() => { /**/ })
  }
}

export async function notifyPolicyRegistered(policy: Policy, client: Client): Promise<void> {
  const cfg = getNotifSettings()
  const period = premiumPeriodLabel(policy.productCategory ?? '')
  const cover = money(policy.coverAmount)
  const premium = `${money(policy.premium)}${period}`

  // ── The client ────────────────────────────────────────────────────
  if (client.phone) {
    const waiting = policy.status === 'waiting_period'
      ? ' Your waiting period has started; we will confirm when cover is active.'
      : ' Your cover is active.'
    void sendSms(
      client.phone,
      `Enpasent Multiple Agent: Welcome ${client.name.split(' ')[0]}. Policy ${policy.policyNumber} (${policy.productName}) is registered, cover ${cover}.${waiting}`,
    ).catch(() => { /**/ })
  }

  if (client.email) {
    void sendEmail({
      to: client.email,
      subject: `Policy ${policy.policyNumber} registered: welcome to Enpasent Multiple Agent`,
      from: MAILBOXES.noreply,
      body: `Dear ${client.name},

Thank you for choosing Enpasent Multiple Agent. Your policy has been registered.

Policy Number:  ${policy.policyNumber}
Product:        ${policy.productName}${policy.insurer ? `\nInsurer:        ${policy.insurer}` : ''}
Cover Amount:   ${cover}
Premium:        ${premium}
Start Date:     ${policy.startDate}
Status:         ${policy.status.replace('_', ' ').toUpperCase()}

${policy.status === 'waiting_period'
  ? 'Your policy is in its waiting period. We will let you know as soon as cover becomes active.'
  : 'Your cover is active from the start date shown above.'}

Keep this email for your records. If any detail above is wrong, contact us and we will correct it.${cfg.signature ? `\n\n---\n${cfg.signature}` : ''}`,
    }).catch(() => { /**/ })
  }

  // ── The office ─────────────────────────────────────────────────────
  const alert = `Enpasent: New policy ${policy.policyNumber} registered. ${client.name}, ${policy.productName}, cover ${cover}, premium ${premium}. Contact ${client.phone || 'not given'}.`
  // Deduplicated in case the configured super-admin line is already one of
  // the office numbers -- nobody wants the same alert twice.
  const recipients = [...new Set([...ADMIN_ALERT_NUMBERS, cfg.superAdminPhone].filter(Boolean))] as string[]
  for (const number of recipients) {
    void sendSms(number, alert).catch(() => { /**/ })
  }

  // A broker places business with almost every insurer in Zimbabwe, so one
  // fixed cfg.insurerEmail cannot be "the" insurer for every policy -- it
  // used to receive every new-policy notice regardless of who actually
  // underwrites it. This looks up the insurer that policy.insurer actually
  // names and, when that record has its own contact address on file, sends
  // there instead. cfg.insurerEmail survives only as a fallback: for a
  // policy with no insurer chosen yet, for an insurer without a contact
  // email on file, or if the lookup itself fails -- never silently dropped,
  // but never assumed to be correct either.
  let insurerRecipient = cfg.insurerEmail
  if (policy.insurer) {
    try {
      const { data: insurerRecords } = await db.insurers.list()
      const matched = insurerRecords.find(i => i.name.toLowerCase() === policy.insurer!.toLowerCase())
      if (matched?.contactEmail) insurerRecipient = matched.contactEmail
    } catch { /* falls back to cfg.insurerEmail below */ }
  }

  if (insurerRecipient) {
    void sendEmail({
      to: insurerRecipient,
      subject: `[New Policy] ${policy.policyNumber}: ${client.name}`,
      from: MAILBOXES.admin,
      body: `A new policy has been registered.

Policy Number:  ${policy.policyNumber}
Client:         ${client.name}
National ID:    ${client.nationalId || 'not given'}
Phone:          ${client.phone || 'not given'}
Email:          ${client.email || 'not given'}
Product:        ${policy.productName}
Insurer:        ${policy.insurer || 'not chosen yet'}
Cover Amount:   ${cover}
Premium:        ${premium}
Start Date:     ${policy.startDate}
Status:         ${policy.status.replace('_', ' ').toUpperCase()}
Payment Method: ${policy.paymentMethod}
${policy.agentName ? `Registered by:  ${policy.agentName}` : 'Registered through the public website.'}${cfg.signature ? `\n\n---\n${cfg.signature}` : ''}`,
    }).catch(() => { /**/ })
  }
}
