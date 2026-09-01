import type { Claim, ClaimStatus } from '../types'
import { sendEmail, getNotifSettings } from './mailService'
import { db } from './db'
import { MAILBOXES } from './mailboxes'
import { sendSms } from './smsService'

/** NetOne distribution partnership is suspended for now — flip this back
 *  once it resumes rather than re-wiring the notification pipeline. */
export const NETONE_SUSPENDED = true

async function getClientContact(claim: Claim): Promise<{ email: string; phone: string }> {
  const { data } = await db.clients.list()
  const client = data?.find(c => c.id === claim.clientId)
  return { email: client?.email ?? '', phone: client?.phone ?? '' }
}

function signature(sig: string) { return sig ? `\n\n---\n${sig}` : '' }

function claimSummaryBlock(claim: Claim) {
  return `
Claim Number:   ${claim.claimNumber}
Policy Number:  ${claim.policyNumber}
Client Name:    ${claim.clientName}
Product:        ${claim.productName}
Claim Type:     ${claim.claimType}
Amount:         $${claim.amount.toLocaleString()}
Date of Event:  ${claim.dateOfEvent}
Date Submitted: ${claim.dateSubmitted}
Status:         ${claim.status.replace('_', ' ').toUpperCase()}
${claim.description ? `\nDescription:\n${claim.description}` : ''}`
}

export async function notifyClaimCreated(claim: Claim): Promise<void> {
  const cfg = getNotifSettings()
  const client = await getClientContact(claim)

  const allEmails = [cfg.insurerEmail, NETONE_SUSPENDED ? '' : cfg.netoneEmail, client.email].filter(Boolean)
  const cc = allEmails.join(', ')

  const subject = `[New Claim] ${claim.claimNumber}: ${claim.clientName}`
  const staffBody = `A new insurance claim has been submitted and requires review.
${claimSummaryBlock(claim)}

Please log in to Tariqify IMS to review and process this claim.${signature(cfg.signature)}`

  const clientBody = `Dear ${claim.clientName},

Your insurance claim has been successfully submitted for processing. You can expect a response within 24 hours.
${claimSummaryBlock(claim)}

Please retain this email for your records. All parties will be copied on further updates.${signature(cfg.signature)}`

  void sendEmail({ to: cfg.insurerEmail, cc, subject, body: staffBody, linkedTo: claim.id, from: MAILBOXES.claims })
  if (!NETONE_SUSPENDED && cfg.netoneEmail) {
    void sendEmail({ to: cfg.netoneEmail, cc, subject, body: staffBody, linkedTo: claim.id, from: MAILBOXES.claims })
  }
  if (client.email) {
    void sendEmail({ to: client.email, cc, subject, body: clientBody, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims })
  }
  if (client.phone) {
    void sendSms(client.phone, `Tariqify: Your claim ${claim.claimNumber} has been submitted. You'll be notified as it progresses.`).catch(() => { /**/ })
  }
}

export async function notifyClaimStatusChanged(claim: Claim, previousStatus: ClaimStatus): Promise<void> {
  if (claim.status === previousStatus) return
  if (claim.status === 'paid') {
    await notifyClaimResolved(claim)
    return
  }

  const cfg = getNotifSettings()
  const client = await getClientContact(claim)

  const allEmails = [cfg.insurerEmail, NETONE_SUSPENDED ? '' : cfg.netoneEmail, client.email].filter(Boolean)
  const cc = allEmails.join(', ')

  const statusLabel = claim.status.replace('_', ' ')
  const subject = `[Claim Update] ${claim.claimNumber}: Status changed to ${statusLabel}`

  const staffBody = `Claim ${claim.claimNumber} status has changed from "${previousStatus.replace('_', ' ')}" to "${statusLabel}".
${claimSummaryBlock(claim)}

Log in to Tariqify IMS to take further action.${signature(cfg.signature)}`

  const clientBody = `Dear ${claim.clientName},

Your claim ${claim.claimNumber} has been updated. New status: ${statusLabel.toUpperCase()}.
${claimSummaryBlock(claim)}

We will keep you informed as this claim progresses. All parties are copied on this correspondence.${signature(cfg.signature)}`

  void sendEmail({ to: cfg.insurerEmail, cc, subject, body: staffBody, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims })
  if (!NETONE_SUSPENDED && cfg.netoneEmail) {
    void sendEmail({ to: cfg.netoneEmail, cc, subject, body: staffBody, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims })
  }
  if (client.email) {
    void sendEmail({ to: client.email, cc, subject, body: clientBody, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims })
  }
}

