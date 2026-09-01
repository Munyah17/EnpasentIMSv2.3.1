import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Paynow } from 'paynow'
import { createClient } from '@supabase/supabase-js'

/**
 * Paynow's resultUrl callback -- a real webhook, not client-side polling.
 *
 * api/paynow.ts's 'initiate' action sets resultUrl to this endpoint. Paynow
 * POSTs a status update here the moment a transaction settles, whether or
 * not anyone is still watching the browser tab that started it -- which is
 * exactly the gap OnlinePaymentModal.tsx's 4-second poll cannot close: a
 * payer who completes payment on Paynow's page and then closes the tab
 * before returning leaves that poll never running again, so without this,
 * the money clears on Paynow's side and this system never finds out.
 *
 * Two things must both be true before this ever credits a policy:
 *
 *  1. The hash must verify. Paynow's own SDK (Paynow.parseStatusUpdate) does
 *     this, the same way its own quickstart documents it -- nothing here
 *     reimplements SHA512/field-order signing by hand.
 *  2. The confirmed amount must equal what THIS reference was actually
 *     initiated for (paynow_transactions, written by api/paynow.ts at
 *     initiate time). "Paid" only means the reference cleared; it says
 *     nothing about whether it cleared for the right amount. A mismatch is
 *     never silently accepted as a partial win -- it is parked for a human
 *     to look at (status 'mismatch'), and nothing is credited from it.
 *
 * Idempotent by construction: payments.reference is UNIQUE, and this uses
 * the same reference OnlinePaymentModal's own client-side poll would use.
 * Whichever path gets there first wins; the other's insert hits the unique
 * constraint and is treated as "already recorded", not an error. This is
 * also why the response is always 200 once the message itself has been
 * understood -- Paynow retries a non-2xx up to ten times, and there is
 * nothing a retry would fix once the update itself has been read and acted
 * on (or correctly found to not apply).
 */

function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export const config = {
  api: {
    // Paynow POSTs application/x-www-form-urlencoded. The SDK's own
    // parseStatusUpdate wants that raw string (it does its own decode and
    // hash verification field-by-field) -- Vercel's default JSON body
    // parser would consume the stream and hand back an object instead,
    // which is not what that method takes.
    bodyParser: false,
  },
}

/** Mirrors src/lib/premium.ts's policyBillablePremium (per-head: the
 *  policyholder's premium plus one per dependant, each falling back to the
 *  policyholder's own premium if it has none of its own). Duplicated rather
 *  than imported because src/lib/db.ts -- and everything it composes with --
 *  pulls in src/lib/supabase.ts, which reads import.meta.env; that is a Vite
 *  build-time construct with no equivalent in a Vercel Node function, so
 *  importing it here would fail at module load. Keep this in sync with
 *  premium.ts if that math ever changes. */
