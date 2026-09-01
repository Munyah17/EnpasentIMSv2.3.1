/**
 * Billing Reminder Engine
 *
 * Billing cycle: 1st → last day of each month (configured globally).
 * Reminder schedule per policy:
 *   R1: 5 days before last day of month
 *   R2: 1 day before last day of month
 *   R3: Last day of month (+ 1 SMS via smsService)
 *   R4: 5 days AFTER last day → caution flag applied
 *
 * Runs client-side (hourly, from whichever staff member has the app open)
 * against real policies/clients. Dedup is tracked in the `reminders` table
 * itself (not localStorage) so it holds regardless of how many staff
 * browsers are open at once — otherwise each one would independently
 * re-send the same reminder. For guaranteed delivery even when no staff
 * are logged in, migrate this to a Netlify Scheduled Function (cron) that
 * calls the same dispatch logic server-side.
 */
import type { Policy, Client, Reminder } from '../types'
import { db } from './db'
import { MAILBOXES } from './mailboxes'
import { sendEmail, getNotifSettings } from './mailService'
import { sendSms } from './smsService'
import { NETONE_SUSPENDED } from './claimNotifications'
import { policyBillablePremium } from './premium'
import { formatDate } from './dateUtils'

const CHECK_KEY = 'tqfy_reminder_last_check'

/** What the client actually owes this cycle. Premiums are per head, so this
 *  is the policyholder plus every dependant — quoting policy.premium here
 *  asked a family to pay one person's share. */
function amountDue(policy: Policy): number {
  return policyBillablePremium(policy)
}

// ── Billing date helpers ───────────────────────────────────────────

/** Last day of the current month */
export function lastDayOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

/** First day of the current month */
export function firstDayOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/** Next due date for a policy (last day of current month, or next if already past) */
export function getNextDueDate(_policy: Policy): Date {
  const today = new Date()
  const lastDay = lastDayOfMonth(today)
  if (today > lastDay) {
    return lastDayOfMonth(new Date(today.getFullYear(), today.getMonth() + 1, 1))
  }
  return lastDay
}

