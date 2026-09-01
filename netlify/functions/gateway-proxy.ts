import type { Handler } from '@netlify/functions'
import { sendViaAfrosoft, afrosoftDomain } from '../../api/_lib/afrosoft.js'

/**
 * Generic server-side relay for the EcoCash, Paynow and Afrosoft SMS APIs,
 * all of which reject direct browser calls via CORS. The client still holds
 * and sends merchant credentials (same trust model as today, just routed
 * through this same-origin function instead of a blocked cross-origin
 * request).
 *
 * SMS is the exception: the browser sends only recipients and text, and the
 * key, domain and sender ID come from the environment via
 * api/_lib/afrosoft.ts. This branch used to be missing here — the Vercel
 * copy grew it and this one did not — so on Netlify every send fell through
 * to the URL allowlist and came back "Invalid target url".
 *
 * Locked to an explicit host allowlist so this can't be abused as an open
 * proxy to arbitrary URLs (SSRF).
 */

const ALLOWED_HOSTS = new Set(['api.ecocash.co.zw', 'www.paynow.co.zw', afrosoftDomain()])

interface ProxyRequestBody {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** Set to 'sms' to have the server build the Afrosoft request itself. */
  action?: 'sms'
  mobiles?: string
  message?: string
}

const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  let req: ProxyRequestBody
  try {
    req = JSON.parse(event.body ?? '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (req.action === 'sms') {
    if (!req.mobiles || !req.message) {
      return json(400, { error: 'mobiles and message are required.' })
    }
    try {
      const result = await sendViaAfrosoft(req.mobiles, req.message)
      return json(200, { status: result.status, ok: result.ok, body: result.body })
    } catch (e) {
      return json(502, { error: `SMS gateway unreachable: ${e}` })
    }
  }

  let target: URL
  try {
    target = new URL(req.url)
  } catch {
    return json(400, { error: 'Invalid target url' })
  }

  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return json(403, { error: `Target host not allowed: ${target.hostname}` })
  }

  try {
    const res = await fetch(target.toString(), {
      method: req.method ?? 'POST',
      headers: req.headers,
      body: req.method === 'GET' ? undefined : req.body,
    })
    const text = await res.text()
    return json(200, { status: res.status, ok: res.ok, body: text })
  } catch (e) {
    return json(502, { error: `Upstream request failed: ${e}` })
  }
}
