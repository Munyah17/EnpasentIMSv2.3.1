import type { ApiKey, ApiLog, ApiGatewayResponse } from '../../types/mno'
import { mnoStore } from './mnoStore'

// ── Request ID ────────────────────────────────────────────────────────
export function genRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// ── HMAC Signature ────────────────────────────────────────────────────
// Production: use crypto.subtle HMAC-SHA256. Here: deterministic simulation.
function simpleHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function signPayload(payload: string, secret: string, timestamp: number): string {
  return simpleHash(`${timestamp}:${payload}:${secret}`)
}

export function validateSignature(
  payload: string,
  signature: string,
  secret: string,
  timestamp: number,
): { valid: boolean; reason?: string } {
  const ageMs = Date.now() - timestamp
  if (ageMs > 5 * 60_000) return { valid: false, reason: 'Request expired (replay attack prevention)' }
  if (ageMs < -30_000)    return { valid: false, reason: 'Timestamp too far in the future' }
  const expected = signPayload(payload, secret, timestamp)
  if (signature !== expected) return { valid: false, reason: 'Invalid HMAC signature' }
  return { valid: true }
}

// ── Rate Limiting ─────────────────────────────────────────────────────
const RATE_WINDOWS = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(
  keyId: string,
  limit: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  let w = RATE_WINDOWS.get(keyId)
  if (!w || now > w.resetAt) {
    w = { count: 0, resetAt: now + 60_000 }
    RATE_WINDOWS.set(keyId, w)
  }
  if (w.count >= limit) return { allowed: false, remaining: 0, resetAt: w.resetAt }
  w.count++
  return { allowed: true, remaining: limit - w.count, resetAt: w.resetAt }
}

// ── Key Validation ────────────────────────────────────────────────────
export function resolveApiKey(prefix: string): ApiKey | null {
  return mnoStore.apiKeys.list().find(k => k.keyPrefix === prefix && k.status === 'active') ?? null
}

// ── IP Whitelist Check ────────────────────────────────────────────────
const KNOWN_IPS: Record<string, string[]> = {
  'mno-001': ['196.43.113.10', '196.43.113.11', '196.43.113.0/24'],
  'mno-002': ['196.43.112.44', '196.43.112.45'],
}

export function checkIpWhitelist(partnerId: string, ip: string): boolean {
  const allowed = KNOWN_IPS[partnerId]
  if (!allowed) return true  // no whitelist configured = allow
  return allowed.some(cidr => {
    if (cidr.includes('/')) return ip.startsWith(cidr.split('/')[0].split('.').slice(0, 3).join('.'))
    return cidr === ip
  })
}

// ── Audit Log ─────────────────────────────────────────────────────────
export function logApiRequest(entry: Omit<ApiLog, 'id'>): void {
  mnoStore.apiLogs.create({ ...entry, id: `log_${Math.random().toString(36).slice(2, 9)}` })
}

// ── Response Builders ─────────────────────────────────────────────────
export function okResponse<T>(data: T, requestId: string): ApiGatewayResponse<T> {
  return { status: 'success', data, requestId, timestamp: new Date().toISOString() }
}

export function errResponse(code: string, message: string, requestId: string): ApiGatewayResponse {
  return { status: 'error', code, message, requestId, timestamp: new Date().toISOString() }
}

// ── Full Gateway Auth Pipeline ────────────────────────────────────────
export interface GatewayContext {
  apiKey: ApiKey
  requestId: string
  partnerId: string
}

export function runGatewayAuth(
  keyPrefix: string,
  ip: string,
  requiredPermission: string,
): { ok: true; ctx: GatewayContext } | { ok: false; response: ApiGatewayResponse } {
  const requestId = genRequestId()

  const key = resolveApiKey(keyPrefix)
  if (!key) return { ok: false, response: errResponse('UNAUTHORIZED', 'Invalid or inactive API key', requestId) }

  if (!checkIpWhitelist(key.partnerId, ip))
    return { ok: false, response: errResponse('IP_BLOCKED', 'Request IP not in whitelist', requestId) }

  const rl = checkRateLimit(key.id, key.rateLimit)
  if (!rl.allowed)
    return { ok: false, response: errResponse('RATE_LIMITED', `Rate limit exceeded. Resets at ${new Date(rl.resetAt).toISOString()}`, requestId) }

  if (!key.permissions.includes(requiredPermission as never))
    return { ok: false, response: errResponse('FORBIDDEN', `API key lacks permission: ${requiredPermission}`, requestId) }

  // Update key usage stats
  mnoStore.apiKeys.update(key.id, {
    lastUsed: new Date().toISOString(),
    requestCount: key.requestCount + 1,
  })

  return { ok: true, ctx: { apiKey: key, requestId, partnerId: key.partnerId } }
}
