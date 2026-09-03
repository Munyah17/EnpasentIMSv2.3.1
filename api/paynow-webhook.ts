import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { CURRENCIES, paynowCredentials, paynowVerifier, isCurrency, type Currency } from './_lib/paynow.js'
import { reconcilePaynow } from './_lib/paynowReconcile.js'
import { notifyPaymentOutcome } from './_lib/paymentNotifications.js'

/**
 * Paynow's resultUrl callback — a real webhook, not client-side polling.
 *
 * Paynow POSTs here the moment a transaction settles, whether or not anyone
 * is still watching the tab that started it. That is the gap no browser-side
 * check can close: a payer who completes payment on Paynow's page and then
 * closes the tab leaves nothing running to ask. Without this, the money
 * clears on Paynow's side and this system never finds out.
 *
 * Two things must both hold before anything is credited, and neither is
 * decided here:
 *
 *  1. The hash must verify — Paynow's own SDK does it (parseStatusUpdate),
 *     so nothing reimplements SHA512 field-order signing by hand. An update
 *     that verifies under one of our integration keys provably came from
 *     Paynow for one of our integrations.
 *  2. The amount must match what the reference was initiated for. That, and
 *     the crediting itself, is api/_lib/paynowReconcile.ts — shared with the
 *     return page and the sweep so the three cannot reach different answers
 *     about the same payment.
 *
 * The response is 200 once the message has been understood, even when the
 * answer is "not credited": Paynow retries a non-2xx up to ten times, and a
 * retry fixes nothing once the update has been read and acted on. The
 * exceptions are a failed hash (400 — not from Paynow) and a failed write
 * (500 — a retry genuinely could succeed).
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
    // Paynow POSTs application/x-www-form-urlencoded, and the SDK's
    // parseStatusUpdate wants that raw string (it decodes and hash-verifies
    // field by field). Vercel's default JSON parser would consume the
    // stream and hand back an object, which is not what that method takes.
    bodyParser: false,
  },
}

interface VerifiedUpdate {
  currency: Currency
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update: any
}

/**
 * Verifies the update against our integration keys.
 *
 * There are two integrations (USD and ZiG) with different signing keys, and
 * a status update carries no currency of its own. The currency query
 * parameter on the resultUrl says which to expect, but it is a hint, not
 * proof — so it only decides the ORDER keys are tried, never whether the
 * signature is accepted. Whichever key actually verifies is the truth.
 */
function verifyUpdate(rawBody: string, hint: Currency | null): VerifiedUpdate | null {
  const order: Currency[] = hint ? [hint, ...CURRENCIES.filter(c => c !== hint)] : [...CURRENCIES]

  for (const currency of order) {
    const creds = paynowCredentials(currency)
    if (!creds) continue
    try {
      const update = paynowVerifier(creds.integrationKey).parseStatusUpdate(rawBody)
      if (update) return { currency, update }
    } catch {
      // Wrong key for this update, or not from Paynow at all. Try the next.
    }
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anyIntegration = CURRENCIES.some(c => paynowCredentials(c) !== null)
  // 200, not 503, on purpose: Paynow retries a non-2xx up to ten times and a
  // missing env var will not fix itself between retries.
  if (!anyIntegration || !supabaseUrl || !serviceKey) {
    console.error('paynow-webhook: server not configured (no Paynow integration, or Supabase service credentials missing)')
    return res.status(200).json({ ok: false, error: 'Server not configured.' })
  }

  const rawBody = await readRawBody(req)
  const hintRaw = typeof req.query?.currency === 'string' ? req.query.currency : null
  const hint = isCurrency(hintRaw) ? hintRaw : null

  const verified = verifyUpdate(rawBody, hint)
  if (!verified) {
    // Not signed by any integration we hold — a rejection, not a "try later".
    console.error('paynow-webhook: hash verification failed against every configured integration')
    return res.status(400).json({ ok: false, error: 'Hash verification failed.' })
  }

  const { update } = verified

  if (update.error) {
    console.error('paynow-webhook: Paynow reported an error', update.error)
    return res.status(200).json({ ok: true, note: 'Paynow error status acknowledged.' })
  }

  const reference = String(update.reference ?? '')
  const confirmedAmount = Number(update.amount)
  if (!reference || !Number.isFinite(confirmedAmount)) {
    return res.status(200).json({ ok: false, error: 'Status update missing reference or amount.' })
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const result = await reconcilePaynow(admin, reference, {
    status: String(update.status ?? '').toLowerCase(),
    amount: confirmedAmount,
    paynowReference: update.paynowReference ? String(update.paynowReference) : null,
  })

  // The signature proves which integration — and therefore which currency —
  // Paynow settled this under. If that disagrees with what we recorded at
  // initiate time, the money moved on a different ledger than the one this
  // reference was priced in, and the amount comparison was meaningless.
  if (result.currency && result.currency !== verified.currency) {
    console.error(`paynow-webhook: CURRENCY MISMATCH ref=${reference} recorded=${result.currency} signed=${verified.currency}`)
    await admin.from('paynow_transactions')
      .update({ status: 'mismatch', updated_at: new Date().toISOString() })
      .eq('reference', reference)
    return res.status(200).json({ ok: false, error: 'Currency mismatch; not credited.' })
  }

  // A write failure is the one case a retry could genuinely fix.
  if (result.outcome === 'write-failed') {
    return res.status(500).json({ ok: false, error: 'Could not record payment.' })
  }

  // Awaited, not fired and forgotten: a serverless function is frozen the
  // moment it responds, so a floating promise here would be killed mid-send
  // and the receipt would simply never arrive. Notification failures are
  // swallowed inside, so this cannot turn a settled payment into a 500.
  await notifyPaymentOutcome(admin, result, `https://${req.headers.host}`)

  const credited = result.outcome === 'paid' || result.outcome === 'already'
  return res.status(200).json({ ok: credited, outcome: result.outcome })
}