/** Days between two dates (positive = future, negative = past) */
function daysDiff(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

// ── Stage tags (dedup markers stored in reminders.message) ────────

type ReminderType = 'r1_pre5' | 'r2_pre1' | 'r3_due' | 'r4_post5'

const STAGE_TAG: Record<ReminderType, string> = {
  r1_pre5: '[R1]', r2_pre1: '[R2]', r3_due: '[R3]', r4_post5: '[R4]',
}

const STAGE_LABEL: Record<ReminderType, string> = {
  r1_pre5: '5-Day Pre-Due Reminder',
  r2_pre1: '1-Day Pre-Due Reminder',
  r3_due: 'Due Date Reminder',
  r4_post5: 'OVERDUE: Caution Flag Applied',
}

// ── Email templates ────────────────────────────────────────────────

function buildReminderEmail(policy: Policy, type: ReminderType, dueDate: Date, sig: string): string {
  const due = dueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  switch (type) {
    case 'r1_pre5': return `Dear ${policy.clientName},

This is a friendly reminder that your insurance premium of $${amountDue(policy).toFixed(2)} for policy ${policy.policyNumber} (${policy.productName}) is due in 5 days on ${due}.

Please ensure your payment is ready to avoid any lapse in cover.

${sig}`
    case 'r2_pre1': return `Dear ${policy.clientName},

URGENT REMINDER: Your insurance premium of $${amountDue(policy).toFixed(2)} for policy ${policy.policyNumber} is due TOMORROW, ${due}.

Please pay immediately to maintain active coverage. You can pay via EcoCash, Paynow, Zipit, or at any of our offices.

${sig}`
    case 'r3_due': return `Dear ${policy.clientName},

Your insurance premium of $${amountDue(policy).toFixed(2)} for policy ${policy.policyNumber} is DUE TODAY, ${due}.

Failure to pay today may result in your policy lapsing. Please pay now to avoid disruption to your coverage.

Payment methods: EcoCash | Paynow | Zipit | Cash at office

${sig}`
    case 'r4_post5': return `Dear ${policy.clientName},

NOTICE OF OVERDUE PREMIUM: CAUTION FLAG APPLIED

Your insurance premium for policy ${policy.policyNumber} (${policy.productName}) was due on ${due} and remains unpaid as of today (5 days overdue).

⚠ IMPORTANT: Your policy coverage may be at risk. Any claims submitted while your premium is in arrears may be subject to review or rejection.

Please settle $${amountDue(policy).toFixed(2)} immediately to restore full coverage and remove this caution flag.

Payment methods: EcoCash | Paynow | Zipit | Cash at office

${sig}`
  }
}

function buildStaffEmail(policy: Policy, type: ReminderType, dueDate: Date, sig: string): string {
  const due = dueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  return `Billing Reminder Alert: ${STAGE_LABEL[type]}

Policy: ${policy.policyNumber}
Client: ${policy.clientName}
Product: ${policy.productName}
Premium Due: $${amountDue(policy).toFixed(2)}
Due Date: ${due}
${type === 'r4_post5' ? '\n⚠ Caution flag has been applied to this policy. Client, agent, and insurer are notified.\n' : ''}

${sig}`
}

// ── Core dispatch ──────────────────────────────────────────────────

async function dispatchReminder(policy: Policy, client: Client | undefined, type: ReminderType, dueDate: Date) {
  const dueISO = dueDate.toISOString().split('T')[0]
  const tag = STAGE_TAG[type]

  const already = await db.reminders.existsForStage(policy.id, dueISO, tag)
  if (already) return

  const cfg = getNotifSettings()
  const clientEmail = client?.email ?? ''
  const clientPhone = client?.phone ?? ''

  const allCc = [cfg.insurerEmail, NETONE_SUSPENDED ? '' : cfg.netoneEmail].filter(Boolean).join(', ')
  const sig = cfg.signature

  if (clientEmail) {
    void sendEmail({
      to: clientEmail,
      cc: allCc,
      subject: type === 'r4_post5'
        ? `⚠ Overdue Notice: ${policy.policyNumber} Caution Flag Applied`
        : `Premium Reminder: ${policy.policyNumber} due ${formatDate(dueDate)}`,
      body: buildReminderEmail(policy, type, dueDate, sig),
      folder: 'inbox',
      linkedTo: policy.id,
      from: MAILBOXES.noreply,
    })
  }

  const staffBody = buildStaffEmail(policy, type, dueDate, sig)
  const staffSubject = `[Billing Alert] ${policy.policyNumber}: ${policy.clientName}`
  if (cfg.insurerEmail) void sendEmail({ to: cfg.insurerEmail, cc: NETONE_SUSPENDED ? undefined : cfg.netoneEmail, subject: staffSubject, body: staffBody, folder: 'inbox', from: MAILBOXES.noreply })
  if (!NETONE_SUSPENDED && cfg.netoneEmail) void sendEmail({ to: cfg.netoneEmail, subject: staffSubject, body: staffBody, folder: 'inbox', from: MAILBOXES.noreply })

  if (type === 'r3_due' && clientPhone) {
    sendSms(clientPhone,
      `Tariqify: Premium of $${amountDue(policy).toFixed(2)} for policy ${policy.policyNumber} is DUE TODAY. Pay now via EcoCash/Paynow to keep your coverage active.`
    ).catch(() => { /**/ })
  }

  if (type === 'r4_post5') {
    await db.cautionFlags.set({
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      clientId: policy.clientId,
      clientName: policy.clientName,
      agentId: policy.agentId,
      daysOverdue: 5,
      flaggedAt: new Date().toISOString(),
      monthsDefaulted: 1,
      cleared: false,
    })
    // A payment missed by 5 days lapses the policy outright — reinstating
    // later drops it back to a fresh waiting_period rather than straight
    // back to active (see applyCompletedPaymentToPolicy in db.ts).
    if (policy.status !== 'lapsed') {
      await db.policies.update(policy.id, { status: 'lapsed' })
    }
  }

  // Logged after sending — this row IS the dedup record for this stage.
  await db.reminders.create({
    type: 'payment_due',
    clientId: policy.clientId,
    policyId: policy.id,
    dueDate: dueISO,
    message: `${tag} ${STAGE_LABEL[type]}: ${policy.policyNumber}`,
    sent: true,
    channel: 'email',
  } as Omit<Reminder, 'id'>)
}

// ── Engine entry point ─────────────────────────────────────────────

export async function runReminderCheck() {
  const today = new Date()
  const lastDue = lastDayOfMonth(today)
  const daysToLast = daysDiff(today, lastDue)

  let type: ReminderType | null = null
  if (daysToLast === 5) type = 'r1_pre5'
  else if (daysToLast === 1) type = 'r2_pre1'
  else if (daysToLast === 0) type = 'r3_due'
  else if (daysToLast === -5) type = 'r4_post5'
  if (!type) { try { localStorage.setItem(CHECK_KEY, today.toISOString()) } catch { /**/ }; return }

  const [{ data: allPolicies }, { data: allClients }] = await Promise.all([db.policies.list(), db.clients.list()])
  const policies = (allPolicies ?? []).filter(p => p.status === 'active' || p.status === 'waiting_period')
  const clientById = new Map((allClients ?? []).map(c => [c.id, c]))

  for (const policy of policies) {
    await dispatchReminder(policy, clientById.get(policy.clientId), type, lastDue)
  }

  try { localStorage.setItem(CHECK_KEY, today.toISOString()) } catch { /**/ }
}

const WAITING_PERIOD_DAYS = 90

/** Lifts a non-agriculture policy out of its waiting period once 90 days
 *  have passed since its start date, as long as payment is current —
 *  agriculture never sits in waiting_period this long since it activates
 *  instantly on first payment (see applyCompletedPaymentToPolicy in db.ts),
 *  so it's excluded here rather than accidentally auto-activated by date. */
export async function checkWaitingPeriodElapsed() {
  const [{ data: allPolicies }, { data: allProducts }] = await Promise.all([db.policies.list(), db.products.list()])
  const categoryByProductId = new Map((allProducts ?? []).map(p => [p.id, p.category]))
  const today = new Date()

  for (const policy of allPolicies ?? []) {
    if (policy.status !== 'waiting_period') continue
    if (categoryByProductId.get(policy.productId) === 'agriculture') continue
    const daysSinceStart = Math.round((today.getTime() - new Date(policy.startDate).getTime()) / 86400000)
    if (daysSinceStart < WAITING_PERIOD_DAYS) continue
    const overdue = policy.nextPaymentDate ? new Date(policy.nextPaymentDate) < today : false
    if (overdue) continue
    await db.policies.update(policy.id, { status: 'active' })
  }
}

export function getLastCheckTime(): string | null {
  return localStorage.getItem(CHECK_KEY)
}

export function getUpcomingDueCount(): number {
  // Synchronous by design (used for a lightweight badge) — real due-soon
  // counts are shown properly on the Reminders/Billing pages, which fetch
  // real data async. This just answers "is anything due within a week".
  const today = new Date()
  const lastDue = lastDayOfMonth(today)
  const daysToLast = daysDiff(today, lastDue)
  return daysToLast >= 0 && daysToLast <= 7 ? 1 : 0
}

/** Start hourly in-app checker. Call once from App.tsx. */
export function startReminderEngine(): () => void {
  void runReminderCheck()
  void checkWaitingPeriodElapsed()
  const interval = setInterval(() => {
    void runReminderCheck()
    void checkWaitingPeriodElapsed()
  }, 3600000) // every hour
  return () => clearInterval(interval)
}