// ── Pipeline handoffs: intake (Claims Receiver) -> assessment (Claims
// Processor) -> final_review (MD/COO) -> closed. Each handoff notifies the
// client and whoever is picking the claim up next — never the agent (their
// portal reflects the outcome passively via the claim's own status/pill,
// no push notification, per the 2026-08 access review).

interface StaffContact { email?: string; phone?: string; name: string }

/** Every claims-pipeline stage escalates to the Super Admin (SMS) and the
 *  Motions info mailbox (email CC) — configured phone or not, in addition
 *  to the client and whichever staff member is picking the claim up next. */
const CLAIMS_ESCALATION_CC_EMAIL = 'info@motions.co.zw'

function notifySuperAdmin(claim: Claim, stageMessage: string) {
  const cfg = getNotifSettings()
  if (cfg.superAdminPhone) {
    void sendSms(cfg.superAdminPhone, `Tariqify: Claim ${claim.claimNumber}: ${stageMessage}`).catch(() => { /**/ })
  }
}

export async function notifyClaimIntakeAccepted(claim: Claim, processor: StaffContact): Promise<void> {
  const cfg = getNotifSettings()
  const client = await getClientContact(claim)
  const subject = `[Claim Received] ${claim.claimNumber}: Now with Claims Processing`
  notifySuperAdmin(claim, `accepted at intake, assigned to ${processor.name} for assessment.`)

  if (client.email) {
    void sendEmail({
      to: client.email, cc: CLAIMS_ESCALATION_CC_EMAIL, subject, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims,
      body: `Dear ${claim.clientName},\n\nYour claim ${claim.claimNumber} has been received and accepted for processing.${claimSummaryBlock(claim)}\n\nIt is now with our claims processing team for assessment.${signature(cfg.signature)}`,
    })
  }
  if (client.phone) void sendSms(client.phone, `Tariqify: Your claim ${claim.claimNumber} was received and is now being processed.`).catch(() => { /**/ })

  if (processor.email) {
    void sendEmail({
      to: processor.email, subject: `[Assigned] Claim ${claim.claimNumber} needs assessment`, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims,
      body: `${claim.claimNumber} has been accepted at intake and assigned to you for assessment.${claimSummaryBlock(claim)}\n\nLog in to Tariqify IMS to review.${signature(cfg.signature)}`,
    })
  }
  if (processor.phone) void sendSms(processor.phone, `Tariqify: Claim ${claim.claimNumber} assigned to you for assessment.`).catch(() => { /**/ })
}

export async function notifyClaimIntakeRejected(claim: Claim): Promise<void> {
  const cfg = getNotifSettings()
  const client = await getClientContact(claim)
  const subject = `[Claim Not Accepted] ${claim.claimNumber}`
  notifySuperAdmin(claim, 'rejected at intake.')
  if (client.email) {
    void sendEmail({
      to: client.email, cc: CLAIMS_ESCALATION_CC_EMAIL, subject, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims,
      body: `Dear ${claim.clientName},\n\nWe were unable to accept your claim ${claim.claimNumber} for processing.${claimSummaryBlock(claim)}\n\nPlease contact us if you believe this is in error.${signature(cfg.signature)}`,
    })
  }
  if (client.phone) void sendSms(client.phone, `Tariqify: Your claim ${claim.claimNumber} could not be accepted. Please contact us for details.`).catch(() => { /**/ })
}