function billablePremium(policy: { premium: number; dependants: unknown }): number {
  const dependants = Array.isArray(policy.dependants) ? policy.dependants as { premium?: number }[] : []
  const lines = [
    policy.premium,
    ...dependants.map(d => (typeof d.premium === 'number' && Number.isFinite(d.premium) && d.premium > 0) ? d.premium : policy.premium),
  ]
  return Math.round(lines.reduce((s, n) => s + n, 0) * 100) / 100
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const integrationKey = process.env.PAYNOW_INTEGRATION_KEY
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  // Answering 200 here (not 503) is deliberate: Paynow retries a non-2xx up
  // to ten times, and a missing env var will not fix itself between
  // retries, so there is nothing to gain from making it try again.
  if (!integrationKey || !supabaseUrl || !serviceKey) {
    console.error('paynow-webhook: server not configured (PAYNOW_INTEGRATION_KEY / Supabase service credentials missing)')
    return res.status(200).json({ ok: false, error: 'Server not configured.' })
  }

  const rawBody = await readRawBody(req)
  const paynow = new Paynow('', integrationKey, '', '')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let update: any
  try {
    update = paynow.parseStatusUpdate(rawBody)
  } catch (e) {
    // Genuinely not from Paynow (or the body was mangled in transit) --
    // this is a rejection, not a "try later", so it does not get a 200.
    console.error('paynow-webhook: hash verification failed', e)
    return res.status(400).json({ ok: false, error: 'Hash verification failed.' })
  }

  if (update.error) {
    // Paynow reporting its own error state for the reference -- nothing to
    // reconcile against a payment for.
    console.error('paynow-webhook: Paynow reported an error', update.error)
    return res.status(200).json({ ok: true, note: 'Paynow error status acknowledged.' })
  }

  const reference = String(update.reference ?? '')
  const confirmedAmount = Number(update.amount)
  const status = String(update.status ?? '').toLowerCase()
  const paynowReference = update.paynowReference ? String(update.paynowReference) : null

  if (!reference || !Number.isFinite(confirmedAmount)) {
    return res.status(200).json({ ok: false, error: 'Status update missing reference or amount.' })
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: txn } = await admin
    .from('paynow_transactions')
    .select('reference, policy_id, expected_amount, status')
    .eq('reference', reference)
    .maybeSingle()

  if (!txn) {
    // A reference we never recorded at initiate time -- an old transaction
    // predating this table, a retry of something already cleaned up, or one
    // that was never ours. Nothing safe to do with it.
    console.error('paynow-webhook: no matching paynow_transactions row for reference', reference)
    return res.status(200).json({ ok: false, error: 'Unknown reference; nothing to reconcile.' })
  }

  if (txn.status === 'paid') {
    // Already handled -- most likely the client-side poll got there first.
    return res.status(200).json({ ok: true, note: 'Already recorded.' })
  }

  const amountMatches = Math.abs(confirmedAmount - Number(txn.expected_amount)) <= 0.01
  const paidLike = status === 'paid' || status === 'awaiting delivery'
  const failedLike = status === 'cancelled' || status === 'disputed'

  if (paidLike && !amountMatches) {
    // The one case this whole design exists to catch: Paynow says the
    // reference cleared, but not for what it was actually initiated for.
    // Never credited automatically -- parked for a human, with both figures
    // on the record so reconciling it does not start from scratch.
    await admin.from('paynow_transactions').update({
      status: 'mismatch', paynow_reference: paynowReference, confirmed_amount: confirmedAmount, updated_at: new Date().toISOString(),
    }).eq('reference', reference)
    console.error(`paynow-webhook: AMOUNT MISMATCH ref=${reference} expected=${txn.expected_amount} confirmed=${confirmedAmount}`)
    return res.status(200).json({ ok: false, error: 'Amount mismatch; not credited.' })
  }

  if (failedLike) {
    await admin.from('paynow_transactions').update({
      status: 'failed', paynow_reference: paynowReference, updated_at: new Date().toISOString(),
    }).eq('reference', reference)
    return res.status(200).json({ ok: true, note: 'Marked failed.' })
  }

  if (!paidLike) {
    // 'Created' / 'Sent' -- not an answer yet, so nothing is recorded as
    // paid or failed. Just note we heard from Paynow, for tracing.
    await admin.from('paynow_transactions').update({
      paynow_reference: paynowReference, updated_at: new Date().toISOString(),
    }).eq('reference', reference)
    return res.status(200).json({ ok: true, note: 'Still pending.' })
  }

  // Paid, and the amount matches what this reference was for.
  const { data: policy } = await admin
    .from('policies')
    .select('id, product_id, premium, dependants, status, next_payment_date')
    .eq('id', txn.policy_id)
    .maybeSingle()
  if (!policy) {
    console.error('paynow-webhook: policy not found for paynow_transactions row', reference, txn.policy_id)
    return res.status(200).json({ ok: false, error: 'Policy not found.' })
  }

  // payments.reference is UNIQUE -- if OnlinePaymentModal's own poll already
  // recorded this (it was still open when the payer returned), this insert
  // hits that constraint and is treated as success, not an error. Whichever
  // path gets there first wins; nothing is credited twice.
  const { error: payError } = await admin.from('payments').insert({
    reference, policy_id: policy.id, amount: confirmedAmount, method: 'Paynow',
    status: 'completed', payment_date: new Date().toISOString().split('T')[0],
  })
  if (payError && payError.code !== '23505') {
    console.error('paynow-webhook: payment insert failed', reference, payError.message)
    // A real failure, not a duplicate -- worth a retry, so this is the one
    // case that does NOT return 200.
    return res.status(500).json({ ok: false, error: 'Could not record payment.' })
  }

  await admin.from('paynow_transactions').update({
    status: 'paid', paynow_reference: paynowReference, confirmed_amount: confirmedAmount, updated_at: new Date().toISOString(),
  }).eq('reference', reference)

  // Only advance the policy on OUR insert -- if payError.code === '23505'
  // (the poll path beat us to it), db.payments.create() already ran this
  // exact step for the same reference; doing it again here would advance
  // nextPaymentDate a second time for one payment.
  if (!payError) {
    const { data: product } = await admin.from('products').select('category').eq('id', policy.product_id).maybeSingle()
    const category = product?.category ?? ''
    const cycleMonths = category === 'agriculture' ? 12 : 1
    const perPeriod = billablePremium(policy)
    const periodsPaid = perPeriod > 0 ? Math.max(1, Math.round(confirmedAmount / perPeriod)) : 1
    const monthsToAdvance = cycleMonths * periodsPaid

    const today = new Date()
    const base = policy.next_payment_date && new Date(policy.next_payment_date) > today ? new Date(policy.next_payment_date) : today
    const next = new Date(base)
    next.setMonth(next.getMonth() + monthsToAdvance)

    let newStatus = policy.status
    if (policy.status === 'lapsed') newStatus = category === 'agriculture' ? 'active' : 'waiting_period'
    else if (category === 'agriculture' && policy.status === 'waiting_period') newStatus = 'active'

    await admin.from('policies').update({
      status: newStatus,
      last_payment_date: today.toISOString().split('T')[0],
      next_payment_date: next.toISOString().split('T')[0],
    }).eq('id', policy.id)
  }

  return res.status(200).json({ ok: true })
}
