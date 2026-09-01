import type { VercelRequest, VercelResponse } from '@vercel/node'
import { chargeEip, lookupEip, eipConfigured, eipIsSandbox } from './_lib/ecocashInstant.js'

/**
 * EcoCash Instant Payment for staff-initiated premium collection.
 *
 * Two actions:
 *   { action: 'charge', phone, amount, reference, description }
 *     -> pushes the prompt to the payer's phone, returns a lookup url.
 *   { action: 'lookup', lookupUrl }
 *     -> asks EcoCash what became of it.
 *
 * The merchant credentials stay here (EIP_USERNAME, EIP_PASSWORD,
 * EIP_MERCHANT_CODE, EIP_MERCHANT_PIN, EIP_MERCHANT_NUMBER, optionally
 * EIP_BASE_URL / EIP_TERMINAL_ID / EIP_MERCHANT_NAME). Set them and the
 * rail goes live; leave them unset and the client falls back to simulation,
 * which is clearly labelled as such and cannot be mistaken for a payment.
 *
 * This is EcoCash Instant, the direct rail -- not Paynow, and not Paynow's
 * EcoCash option. See api/_lib/ecocashInstant.ts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})) as Record<string, unknown>
  const action = String(body.action ?? '')

  if (!eipConfigured()) {
    return res.status(503).json({ error: 'EcoCash Instant is not configured on the server (EIP_USERNAME / EIP_PASSWORD).' })
  }

  try {
    if (action === 'lookup') {
      const lookupUrl = String(body.lookupUrl ?? '')
      if (!lookupUrl) return res.status(400).json({ error: 'lookupUrl is required.' })
      // Locked to our own EIP host so this can't be pointed anywhere else.
      if (!lookupUrl.startsWith(process.env.EIP_BASE_URL || 'https://developers.ecocash.co.zw/')) {
        return res.status(403).json({ error: 'lookupUrl is not an EcoCash endpoint.' })
      }
      const result = await lookupEip(lookupUrl)
      return res.status(200).json(result)
    }

    if (action === 'charge') {
      const phone = String(body.phone ?? '')
      const amount = Number(body.amount)
      const reference = String(body.reference ?? '')
      if (!phone || !reference || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'phone, amount and reference are required.' })
      }

      const { httpStatus, result, lookupUrl } = await chargeEip({
        phone, amount, reference,
        description: String(body.description ?? 'Insurance Premium'),
      })

      // Only a refusal EcoCash actually made is reported as failure. A 5xx
      // or an unreadable reply may still have left a live prompt on the
      // payer's handset, so it stays pending with a lookup url to settle it.
      const definitelyRejected = result.outcome === 'failed' || (httpStatus >= 400 && httpStatus < 500)
      if (definitelyRejected) {
        return res.status(200).json({
          outcome: 'failed',
          message: result.message
            ?? (eipIsSandbox()
              ? 'EcoCash rejected this number in test mode; only whitelisted numbers can pay on sandbox credentials.'
              : `EcoCash rejected the request (HTTP ${httpStatus}).`),
          sandbox: eipIsSandbox(),
        })
      }

      return res.status(200).json({
        outcome: 'pending',
        lookupUrl,
        transactionId: result.transactionId,
        message: result.message,
        sandbox: eipIsSandbox(),
      })
    }

    return res.status(400).json({ error: 'action must be "charge" or "lookup".' })
  } catch (e) {
    // Never a failure verdict: we could not ask, which is not an answer.
    return res.status(200).json({ outcome: 'pending', message: `Could not reach EcoCash: ${e}` })
  }
}
