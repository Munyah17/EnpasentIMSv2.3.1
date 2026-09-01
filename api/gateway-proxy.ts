import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Generic server-side relay for the EcoCash, Paynow, and Afrosoft SMS APIs,
 * all of which reject direct browser calls via CORS. The client still holds
 * and sends merchant/API credentials (same trust model as today, just
 * routed through this same-origin function instead of a blocked
 * cross-origin request).
 *
 * Locked to an explicit host allowlist so this can't be abused as an open
 * proxy to arbitrary URLs (SSRF). AFROSOFT_SMS_DOMAIN stays overridable by
 * env var in case Afrosoft moves us to a different host, but defaults to
 * the one they assigned us so live SMS works without extra config.
 */

const ALLOWED_HOSTS = new Set(
  ['api.ecocash.co.zw', 'www.paynow.co.zw', process.env.AFROSOFT_SMS_DOMAIN || 'sms.vas.co.zw']
    .filter((h): h is string => !!h),
)

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

/**
 * Sends through Afrosoft using credentials held on the server.
 *
 * SMS used to be assembled in the browser from settings in localStorage,
 * which meant every device needed configuring and one blank save silently
 * dropped the whole system into simulation mode -- messages "sent" that
 * never existed. The key belongs on the server, where it is set once and
 * cannot be cleared by a stray click in a settings form.
 */
async function sendViaAfrosoft(mobiles: string, message: string) {
  const apiKey = process.env.AFROSOFT_SMS_API_KEY
  const domain = process.env.AFROSOFT_SMS_DOMAIN || 'sms.vas.co.zw'
  if (!apiKey) {
    return { ok: false as const, status: 503, body: JSON.stringify({ error: 'AFROSOFT_SMS_API_KEY is not configured on the server.' }) }
  }

  const params = new URLSearchParams({ apikey: apiKey, mobiles, sms: message })
  const senderId = process.env.AFROSOFT_SMS_SENDER_ID
  if (senderId) params.set('senderid', senderId)
  // Non-ASCII has to be declared or Afrosoft mangles it.
  if (/[^\x00-\x7F]/.test(message)) params.set('unicode', 'yes')

  const upstream = await fetch(`https://${domain}/client/api/sendmessage?${params.toString()}`)
  return { ok: upstream.ok, status: upstream.status, body: await upstream.text() }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const proxyReq: ProxyRequestBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})

  if (proxyReq.action === 'sms') {
    if (!proxyReq.mobiles || !proxyReq.message) {
      return res.status(400).json({ error: 'mobiles and message are required.' })
    }
    try {
      const result = await sendViaAfrosoft(proxyReq.mobiles, proxyReq.message)
      return res.status(200).json({ status: result.status, ok: result.ok, body: result.body })
    } catch (e) {
      return res.status(502).json({ error: `SMS gateway unreachable: ${e}` })
    }
  }

  let target: URL
  try {
    target = new URL(proxyReq.url)
  } catch {
    return res.status(400).json({ error: 'Invalid target url' })
  }

  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return res.status(403).json({ error: `Target host not allowed: ${target.hostname}` })
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: proxyReq.method ?? 'POST',
      headers: proxyReq.headers,
      body: proxyReq.method === 'GET' ? undefined : proxyReq.body,
    })
    const text = await upstream.text()
    return res.status(200).json({ status: upstream.status, ok: upstream.ok, body: text })
  } catch (e) {
    return res.status(502).json({ error: `Upstream request failed: ${e}` })
  }
}
