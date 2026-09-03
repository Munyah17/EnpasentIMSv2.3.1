import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The single decision point for "did this payment actually happen, and for
 * the right amount".
 *
 * Three different things now learn that a Paynow transaction settled:
 *
 *   1. api/paynow-webhook.ts    — Paynow POSTs the moment it settles
 *   2. api/paynow.ts 'verify'   — the payer lands back on /payment/return
 *   3. api/paynow-reconcile.ts  — a sweep that re-polls stragglers
 *
 * They exist because any one of them can miss. A webhook can be lost or
 * arrive at a deployment that was mid-rollout; a payer can close the tab
 * before being redirected back; a browser can die on the return leg. That
 * is the "payment went through but the app never confirmed it" case, and
 * the only defence is more than one route to the same answer.
 *
 * What must NOT happen is those three routes disagreeing, or crediting the
 * same payment twice. So none of them decides anything themselves: each
 * one's only job is to obtain Paynow's verdict and hand it here.
 *
 * Two independent guards make that safe:
 *
 *   - The confirmed amount must equal what THIS reference was initiated for
 *     (paynow_transactions.expected_amount, written at initiate time).
 *     "Paid" only means the reference cleared; it says nothing about the
 *     amount. A mismatch is never quietly accepted as a partial win — it is
 *     parked as 'mismatch' for a human and credits nothing.
 *   - payments.reference is UNIQUE. Whichever route arrives first inserts;
 *     the others hit the constraint and are told "already recorded", not an
 *     error. The policy is only advanced by the insert that actually won,
 *     so a premium is never counted twice.
 */

export type ReconcileOutcome =
  | 'paid'               // credited by this call
  | 'already'            // credited by an earlier call; nothing to do
  | 'mismatch'           // paid, but not for the expected amount — parked
  | 'failed'             // cancelled or disputed
  | 'pending'            // Paynow has no verdict yet
  | 'unknown-reference'  // never recorded at initiate time
  | 'policy-missing'     // row points at a policy that no longer exists
  | 'write-failed'       // could not record; caller should allow a retry

export interface GatewayVerdict {
  /** Paynow's status string, lowercased. */
  status: string
  /** The amount Paynow says it collected. */
  amount: number
  paynowReference?: string | null
}

export interface ReconcileResult {
  outcome: ReconcileOutcome
  reference: string
  expectedAmount?: number
  confirmedAmount?: number
  currency?: string
  note?: string
  /**
   * True when this call found the transaction already in its final state
   * rather than putting it there.
   *
   * Three routes reconcile the same reference, so without this a client
   * would be texted a receipt once per route. Only the call that actually
   * made the transition notifies anybody.
   */
  alreadyHandled?: boolean
}

/** Paynow reports a delivered-goods flow as "awaiting delivery"; for an
 *  insurance premium there is nothing to deliver, so it means paid. */
function isPaid(status: string): boolean {
  return status === 'paid' || status === 'awaiting delivery'
}

function isFailed(status: string): boolean {
  return status === 'cancelled' || status === 'disputed'
}

/** Mirrors src/lib/premium.ts's policyBillablePremium (per head: the
 *  policyholder's premium plus one per dependant, each falling back to the
 *  policyholder's own premium when it has none of its own). Duplicated
 *  rather than imported because src/lib/db.ts pulls in src/lib/supabase.ts,
 *  which reads import.meta.env — a Vite build-time construct with no
 *  equivalent in a Vercel Node function, so importing it here would fail at
 *  module load. Keep in sync with premium.ts if that math changes. */
function billablePremium(policy: { premium: number; dependants: unknown }): number {
  const dependants = Array.isArray(policy.dependants) ? policy.dependants as { premium?: number }[] : []
  const lines = [
    policy.premium,
    ...dependants.map(d => (typeof d.premium === 'number' && Number.isFinite(d.premium) && d.premium > 0) ? d.premium : policy.premium),
  ]
  return Math.round(lines.reduce((s, n) => s + n, 0) * 100) / 100
}

/**
 * Applies a verified gateway verdict to a reference.
 *
 * The caller is responsible for having established that the verdict genuinely
 * came from Paynow — a verified webhook hash, or a poll of Paynow's own
 * pollUrl. This function assumes that and does not re-check it.
 */
