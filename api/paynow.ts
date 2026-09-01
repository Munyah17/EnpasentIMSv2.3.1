import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Paynow } from 'paynow'
import { createClient } from '@supabase/supabase-js'

/**
 * Paynow, through Paynow's own SDK.
 *
 * The browser used to build the request by hand -- concatenating fields and
 * signing them itself -- and it signed with MD5. Paynow signs with SHA512,
 * so it answered "Invalid Hash. Hash should start with: ..." and no
 * transaction was ever created, whatever integration key was configured.
 *
 * Nothing here reimplements Paynow's protocol. The SDK owns the field
 * order, the signature, the response parsing and the hash verification,
 * exactly as motions-website/api/create-checkout.ts does -- which is the
 * copy that has always worked. It lives on the server because the SDK is a
 * Node library and Paynow rejects direct browser calls via CORS.
 *
 * Credentials come from the server environment. Set PAYNOW_INTEGRATION_ID
 * and PAYNOW_INTEGRATION_KEY; the browser never sees them.
 */

interface InitiateBody {
  action?: string
  reference?: string
  amount?: number
  description?: string
  /** Only sent when it is genuinely the payer's address. An integration
   *  still in test mode rejects any authemail that is not the merchant's
   *  own registered address, so a blank one is simply omitted. */
  email?: string
  returnUrl?: string
  resultUrl?: string
  /** Poll url handed back by initiate, for action 'poll'. */
  pollUrl?: string
  /** Required for 'initiate' -- see paynow_transactions below. */
  policyId?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const integrationId = process.env.PAYNOW_INTEGRATION_ID
  const integrationKey = process.env.PAYNOW_INTEGRATION_KEY
  if (!integrationId || !integrationKey) {
    return res.status(503).json({ error: 'Paynow is not configured on the server (PAYNOW_INTEGRATION_ID / PAYNOW_INTEGRATION_KEY).' })
  }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})) as InitiateBody
  const origin = `https://${req.headers.host}`

  try {
    if (body.action === 'poll') {
      if (!body.pollUrl) return res.status(400).json({ error: 'pollUrl is required.' })
      // Same SDK call the public site uses: it POSTs (not GETs) as Paynow's
      // pollurl expects, and verifies the response hash before trusting it.
      const paynow = new Paynow('', integrationKey, '', '')
      const response = await paynow.pollTransaction(body.pollUrl)
      const status = String(response?.status ?? '').toLowerCase()
      // Coerced to a real number (Paynow's SDK returns it as a string), so
      // the caller can compare it against the amount it expected rather
      // than just trusting the paid/status flag on its own -- "paid" tells
      // you the reference cleared, not that it cleared for what you asked.
      const rawAmount = (response as { amount?: unknown } | null)?.amount
      const amount = rawAmount !== undefined && rawAmount !== null && Number.isFinite(Number(rawAmount))
        ? Number(rawAmount) : null
      return res.status(200).json({
        status,
        paid: status === 'paid' || status === 'awaiting delivery',
        amount,
      })
    }

    if (body.action === 'initiate') {
      const reference = String(body.reference ?? '')
      const amount = Number(body.amount)
      const policyId = String(body.policyId ?? '')
      if (!reference || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'reference and a positive amount are required.' })
      }
      // Required, not optional: without it, api/paynow-webhook.ts has no
      // record of what this reference was actually FOR, and can only ever
      // trust Paynow's own "paid" flag blindly -- exactly the gap that lets
      // an amount mismatch through unnoticed. See paynow_transactions.
      if (!policyId) {
        return res.status(400).json({ error: 'policyId is required.' })
      }
      const supabaseUrl = process.env.VITE_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!supabaseUrl || !serviceKey) {
        return res.status(500).json({ error: 'Server is not configured (missing Supabase service credentials).' })
      }
      const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

      // Built the way Paynow's Node quickstart documents it: construct with
      // the integration pair, assign the URLs as properties, createPayment,
      // add the item, send.
      const paynow = new Paynow(integrationId, integrationKey)
      paynow.resultUrl = body.resultUrl || `${origin}/api/paynow-webhook`
      paynow.returnUrl = body.returnUrl || `${origin}/payment/return`

      // Web based transaction: createPayment(reference). The email is only
      // ever a convenience -- Paynow uses it purely to auto-login a
      // registered customer -- but while this integration is in TEST MODE,
      // Paynow rejects the ENTIRE transaction outright if authemail is set
      // to anything but the merchant's own registered address:
      // "The integration ID is in test mode, so if authemail is specified
      // then it must match the merchants registered email address".
      // Confirmed live against 26481 on 2026-08-29 -- every real client
      // with an email on file was failing, silently, because this always
      // sent it. So it is withheld entirely until Paynow has approved this
      // integration for live/production use (set PAYNOW_LIVE=true once
      // that is confirmed in the Paynow merchant dashboard) -- a missing
      // auto-login is a minor inconvenience; a transaction Paynow refuses
      // outright is a client who cannot pay at all.
      const paynowIsLive = process.env.PAYNOW_LIVE === 'true'
      const payment = (paynowIsLive && body.email)
        ? paynow.createPayment(reference, body.email)
        : paynow.createPayment(reference)
      payment.add(body.description || 'Insurance Premium', amount)

      const response = await paynow.send(payment)
      if (!response || !response.success) {
        // Paynow's own words: "in test mode, authemail must match the
        // merchant's address", "not a site integration", "currently
        // inactive". Those name the fix; our paraphrase would not.
        return res.status(200).json({ ok: false, error: String(response?.error ?? 'Paynow declined the request.') })
      }

      // The transaction now genuinely exists on Paynow's side and can
      // receive a webhook at any point from here on, so this is recorded
      // before responding, not after -- a client-side poll succeeding is
      // no substitute for this, since the whole reason a webhook exists is
      // to cover a poll that never gets to run (tab closed after paying).
      // A failure here does not undo the Paynow transaction itself, so it
      // is logged rather than failing the response -- but reconciliation
      // for this one reference is degraded to poll-only until it is fixed.
      const { error: trackError } = await admin.from('paynow_transactions').insert({
        reference, policy_id: policyId, expected_amount: amount, status: 'pending',
      })
      if (trackError) {
        console.error('paynow_transactions insert failed', reference, trackError.message)
      }

      return res.status(200).json({
        ok: true,
        redirectUrl: String(response.redirectUrl ?? ''),
        pollUrl: String(response.pollUrl ?? ''),
      })
    }

    return res.status(400).json({ error: 'action must be "initiate" or "poll".' })
  } catch (e) {
    return res.status(502).json({ error: `Could not reach Paynow: ${e}` })
  }
}
