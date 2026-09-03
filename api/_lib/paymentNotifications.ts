import type { SupabaseClient } from '@supabase/supabase-js'
import { sendViaAfrosoft, normalizeMsisdn, isValidMsisdn, BRAND_NAME } from './afrosoft.js'
import type { ReconcileResult } from './paynowReconcile.js'

/**
 * Telling people what happened to their money.
 *
 * This lives on the server because that is now the only place that reliably
 * knows. The payer is sent to Paynow's own page in a full-page redirect, so
 * by the time a payment settles the browser that started it has navigated
 * away — it cannot send a receipt, and for a payer who never comes back it
 * does not run again at all. Whichever of the three reconcile routes gets
 * there first (webhook, /payment/return, the sweep) sends from here.
 *
 * Two audiences, and the second one matters more than it looks:
 *
 *   the client   a receipt, so a payment is not silently absorbed
 *   the office   an amount mismatch, which credits nothing and needs a human
 *
 * That office alert used to be raised in the browser, which after the
 * redirect almost never runs — so a mismatch found by the webhook reached
 * nobody but a server log. A payment that cleared for the wrong amount and
 * that no one is told about is the worst state this system can be in.
 *
 * Every send here is best-effort and independently caught: a failed SMS must
 * never roll back a payment that genuinely settled, and must never stop the
 * other notifications going out.
 */

/** The office lines that receive operational alerts. Mirrors
 *  ADMIN_ALERT_NUMBERS in src/lib/signupNotifications.ts — restated because
 *  a serverless function cannot import from the app bundle (src/lib/db.ts
 *  pulls in import.meta.env, a Vite build-time construct). Keep in sync. */
const ADMIN_ALERT_NUMBERS = [
  '+263780086175',
  '+263780086176',
  '+263780086177',
  '+263780086178',
]

const CURRENCY_SYMBOL: Record<string, string> = { USD: 'US$', ZWG: 'ZiG ' }

function money(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined || !Number.isFinite(amount)) return 'an unknown amount'
  return `${CURRENCY_SYMBOL[currency ?? 'USD'] ?? '$'}${amount.toFixed(2)}`
}

/** Best-effort SMS. A bad number is skipped rather than sent: Afrosoft
 *  rejects an entire batch when one recipient is malformed. */
async function text(to: string, message: string): Promise<void> {
  try {
    if (!to || !isValidMsisdn(to)) return
    await sendViaAfrosoft(normalizeMsisdn(to), message)
  } catch { /* never let a notification failure surface as a payment failure */ }
}

/** Reuses this deployment's own SMTP-backed mail function rather than
 *  standing up a second integration, exactly as api/cron-reminders.ts does. */
async function mail(origin: string, input: { to: string; subject: string; text: string }): Promise<void> {
  try {
    if (!input.to) return
    await fetch(`${origin}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'noreply@motions.co.zw', fromName: BRAND_NAME, ...input }),
    })
  } catch { /* as above */ }
}

interface PaymentContext {
  policyNumber: string
  productName: string
  clientName: string
  clientPhone: string
  clientEmail: string
}

/** Everything needed to write a receipt, from the reference alone. */
async function contextFor(admin: SupabaseClient, reference: string): Promise<PaymentContext | null> {
  const { data: txn } = await admin
    .from('paynow_transactions').select('policy_id').eq('reference', reference).maybeSingle()
  if (!txn?.policy_id) return null

  const { data: policy } = await admin
    .from('policies')
    .select('policy_number, clients!client_id(name, email, phone), products!product_id(name)')
    .eq('id', txn.policy_id)
    .maybeSingle()
  if (!policy) return null

  const row = policy as unknown as {
    policy_number: string
    clients: { name: string; email: string | null; phone: string | null } | null
    products: { name: string } | null
  }
  return {
    policyNumber: row.policy_number ?? '',
    productName: row.products?.name ?? 'your policy',
    clientName: row.clients?.name ?? 'Client',
    clientPhone: row.clients?.phone ?? '',
    clientEmail: row.clients?.email ?? '',
  }
}

/**
 * Sends whatever this outcome warrants. Safe to call after every reconcile:
 * it decides for itself whether anything should go out.
 *
 * Only the call that actually made the transition notifies — `alreadyHandled`
 * marks the routes that arrived second, so a client is not texted a receipt
 * once per reconcile route.
 */
export async function notifyPaymentOutcome(
  admin: SupabaseClient, result: ReconcileResult, origin: string,
): Promise<void> {
  if (result.alreadyHandled) return
  if (result.outcome !== 'paid' && result.outcome !== 'mismatch') return

  let ctx: PaymentContext | null = null
  try {
    ctx = await contextFor(admin, result.reference)
  } catch (e) {
    console.error('paymentNotifications: could not load context', result.reference, e)
  }

  const amount = money(result.confirmedAmount, result.currency)

  if (result.outcome === 'paid') {
    if (!ctx) return
    const first = ctx.clientName.split(' ')[0] || 'there'
    await Promise.allSettled([
      text(ctx.clientPhone,
        `${BRAND_NAME}: Thank you ${first}. We have received ${amount} for policy ${ctx.policyNumber}. Ref ${result.reference}.`),
      mail(origin, {
        to: ctx.clientEmail,
        subject: `Payment received: ${ctx.policyNumber}`,
        text: `Dear ${ctx.clientName},

We have received your payment of ${amount} for policy ${ctx.policyNumber} (${ctx.productName}).

Payment reference: ${result.reference}

Your cover is up to date. Keep this email for your records — if anything above looks wrong, contact us and we will correct it.

Regards,
${BRAND_NAME}`,
      }),
    ])
    return
  }

  // A mismatch. Paynow says the reference cleared, but not for what it was
  // initiated for, so nothing has been credited.
  //
  // The client is deliberately NOT texted here. Their money may well have
  // moved, and both available messages would be wrong: "payment received"
  // is false, and "payment failed" could be worse — telling someone their
  // payment failed when they have in fact paid invites a second payment.
  // A human reconciles it and then tells them what is actually true.
  const detail = ctx
    ? `${ctx.clientName} (${ctx.policyNumber}): confirmed ${amount}, expected ${money(result.expectedAmount, result.currency)}.`
    : `Reference ${result.reference}: confirmed ${amount}, expected ${money(result.expectedAmount, result.currency)}.`
  const alert = `Enpasent: PAYMENT AMOUNT MISMATCH. ${detail} Ref ${result.reference}. Not credited -- needs manual reconciliation.`

  console.error('paymentNotifications: mismatch alert', alert)
  await Promise.allSettled(ADMIN_ALERT_NUMBERS.map(n => text(n, alert)))
}