export async function reconcilePaynow(
  admin: SupabaseClient, reference: string, verdict: GatewayVerdict,
): Promise<ReconcileResult> {
  const { status, amount: confirmedAmount } = verdict
  const paynowReference = verdict.paynowReference ?? null
  const now = new Date().toISOString()

  const { data: txn } = await admin
    .from('paynow_transactions')
    .select('reference, policy_id, expected_amount, status, currency')
    .eq('reference', reference)
    .maybeSingle()

  if (!txn) {
    // A reference never recorded at initiate time: predates this table, was
    // already cleaned up, or was never ours. Nothing safe to do with it.
    console.error('paynow reconcile: no paynow_transactions row for reference', reference)
    return { outcome: 'unknown-reference', reference }
  }

  const expectedAmount = Number(txn.expected_amount)
  const currency = String(txn.currency ?? 'USD')
  const base = { reference, expectedAmount, confirmedAmount, currency }

  // Terminal already. Re-running must be a no-op, not a second credit.
  if (txn.status === 'paid') return { ...base, outcome: 'already', alreadyHandled: true }
  if (txn.status === 'mismatch') {
    return { ...base, outcome: 'mismatch', note: 'Already parked for review.', alreadyHandled: true }
  }

  if (isFailed(status)) {
    await admin.from('paynow_transactions')
      .update({ status: 'failed', paynow_reference: paynowReference, updated_at: now })
      .eq('reference', reference)
    return { ...base, outcome: 'failed' }
  }

  if (!isPaid(status)) {
    // 'Created' / 'Sent' — not an answer yet. Record that we heard from
    // Paynow, for tracing, but decide nothing.
    await admin.from('paynow_transactions')
      .update({ paynow_reference: paynowReference, updated_at: now })
      .eq('reference', reference)
    return { ...base, outcome: 'pending' }
  }

  if (!Number.isFinite(confirmedAmount) || Math.abs(confirmedAmount - expectedAmount) > 0.01) {
    // The case this whole design exists to catch: Paynow says the reference
    // cleared, but not for what it was initiated for. Never credited
    // automatically — parked with both figures on the record so reconciling
    // it by hand does not start from scratch.
    await admin.from('paynow_transactions').update({
      status: 'mismatch', paynow_reference: paynowReference,
      confirmed_amount: Number.isFinite(confirmedAmount) ? confirmedAmount : null, updated_at: now,
    }).eq('reference', reference)
    console.error(`paynow reconcile: AMOUNT MISMATCH ref=${reference} expected=${expectedAmount} confirmed=${confirmedAmount} ${currency}`)
    return { ...base, outcome: 'mismatch' }
  }

  const { data: policy } = await admin
    .from('policies')
    .select('id, product_id, premium, dependants, status, next_payment_date')
    .eq('id', txn.policy_id)
    .maybeSingle()
  if (!policy) {
    console.error('paynow reconcile: policy not found', reference, txn.policy_id)
    return { ...base, outcome: 'policy-missing' }
  }

  // payments.reference is UNIQUE. If another route already recorded this,
  // the insert hits that constraint (23505) and is success, not an error.
  const { error: payError } = await admin.from('payments').insert({
    reference, policy_id: policy.id, amount: confirmedAmount, method: 'Paynow',
    status: 'completed', payment_date: now.split('T')[0],
  })
  if (payError && payError.code !== '23505') {
    console.error('paynow reconcile: payment insert failed', reference, payError.message)
    return { ...base, outcome: 'write-failed' }
  }

  await admin.from('paynow_transactions').update({
    status: 'paid', paynow_reference: paynowReference, confirmed_amount: confirmedAmount, updated_at: now,
  }).eq('reference', reference)

  if (payError) {
    // 23505 — another route inserted this payment and already advanced the
    // policy for it. Doing it again would move next_payment_date twice for
    // one premium.
    return { ...base, outcome: 'already', alreadyHandled: true }
  }

  const { data: product } = await admin.from('products').select('category').eq('id', policy.product_id).maybeSingle()
  const category = product?.category ?? ''
  const cycleMonths = category === 'agriculture' ? 12 : 1
  const perPeriod = billablePremium(policy)
  const periodsPaid = perPeriod > 0 ? Math.max(1, Math.round(confirmedAmount / perPeriod)) : 1

  const today = new Date()
  const from = policy.next_payment_date && new Date(policy.next_payment_date) > today
    ? new Date(policy.next_payment_date) : today
  const next = new Date(from)
  next.setMonth(next.getMonth() + cycleMonths * periodsPaid)

  let newStatus = policy.status
  if (policy.status === 'lapsed') newStatus = category === 'agriculture' ? 'active' : 'waiting_period'
  else if (category === 'agriculture' && policy.status === 'waiting_period') newStatus = 'active'

  await admin.from('policies').update({
    status: newStatus,
    last_payment_date: today.toISOString().split('T')[0],
    next_payment_date: next.toISOString().split('T')[0],
  }).eq('id', policy.id)

  return { ...base, outcome: 'paid' }
}
