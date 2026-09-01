import type { Handler } from '@netlify/functions'

/**
 * Generic server-side relay for the EcoCash and Paynow payment APIs, both of
 * which reject direct browser calls via CORS. The client still holds and
 * sends merchant credentials (same trust model as today, just routed through
 * this same-origin function instead of a blocked cross-origin request).
 *
 * Locked to an explicit host allowlist so this can't be abused as an open
 * proxy to arbitrary URLs (SSRF).
 */

const ALLOWED_HOSTS = new Set(['api.ecocash.co.zw', 'www.paynow.co.zw'])

interface ProxyRequestBody {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let req: ProxyRequestBody
  try {
    req = JSON.parse(event.body ?? '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  let target: URL
  try {
    target = new URL(req.url)
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid target url' }) }
  }

  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return { statusCode: 403, body: JSON.stringify({ error: `Target host not allowed: ${target.hostname}` }) }
  }

  try {
    const res = await fetch(target.toString(), {
      method: req.method ?? 'POST',
      headers: req.headers,
      body: req.method === 'GET' ? undefined : req.body,
    })
    const text = await res.text()
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: res.status, ok: res.ok, body: text }),
    }
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: `Upstream request failed: ${e}` }) }
  }
}
