import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { paynowCredentials, paynowVerifier, isCurrency, type Currency } from './paynow.js'
import { reconcilePaynow, type ReconcileOutcome } from './paynowReconcile.js'
import { notifyPaymentOutcome } from './paymentNotifications.js'

/**
 * The backstop for payments that cleared but were never confirmed here.
 *
 * The webhook and the return page each cover the common cases, and each can
 * miss. A webhook can be lost in transit, rejected by a deployment that was
 * mid-rollout, or fired at a moment the database was unreachable; a payer
 * can pay and then close the tab, kill the browser, or lose signal on the
 * way back. Every one of those ends the same way: money has moved at
 * Paynow, and this system still shows the premium unpaid.
 *
 * So nothing is ever left waiting on a message arriving. Every pending
 * transaction keeps the pollUrl Paynow issued at initiate time, and this
 * asks Paynow directly about each one. Paynow is the authority on whether a
 * payment happened; the webhook is only the fastest way to hear about it.
 *
 * Deliberately re-polls the SAME reconcile path the other two use, so a
 * payment found here is credited by identical rules — and cannot be
 * double-credited, because payments.reference is UNIQUE and the row is
 * already 'paid' by the time a second route looks at it.
 *
 * Safe to run as often as the hosting plan allows: it only touches rows
 * still pending, and stops looking at one after ABANDON_AFTER_HOURS, by
 * which point an unpaid checkout is abandoned rather than in flight.
 *
 * Run through api/cron.ts, not as its own top-level function — see that
 * file's comment for why this lives under _lib.
 */

/** Skip transactions younger than this — they are very likely still being
 *  paid, and the webhook will almost certainly beat us to them. */
const MIN_AGE_MINUTES = 5

/** After this, a still-pending transaction is treated as an abandoned
 *  checkout and stops being polled. Paynow expires them on its own side
 *  too, so polling forever only wastes calls. */
const ABANDON_AFTER_HOURS = 72

const MAX_PER_RUN = 200

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Same guard as api/_lib/cron-reminders.ts: Vercel Cron sends
  // `Authorization: Bearer $CRON_SECRET`. Fail closed — an unset secret must
  // refuse everyone rather than admit everyone, since this endpoint moves
  // money onto policies.
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

  const now = Date.now()
  const newestToConsider = new Date(now - MIN_AGE_MINUTES * 60_000).toISOString()
  const oldestToConsider = new Date(now - ABANDON_AFTER_HOURS * 3_600_000).toISOString()

  const { data, error } = await admin
    .from('paynow_transactions')
    .select('reference, poll_url, currency, created_at')
    .eq('status', 'pending')
    .lt('created_at', newestToConsider)
    .gt('created_at', oldestToConsider)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN)
  if (error) return res.status(500).json({ error: error.message })

  const pending = data ?? []
  const tally: Record<string, number> = {}
  const recovered: string[] = []

  for (const row of pending) {
    const reference = String(row.reference)
    try {
      if (!row.poll_url) { tally['no-poll-url'] = (tally['no-poll-url'] ?? 0) + 1; continue }

      const currency: Currency = isCurrency(row.currency) ? row.currency : 'USD'
      const creds = paynowCredentials(currency)
      if (!creds) { tally['not-configured'] = (tally['not-configured'] ?? 0) + 1; continue }

      const status = await paynowVerifier(creds.integrationKey).pollTransaction(row.poll_url)
      const result = await reconcilePaynow(admin, reference, {
        status: String(status?.status ?? '').toLowerCase(),
        amount: Number((status as { amount?: unknown } | null)?.amount),
        paynowReference: (status as { paynowReference?: string } | null)?.paynowReference ?? null,
      })

      tally[result.outcome] = (tally[result.outcome] ?? 0) + 1
      // Worth naming in the response: these are payments that had already
      // succeeded at Paynow and would otherwise have stayed invisible here.
      if (result.outcome === 'paid') recovered.push(reference)

      // The receipt for a recovered payment, and the office alert for a
      // mismatch nobody has seen yet. This sweep is the last route to run,
      // so for a payer who never came back it is the only thing that will
      // ever tell either of them. Awaited so the function is not frozen
      // mid-send.
      await notifyPaymentOutcome(admin, result, `https://${req.headers.host}`)
    } catch (e) {
      // One unreachable reference must not abandon the rest of the sweep.
      console.error('paynow-reconcile: failed for reference', reference, e)
      tally.error = (tally.error ?? 0) + 1
    }
  }

  return res.status(200).json({
    ran: new Date().toISOString(),
    considered: pending.length,
    recovered: recovered.length,
    recoveredReferences: recovered,
    outcomes: tally as Record<ReconcileOutcome | string, number>,
  })
}
