/**
 * SMS Service — Afrosoft Aggregator V4 HTTP API.
 *
 * The browser holds no gateway credentials at all: it asks
 * /api/gateway-proxy to send, and the server supplies the API key, account
 * domain and sender ID from the environment (see api/_lib/afrosoft.ts).
 *
 * There used to be an editable settings form backed by localStorage, with
 * the live API key as its default value — so the key shipped inside the
 * client bundle to every browser that loaded the app, every device needed
 * configuring separately, and one blank save stopped all SMS while still
 * reporting success. None of it is configurable from the browser now.
 */

/** Storage this module wrote in that earlier design. Cleared on load so a
 *  stale sender ID from it can never be resurrected — one saved under the
 *  unsuffixed key came from a previous gateway and failed every send with
 *  "sender-id is invalid". */
const RETIRED_SETTINGS_KEYS = ['tqfy_sms_settings', 'tqfy_sms_settings_afrosoft']

function clearRetiredSettings() {
  try {
    RETIRED_SETTINGS_KEYS.forEach(k => localStorage.removeItem(k))
  } catch { /**/ }
}
clearRetiredSettings()

export interface SmsResult {
  success: boolean
  messageId?: string
  error?: string
  simulated?: boolean
}

export interface BulkSmsResult {
  sent: number
  failed: number
  results: Array<{ phone: string; result: SmsResult }>
}

/** Zimbabwe MSISDN normalization: strips formatting, converts local 0-prefix to 263 country code. */
function normalizeMsisdn(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = '263' + digits.slice(1)
  else if (!digits.startsWith('263')) digits = '263' + digits
  return digits
}

/**
 * Afrosoft echoes numbers back in its own format -- it accepts
 * "263780086176" and reports it as "+263780086176". Comparing the sent and
 * returned strings directly marks genuinely delivered messages as failed,
 * so both sides are reduced to the last 9 digits (the subscriber number,
 * which is stable across +263 / 263 / 0 prefixes) before matching.
 */
function msisdnKey(raw: string): string {
  return raw.replace(/\D/g, '').slice(-9)
}

/**
 * A Zimbabwe mobile number normalises to 263 followed by 9 digits.
 *
 * Worth checking before sending because Afrosoft rejects the whole request
 * when any single recipient is malformed -- one bad number in a contact list
 * otherwise fails the entire campaign, which is precisely what "Sent: 0 |
 * Failed: 9" looks like from the outside.
 */
function isValidMsisdn(raw: string): boolean {
  const digits = normalizeMsisdn(raw)
  return /^263[17]\d{8}$/.test(digits)
}

interface AfrosoftResponse {
  status?: { 'error-code'?: string; 'error-status'?: string; 'error-description'?: string }
  'sms-response-details'?: Array<{
    'success-count'?: string
    'sent-sms-details'?: Array<{ 'sms-client-id'?: string; 'message-id'?: string; 'mobile-no'?: string }>
    'failed-sms-details'?: Array<{ count?: string; reasons?: Array<{ 'sms-client-id'?: string; 'mobile-no'?: string; 'failed-reason'?: string }> }>
  }>
}

/**
 * Hands the send to the server, which holds the Afrosoft key.
 *
 * Nothing about the gateway is configured in the browser any more: the
 * credentials used to live in localStorage, so every device needed setting
 * up and a single blank save dropped sending into simulation mode without
 * anyone noticing messages had stopped going out.
 */
async function callAfrosoft(
  numbers: string[], message: string,
): Promise<{ ok: true; data: AfrosoftResponse } | { ok: false; error: string }> {
  const mobiles = numbers.map(normalizeMsisdn).join(',')

  try {
    const res = await fetch('/api/gateway-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sms', mobiles, message }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { ok: false, error: (err as { error?: string })?.error ?? `Gateway proxy error (HTTP ${res.status})` }
    }

    // A plain `vite` dev server has no serverless functions, so it answers
    // /api/* with the app's own HTML shell — a 200 that is not JSON. Parsing
    // that throws "Unexpected token <", which tells nobody anything, so the
    // failure is named instead: sending needs the API running.
    let envelope: { status: number; ok: boolean; body: string }
    try {
      envelope = await res.json() as { status: number; ok: boolean; body: string }
    } catch {
      return {
        ok: false,
        error: 'The SMS service is not reachable at /api/gateway-proxy — it returned a page instead of a response. Use the deployed site, or run the dev server with API functions enabled.',
      }
    }
    const { status, ok, body } = envelope
    if (!ok) return { ok: false, error: `Afrosoft HTTP ${status}: ${body.slice(0, 200)}` }
    const data = JSON.parse(body) as AfrosoftResponse
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/**
 * Send a single SMS via Afrosoft.
 * Falls back to simulation (console log + local record) if not configured.
 */
export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const bulk = await sendBulkSms([to], message)
  return bulk.results[0]?.result ?? { success: false, error: 'Send failed' }
}

