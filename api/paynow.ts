/// <reference path="./paynow.d.ts" />
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Paynow } from 'paynow'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  paynowCredentials, paynowVerifier, paynowIsLive, configuredCurrencies, isCurrency,
  rateFor, currencyIsActive,
  type Currency,
} from './_lib/paynow.js'
import { reconcilePaynow } from './_lib/paynowReconcile.js'
import { notifyPaymentOutcome } from './_lib/paymentNotifications.js'

/**
 * Paynow, through Paynow's own SDK.
 *
 * No card or wallet detail ever touches this application. The payer is sent
 * to Paynow's own hosted page, enters everything there, and comes back;
 * all this endpoint ever handles is a reference, an amount and a currency.
 *
 * Nothing here reimplements Paynow's protocol. The SDK owns field order,
 * SHA512 signing, response parsing and hash verification. (The browser once
 * built and signed the request itself, with MD5, so Paynow answered
 * "Invalid Hash" and no transaction was ever created.) It lives on the
 * server because the SDK is a Node library, Paynow rejects browser calls
 * via CORS, and the integration key must never reach a client.
 *
 * Three actions:
 *   initiate — create the transaction, return the redirect URL
 *   verify   — re-poll one reference server-side and reconcile it
 *   poll     — raw status, kept for the EcoCash-style live poll
 */

interface RequestBody {
  action?: string
  reference?: string
  /** Always the USD price -- the billed amount. Converted server-side when
   *  charging in another currency; never the charged figure itself. */
  amount?: number
  currency?: string
  description?: string
  /** Only sent when it is genuinely the payer's address; see paynowIsLive. */
  email?: string
  returnUrl?: string
  resultUrl?: string
  pollUrl?: string
  policyId?: string
}

