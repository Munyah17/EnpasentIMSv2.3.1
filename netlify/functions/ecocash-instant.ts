import type { Handler } from '@netlify/functions'
import { chargeEip, lookupEip, eipConfigured, eipIsSandbox } from '../../api/_lib/ecocashInstant.js'

/**
 * Netlify mirror of api/ecocash-instant.ts — same contract, same env vars.
 * See that file and api/_lib/ecocashInstant.ts for what this rail is (and
 * for why it is not Paynow).
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const json = (statusCode: number, payload: unknown) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!eipConfigured()) {
    return json(503, { error: 'EcoCash Instant is not configured on the server (EIP_USERNAME / EIP_PASSWORD).' })
  }

  const action = String(body.action ?? '')

  try {
    if (action === 'lookup') {
      const lookupUrl = String(body.lookupUrl ?? '')
      if (!lookupUrl) return json(400, { error: 'lookupUrl is required.' })
      if (!lookupUrl.startsWith(process.env.EIP_BASE_URL || 'https://developers.ecocash.co.zw/')) {
        return json(403, { error: 'lookupUrl is not an EcoCash endpoint.' })
      }
      return json(200, await lookupEip(lookupUrl))
    }

    if (action === 'charge') {
      const phone = String(body.phone ?? '')
      const amount = Number(body.amount)
      const reference = String(body.reference ?? '')
      if (!phone || !reference || !Number.isFinite(amount) || amount <= 0) {
        return json(400, { error: 'phone, amount and reference are required.' })
      }

      const { httpStatus, result, lookupUrl } = await chargeEip({
        phone, amount, reference,
        description: String(body.description ?? 'Insurance Premium'),
      })

      const definitelyRejected = result.outcome === 'failed' || (httpStatus >= 400 && httpStatus < 500)
      if (definitelyRejected) {
        return json(200, {
          outcome: 'failed',
          message: result.message
            ?? (eipIsSandbox()
              ? 'EcoCash rejected this number in test mode; only whitelisted numbers can pay on sandbox credentials.'
              : `EcoCash rejected the request (HTTP ${httpStatus}).`),
          sandbox: eipIsSandbox(),
        })
      }

      return json(200, {
        outcome: 'pending',
        lookupUrl,
        transactionId: result.transactionId,
        message: result.message,
        sandbox: eipIsSandbox(),
      })
    }

    return json(400, { error: 'action must be "charge" or "lookup".' })
  } catch (e) {
    return json(200, { outcome: 'pending', message: `Could not reach EcoCash: ${e}` })
  }
}