/**
 * Send the same message to multiple recipients. Afrosoft accepts
 * comma-separated numbers in a single call.
 */
export async function sendBulkSms(numbers: string[], message: string): Promise<BulkSmsResult> {
  // Bad numbers are separated out and reported individually, rather than
  // being sent and taking every other recipient down with them.
  const invalid = numbers.filter(n => !isValidMsisdn(n))
  const valid = numbers.filter(isValidMsisdn)
  const invalidResults = invalid.map(phone => {
    const error = `Not a valid Zimbabwe mobile number (${phone.trim() || 'blank'}); correct it on the client record.`
    logSmsLocally(phone, message, 'failed', error)
    return { phone, result: { success: false, error } }
  })

  if (valid.length === 0) {
    return { sent: 0, failed: invalidResults.length, results: invalidResults }
  }

  const result = await callAfrosoft(valid, message)

  if (!result.ok) {
    valid.forEach(n => logSmsLocally(n, message, 'failed', result.error))
    const failedResults = valid.map(phone => ({ phone, result: { success: false, error: result.error } }))
    return { sent: 0, failed: failedResults.length + invalidResults.length, results: [...failedResults, ...invalidResults] }
  }

  const errorCode = result.data.status?.['error-code']
  const detail = result.data['sms-response-details']?.[0]
  const sentIds = new Map((detail?.['sent-sms-details'] ?? []).map(s => [msisdnKey(s['mobile-no'] ?? ''), s['message-id']]))
  const failedReasons = new Map(
    (detail?.['failed-sms-details'] ?? []).flatMap(f => f.reasons ?? []).map(r => [msisdnKey(r['mobile-no'] ?? ''), r['failed-reason']]),
  )

  // A per-number reason ("Blacklisted", "Number is not reachable") is what
  // someone can actually act on, so it always wins over the request-level
  // description, which only stands in when the gateway rejected the batch
  // outright and named no individual number.
  const batchReason = result.data.status?.['error-description']
    || (errorCode && errorCode !== '000' ? `Afrosoft error ${errorCode}` : undefined)

  const results = valid.map(phone => {
    const key = msisdnKey(phone)
    const success = sentIds.has(key)
    const error = success
      ? undefined
      : failedReasons.get(key)
        ?? batchReason
        ?? 'Afrosoft accepted the request but did not confirm this number as sent.'
    logSmsLocally(phone, message, success ? 'sent' : 'failed', error)
    return {
      phone,
      result: success ? { success: true, messageId: sentIds.get(key) } : { success: false, error },
    }
  })

  const all = [...results, ...invalidResults]
  return {
    sent: all.filter(r => r.result.success).length,
    failed: all.filter(r => !r.result.success).length,
    results: all,
  }
}

// ── Local SMS log (for audit / history) ────────────────────────────

const LOG_KEY = 'tqfy_sms_log'

export interface SmsLogEntry {
  id: string
  to: string
  message: string
  status: 'sent' | 'failed' | 'simulated'
  /** Why it failed, straight from the gateway where it said so — a log
   *  that only says "failed" gives nobody anything to act on. */
  error?: string
  ts: string
}

function logSmsLocally(to: string, message: string, status: SmsLogEntry['status'], error?: string) {
  try {
    const log: SmsLogEntry[] = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]')
    log.unshift({ id: `sms_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, to, message, status, error, ts: new Date().toISOString() })
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 200)))
  } catch { /**/ }
}

export function getSmsLog(): SmsLogEntry[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') } catch { return [] }
}

export function clearSmsLog() {
  try { localStorage.removeItem(LOG_KEY) } catch { /**/ }
}