function admin(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})) as RequestBody
  const origin = `https://${req.headers.host}`

  // Defaults to USD so an existing caller that never sent a currency keeps
  // the behaviour it had before the ZiG integration was added.
  const currency: Currency = isCurrency(body.currency) ? body.currency : 'USD'

  try {
    // ── VERIFY ────────────────────────────────────────────────────────
    // What /payment/return calls when the payer lands back. The browser is
    // never believed about whether it paid: this re-polls Paynow with the
    // pollUrl stored at initiate time and runs the same reconciliation the
    // webhook does.
    if (body.action === 'verify') {
      const reference = String(body.reference ?? '')
      if (!reference) return res.status(400).json({ error: 'reference is required.' })

      const db = admin()
      if (!db) return res.status(500).json({ error: 'Server is not configured.' })

      const { data: txn } = await db
        .from('paynow_transactions')
        .select('reference, poll_url, currency, status, expected_amount')
        .eq('reference', reference)
        .maybeSingle()
      if (!txn) return res.status(404).json({ error: 'Unknown reference.' })

      // Already settled by the webhook or an earlier verify — no need to
      // trouble Paynow again.
      if (txn.status === 'paid' || txn.status === 'mismatch' || txn.status === 'failed') {
        return res.status(200).json({
          outcome: txn.status === 'paid' ? 'already' : txn.status,
          reference, currency: txn.currency, expectedAmount: Number(txn.expected_amount),
        })
      }

      if (!txn.poll_url) {
        return res.status(200).json({ outcome: 'pending', reference, note: 'No poll URL recorded for this reference.' })
      }

      const txnCurrency: Currency = isCurrency(txn.currency) ? txn.currency : 'USD'
      const creds = paynowCredentials(txnCurrency)
      if (!creds) return res.status(503).json({ error: `Paynow is not configured for ${txnCurrency}.` })

      const status = await paynowVerifier(creds.integrationKey).pollTransaction(txn.poll_url)
      const rawAmount = (status as { amount?: unknown } | null)?.amount
      const result = await reconcilePaynow(db, reference, {
        status: String(status?.status ?? '').toLowerCase(),
        amount: Number(rawAmount),
        paynowReference: (status as { paynowReference?: string } | null)?.paynowReference ?? null,
      })
      // Awaited: this function is frozen once it responds, so a floating
      // promise would be killed mid-send. Only the route that actually made
      // the transition sends anything, so this cannot duplicate the
      // webhook's receipt.
      await notifyPaymentOutcome(db, result, origin)
      return res.status(200).json(result)
    }

    // ── POLL ──────────────────────────────────────────────────────────
    // Raw status, no reconciliation. Kept for the modal's live poll.
    if (body.action === 'poll') {
      if (!body.pollUrl) return res.status(400).json({ error: 'pollUrl is required.' })
      const creds = paynowCredentials(currency)
      if (!creds) return res.status(503).json({ error: `Paynow is not configured for ${currency}.` })

      const response = await paynowVerifier(creds.integrationKey).pollTransaction(body.pollUrl)
      const status = String(response?.status ?? '').toLowerCase()
      // Coerced to a real number (the SDK returns a string) so the caller can
      // compare it against what it asked for — "paid" tells you the reference
      // cleared, not that it cleared for the right amount.
      const rawAmount = (response as { amount?: unknown } | null)?.amount
      const amount = rawAmount !== undefined && rawAmount !== null && Number.isFinite(Number(rawAmount))
        ? Number(rawAmount) : null
      return res.status(200).json({
        status,
        paid: status === 'paid' || status === 'awaiting delivery',
        amount,
      })
    }

    // ── INITIATE ──────────────────────────────────────────────────────
    if (body.action === 'initiate') {
      const creds = paynowCredentials(currency)
      if (!creds) {
        return res.status(503).json({
          error: `Paynow is not configured for ${currency}. Set PAYNOW_${currency === 'ZWG' ? 'ZIG' : 'USD'}_INTEGRATION_ID and _INTEGRATION_KEY on the server.`,
          configuredCurrencies: configuredCurrencies(),
        })
      }

      const reference = String(body.reference ?? '')
      // Always the USD price. The browser never states what to charge in
      // another currency -- it sends what is owed in the base currency and
      // the conversion happens below, from the rate on record. A client that
      // could name its own ZiG figure could pay off a policy for pennies.
      const usdAmount = Number(body.amount)
      const policyId = String(body.policyId ?? '')
      if (!reference || !Number.isFinite(usdAmount) || usdAmount <= 0) {
        return res.status(400).json({ error: 'reference and a positive amount are required.' })
      }
      // Required, not optional: without it the webhook has no record of what
      // this reference was FOR, and could only trust Paynow's own "paid" flag
      // blindly — exactly the gap that lets an amount mismatch through.
      if (!policyId) return res.status(400).json({ error: 'policyId is required.' })

      const db = admin()
      if (!db) return res.status(500).json({ error: 'Server is not configured (missing Supabase service credentials).' })

      // Enforced here as well as in the UI, for the same reason the amount is.
      if (!(await currencyIsActive(currency, db))) {
        return res.status(503).json({ error: `${currency === 'ZWG' ? 'ZiG' : currency} payments are temporarily unavailable due to maintenance.` })
      }

      // Prices are held in USD; this works out what to charge in the
      // currency selected. Refused outright when there is no rate -- see
      // rateFor().
      const rate = await rateFor(currency, db)
      if (rate === null) {
        return res.status(503).json({ error: 'ZiG payments are unavailable until an exchange rate is set. Set it in Settings, or take this payment in USD.' })
      }
      const amount = Math.round(usdAmount * rate * 100) / 100
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Could not determine the amount to charge.' })
      }

      // Built as Paynow's Node quickstart documents it: construct with the
      // integration pair, assign the URLs, createPayment, add, send.
      const paynow = new Paynow(creds.integrationId, creds.integrationKey)
      // The currency rides on both URLs so the return page knows which
      // reference it is confirming and the webhook knows which integration
      // key signed the update it is about to verify.
      paynow.resultUrl = body.resultUrl || `${origin}/api/paynow-webhook?currency=${currency}`
      paynow.returnUrl = body.returnUrl
        || `${origin}/payment/return?ref=${encodeURIComponent(reference)}&currency=${currency}`

      // The email is a convenience: Paynow uses it to auto-login a
      // registered customer.
      //
      // It used to be withheld unless PAYNOW_LIVE was set, because an
      // integration in TEST MODE rejects the ENTIRE transaction when
      // authemail is anything but the merchant's own address ("the
      // integration ID is in test mode, so if authemail is specified then it
      // must match the merchants registered email address"). That was
      // observed on integration 26481, which is not one of the two in use
      // now. Both 16866 (USD) and 16867 (ZiG) were checked live on
      // 2026-09-03 with a payer address that is not the merchant's, and both
      // accepted it.
      //
      // The flag is kept as a safety valve for a future integration that IS
      // in test mode; with it unset the only cost is a missing auto-login,
      // never a refused payment.
      const payment = (paynowIsLive() && body.email)
        ? paynow.createPayment(reference, body.email)
        : paynow.createPayment(reference)
      payment.add(body.description || 'Insurance Premium', amount)

      const response = await paynow.send(payment)
      if (!response || !response.success) {
        // Paynow's own words name the fix — "in test mode, authemail must
        // match the merchant's address", "not a site integration",
        // "currently inactive". Our paraphrase would not.
        return res.status(200).json({ ok: false, error: String(response?.error ?? 'Paynow declined the request.') })
      }

      const pollUrl = String(response.pollUrl ?? '')

      // The transaction now genuinely exists on Paynow's side and can receive
      // a webhook at any moment, so it is recorded BEFORE responding. The
      // poll URL is stored because it is the only way to ask Paynow about
      // this reference later — without it, a lost webhook leaves a payment
      // that cleared with nothing able to find out.
      // expected_amount is what Paynow was actually asked for, in `currency`
      // -- so the webhook's amount check compares ZiG against ZiG. usd_amount
      // and rate are kept alongside it so the USD price this came from, and
      // what it was converted at, stay reconstructable after the rate moves.
      const { error: trackError } = await db.from('paynow_transactions').insert({
        reference, policy_id: policyId, expected_amount: amount,
        status: 'pending', currency, poll_url: pollUrl,
        usd_amount: usdAmount, rate,
      })
      if (trackError) {
        // Does not undo the Paynow transaction, so it is logged rather than
        // failing the response — but reconciliation for this reference is
        // degraded until it is fixed.
        console.error('paynow_transactions insert failed', reference, trackError.message)
      }

      return res.status(200).json({
        ok: true,
        redirectUrl: String(response.redirectUrl ?? ''),
        pollUrl,
        currency,
        // What Paynow will actually charge, and what it was converted at, so
        // the caller records and shows the figure the payer is about to be
        // asked for rather than the USD it came from.
        amount,
        usdAmount,
        rate,
      })
    }

    return res.status(400).json({ error: 'action must be "initiate", "verify" or "poll".' })
  } catch (e) {
    return res.status(502).json({ error: `Could not reach Paynow: ${e}` })
  }
}