export async function notifyClaimEscalated(claim: Claim, reviewer: StaffContact): Promise<void> {
  const cfg = getNotifSettings()
  const client = await getClientContact(claim)
  const subject = `[Claim Under Final Review] ${claim.claimNumber}`
  notifySuperAdmin(claim, `escalated to ${reviewer.name} for final review.`)

  if (client.email) {
    void sendEmail({
      to: client.email, cc: CLAIMS_ESCALATION_CC_EMAIL, subject, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims,
      body: `Dear ${claim.clientName},\n\nYour claim ${claim.claimNumber} has completed assessment and is now with our final reviewer for a decision.${claimSummaryBlock(claim)}${signature(cfg.signature)}`,
    })
  }
  if (client.phone) void sendSms(client.phone, `Tariqify: Your claim ${claim.claimNumber} is now with our final reviewer.`).catch(() => { /**/ })

  if (reviewer.email) {
    void sendEmail({
      to: reviewer.email, subject: `[Decision Needed] Claim ${claim.claimNumber}`, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims,
      body: `${claim.claimNumber} has been assessed and escalated to you for a final decision.${claimSummaryBlock(claim)}${claim.assessmentNotes ? `\n\nAssessment notes:\n${claim.assessmentNotes}` : ''}\n\nLog in to Tariqify IMS to approve or decline.${signature(cfg.signature)}`,
    })
  }
  if (reviewer.phone) void sendSms(reviewer.phone, `Tariqify: Claim ${claim.claimNumber} needs your final decision.`).catch(() => { /**/ })
}

export async function notifyClaimFinalDecision(claim: Claim): Promise<void> {
  const cfg = getNotifSettings()
  const client = await getClientContact(claim)
  const approved = claim.status === 'approved'
  const subject = `[Claim ${approved ? 'Approved' : 'Declined'}] ${claim.claimNumber}`
  notifySuperAdmin(claim, `final decision: ${approved ? 'APPROVED' : 'DECLINED'}.`)

  if (client.email) {
    void sendEmail({
      to: client.email, cc: CLAIMS_ESCALATION_CC_EMAIL, subject, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims,
      body: `Dear ${claim.clientName},\n\nA final decision has been made on your claim ${claim.claimNumber}: ${approved ? 'APPROVED' : 'DECLINED'}.${claimSummaryBlock(claim)}\n\n${approved ? 'Payment will be processed shortly.' : 'If you have questions about this decision, please contact us.'}${signature(cfg.signature)}`,
    })
  }
  if (client.phone) {
    void sendSms(client.phone, `Tariqify: Your claim ${claim.claimNumber} has been ${approved ? 'APPROVED' : 'DECLINED'}.`).catch(() => { /**/ })
  }
}

async function notifyClaimResolved(claim: Claim): Promise<void> {
  const cfg = getNotifSettings()
  const client = await getClientContact(claim)

  const allEmails = [cfg.insurerEmail, NETONE_SUSPENDED ? '' : cfg.netoneEmail, client.email].filter(Boolean)
  const cc = allEmails.join(', ')

  const subject = `[Claim Closed] ${claim.claimNumber}: Payment Processed`

  const staffBody = `Claim ${claim.claimNumber} has been resolved and payment processed.
${claimSummaryBlock(claim)}

This claim is now closed. No further action required.${signature(cfg.signature)}`

  const clientBody = `Dear ${claim.clientName},

We are pleased to inform you that your claim ${claim.claimNumber} has been approved and payment of $${claim.amount.toLocaleString()} has been processed.
${claimSummaryBlock(claim)}

Thank you for choosing our insurance services.${signature(cfg.signature)}`

  void sendEmail({ to: cfg.insurerEmail, cc, subject, body: staffBody, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims })
  if (!NETONE_SUSPENDED && cfg.netoneEmail) {
    void sendEmail({ to: cfg.netoneEmail, cc, subject, body: staffBody, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims })
  }
  if (client.email) {
    void sendEmail({ to: client.email, cc, subject, body: clientBody, linkedTo: claim.id, folder: 'claims', from: MAILBOXES.claims })
  }
}
