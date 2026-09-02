import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendViaAfrosoft, afrosoftAccepted, normalizeMsisdn, isValidMsisdn } from './_lib/afrosoft.js'

/**
 * Billing reminders, run on the server.
 *
 * These used to run only in the browser: src/lib/reminderEngine.ts starts an
 * hourly setInterval from App.tsx, so reminders, caution flags and
 * waiting-period activations happened only while a staff member happened to
 * have the app open on a screen somewhere. Close the last laptop and the
 * whole notification schedule silently stopped -- which is exactly what
 * "it works while we're building, then nothing happens when I go home"
 * looks like from the outside.
 *
 * Vercel Cron calls this once a day (see vercel.json). It is the same
 * schedule the browser engine implements:
 *
 *   R1  5 days before the last day of the month
 *   R2  1 day before
 *   R3  on the day            (+ SMS to the client)
 *   R4  5 days after          (+ caution flag, policy lapses)
 *
 * Safe to run alongside the in-app checker: every send is guarded by a
 * dedup row in `reminders` keyed on policy + due date + stage, so whichever
 * runs first wins and the other stands down.
 */

// ── Dates ──────────────────────────────────────────────────────────

function lastDayOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

/** House date format, day-month-year with a named month, matching
 *  src/lib/dateUtils.ts. Restated here because a serverless function cannot
 *  import from the app bundle — and a bare toLocaleDateString() would
 *  follow whatever locale the server happens to run in, which is how a date
 *  ends up month-first. */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`
}

/** Whole days from `from` to `to`, comparing dates only. */
function daysDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

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

// ── Rows ───────────────────────────────────────────────────────────

interface PolicyRow {
  id: string
  policy_number: string
  client_id: string
  product_id: string
  premium: number
  status: string
  dependants: { premium?: number }[] | null
  agent_id: string | null
  clients: { name: string; email: string | null; phone: string | null } | null
  products: { name: string; category: string } | null
}

/**
 * What the policy actually bills for one period.
 *
 * Premiums are per head — the policyholder plus one for each dependant —
 * so a reminder must not quote the policyholder's own share and ask a
 * family of four to pay for one. Agriculture is billed once a year on the
 * crop, not per person. Mirrors src/lib/premium.ts.
 */
function billablePremium(policy: PolicyRow): number {
  const own = Number(policy.premium) || 0
  if (policy.products?.category === 'agriculture') return own
  const deps = policy.dependants ?? []
  const total = deps.reduce((sum, d) => {
    const p = Number(d?.premium)
    return sum + (Number.isFinite(p) && p > 0 ? p : own)
  }, own)
  return Math.round(total * 100) / 100
}

// ── Delivery ───────────────────────────────────────────────────────

const SIGNATURE = 'Regards,\nMotions Microinsurance\nwww.motions.co.zw'

/** Reuses this deployment's own SMTP-backed mail function rather than
 *  standing up a second email integration. Best-effort: a bounced
 *  notification must never stop the rest of the run. */
async function sendMail(origin: string, input: { to: string; subject: string; text: string }): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'noreply@enpassent.co.zw', fromName: 'Motions Microinsurance', ...input }),
    })
    return res.ok
  } catch { return false }
}

/** Sends straight through Afrosoft with the server's own key — the browser
 *  path (/api/gateway-proxy) exists only because a browser has no key. Both
 *  go through api/_lib/afrosoft.ts, so a reminder and an in-app message
 *  reach the handset under the same sender ID. */
async function sendSms(to: string, message: string): Promise<boolean> {
  // A malformed number is skipped rather than sent: Afrosoft rejects an
  // entire batch when one recipient is bad.
  if (!isValidMsisdn(to)) return false
  try {
    const res = await sendViaAfrosoft(normalizeMsisdn(to), message)
    return res.ok && afrosoftAccepted(res.body)
  } catch { return false }
}

// ── Reminder bodies ────────────────────────────────────────────────

function clientEmailBody(policy: PolicyRow, type: ReminderType, due: string, amount: string): string {
  const name = policy.clients?.name ?? 'Client'
  const product = policy.products?.name ?? 'your policy'
  switch (type) {
    case 'r1_pre5': return `Dear ${name},\n\nThis is a friendly reminder that your insurance premium of $${amount} for policy ${policy.policy_number} (${product}) is due in 5 days on ${due}.\n\nPlease ensure your payment is ready to avoid any lapse in cover.\n\n${SIGNATURE}`
    case 'r2_pre1': return `Dear ${name},\n\nURGENT REMINDER: Your insurance premium of $${amount} for policy ${policy.policy_number} is due TOMORROW, ${due}.\n\nPlease pay immediately to maintain active coverage. You can pay via EcoCash, Paynow, Zipit, or at any of our offices.\n\n${SIGNATURE}`
    case 'r3_due': return `Dear ${name},\n\nYour insurance premium of $${amount} for policy ${policy.policy_number} is DUE TODAY, ${due}.\n\nFailure to pay today may result in your policy lapsing. Please pay now to avoid disruption to your coverage.\n\nPayment methods: EcoCash | Paynow | Zipit | Cash at office\n\n${SIGNATURE}`
    case 'r4_post5': return `Dear ${name},\n\nNOTICE OF OVERDUE PREMIUM: CAUTION FLAG APPLIED\n\nYour insurance premium for policy ${policy.policy_number} (${product}) was due on ${due} and remains unpaid as of today (5 days overdue).\n\nYour policy coverage may be at risk. Any claims submitted while your premium is in arrears may be subject to review or rejection.\n\nPlease settle $${amount} immediately to restore full coverage and remove this caution flag.\n\n${SIGNATURE}`
  }
}

// ── One policy ─────────────────────────────────────────────────────

interface RunStats { considered: number; emailed: number; texted: number; flagged: number; skipped: number }

async function dispatch(
  admin: SupabaseClient, origin: string, policy: PolicyRow, type: ReminderType, dueDate: Date, stats: RunStats,
) {
  const dueISO = dueDate.toISOString().split('T')[0]
  const tag = STAGE_TAG[type]

  // This row IS the dedup record. Checked before anything is sent so a
  // second run today — or the in-app checker — cannot re-send.
  const { data: already } = await admin
    .from('reminders')
    .select('id')
    .eq('policy_id', policy.id)
    .eq('due_date', dueISO)
    .like('message', `${tag}%`)
    .maybeSingle()
  if (already) { stats.skipped++; return }

  const amount = billablePremium(policy).toFixed(2)
  const dueLabel = formatDate(dueDate)
  const email = policy.clients?.email ?? ''
  const phone = policy.clients?.phone ?? ''

  if (email) {
    const ok = await sendMail(origin, {
      to: email,
      subject: type === 'r4_post5'
        ? `Overdue Notice: ${policy.policy_number} Caution Flag Applied`
        : `Premium Reminder: ${policy.policy_number} due ${formatDate(dueDate)}`,
      text: clientEmailBody(policy, type, dueLabel, amount),
    })
    if (ok) stats.emailed++
  }

  if (type === 'r3_due' && phone) {
    const ok = await sendSms(phone,
      `Enpasent Multiple Agent: Premium of $${amount} for policy ${policy.policy_number} is DUE TODAY. Pay now via EcoCash/Paynow to keep your coverage active.`)
    if (ok) stats.texted++
  }

  if (type === 'r4_post5') {
    await admin.from('caution_flags').upsert({
      policy_id: policy.id,
      policy_number: policy.policy_number,
      client_id: policy.client_id,
      client_name: policy.clients?.name ?? '',
      agent_id: policy.agent_id,
      days_overdue: 5,
      flagged_at: new Date().toISOString(),
      months_defaulted: 1,
      cleared: false,
    }, { onConflict: 'policy_id' })
    // Five days past due lapses the policy outright; paying later reinstates
    // it to a fresh waiting period rather than straight back to active.
    if (policy.status !== 'lapsed') {
      await admin.from('policies').update({ status: 'lapsed' }).eq('id', policy.id)
    }
    stats.flagged++
  }

  await admin.from('reminders').insert({
    type: 'payment_due',
    client_id: policy.client_id,
    policy_id: policy.id,
    due_date: dueISO,
    message: `${tag} ${STAGE_LABEL[type]}: ${policy.policy_number}`,
    sent: true,
    channel: 'email',
  })
}

/** Lifts a non-agriculture policy out of its waiting period once 90 days
 *  have passed and payment is current. Agriculture activates on first
 *  payment instead, so it is excluded rather than auto-activated by date. */
async function liftWaitingPeriods(admin: SupabaseClient): Promise<number> {
  const { data } = await admin
    .from('policies')
    .select('id, start_date, next_payment_date, products!product_id(category)')
    .eq('status', 'waiting_period')
  const today = new Date()
  let lifted = 0
  for (const row of (data ?? []) as unknown as { id: string; start_date: string; next_payment_date: string | null; products: { category: string } | null }[]) {
    if (row.products?.category === 'agriculture') continue
    if (Math.round((today.getTime() - new Date(row.start_date).getTime()) / 86400000) < 90) continue
    if (row.next_payment_date && new Date(row.next_payment_date) < today) continue
    await admin.from('policies').update({ status: 'active' }).eq('id', row.id)
    lifted++
  }
  return lifted
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Fail closed:
  // this endpoint emails and texts the entire book, so an unset secret must
  // refuse everyone rather than admit everyone. Guarding only when the
  // variable happened to exist left it wide open on any deployment built
  // before it was set.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return res.status(503).json({ error: 'CRON_SECRET is not configured, so this endpoint is disabled.' })
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server is not configured.' })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const origin = `https://${req.headers.host}`
  const today = new Date()
  const dueDate = lastDayOfMonth(today)
  const daysToLast = daysDiff(today, dueDate)

  const type: ReminderType | null =
    daysToLast === 5 ? 'r1_pre5'
    : daysToLast === 1 ? 'r2_pre1'
    : daysToLast === 0 ? 'r3_due'
    : daysToLast === -5 ? 'r4_post5'
    : null

  const lifted = await liftWaitingPeriods(admin)

  if (!type) {
    return res.status(200).json({ ran: today.toISOString(), stage: null, note: 'No reminder stage falls on today.', waitingPeriodsLifted: lifted })
  }

  const { data, error } = await admin
    .from('policies')
    .select('id, policy_number, client_id, product_id, premium, status, dependants, agent_id, clients!client_id(name, email, phone), products!product_id(name, category)')
    .in('status', ['active', 'waiting_period'])
  if (error) return res.status(500).json({ error: error.message })

  const policies = (data ?? []) as unknown as PolicyRow[]
  const stats: RunStats = { considered: policies.length, emailed: 0, texted: 0, flagged: 0, skipped: 0 }

  for (const policy of policies) {
    try {
      await dispatch(admin, origin, policy, type, dueDate, stats)
    } catch (e) {
      // One bad policy must not abandon the rest of the book.
      console.error('cron-reminders: policy failed', policy.policy_number, e)
    }
  }

  return res.status(200).json({
    ran: today.toISOString(),
    stage: `${STAGE_TAG[type]} ${STAGE_LABEL[type]}`,
    dueDate: dueDate.toISOString().split('T')[0],
    waitingPeriodsLifted: lifted,
    ...stats,
  })
}
