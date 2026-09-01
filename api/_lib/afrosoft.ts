/**
 * Afrosoft Aggregator V4 HTTP API — the one place this system talks to the
 * SMS gateway.
 *
 * Three call sites send SMS: the browser relay (api/gateway-proxy.ts), the
 * nightly billing run (api/cron-reminders.ts), and the Netlify build of the
 * relay. Each used to assemble the request itself, so the sender ID had to
 * be got right in three places independently — which is exactly how
 * recipients end up seeing a different name depending on which code path
 * happened to text them.
 *
 * Credentials are read from the environment here and nowhere else. They must
 * never reach the browser bundle, so nothing in this file may be imported
 * from src/.
 */

/**
 * The name shown on the recipient's handset.
 *
 * Afrosoft only accepts sender IDs registered against the account and
 * rejects anything else outright with "sender-id is invalid" — which fails
 * the whole batch, not one message. So this stays overridable by
 * AFROSOFT_SMS_SENDER_ID: if Afrosoft registers a different spelling or
 * length, that is an env var change, not a redeploy.
 */
export const DEFAULT_SENDER_ID = 'Enpasent'

/** Assigned to this account by Afrosoft; not something in their generic docs. */
export const DEFAULT_DOMAIN = 'sms.vas.co.zw'

export function afrosoftDomain(): string {
  return process.env.AFROSOFT_SMS_DOMAIN || DEFAULT_DOMAIN
}

export function afrosoftSenderId(): string {
  return process.env.AFROSOFT_SMS_SENDER_ID || DEFAULT_SENDER_ID
}

export function afrosoftConfigured(): boolean {
  return !!process.env.AFROSOFT_SMS_API_KEY
}

/** Zimbabwe MSISDN: strips formatting, converts a local 0-prefix to 263. */
export function normalizeMsisdn(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `263${digits.slice(1)}`
  else if (!digits.startsWith('263')) digits = `263${digits}`
  return digits
}

/**
 * A Zimbabwe mobile number is 263 followed by 9 digits.
 *
 * Worth checking before sending: Afrosoft rejects the entire request when
 * any one recipient is malformed, so a single bad number in a contact list
 * takes down every other recipient with it.
 */
export function isValidMsisdn(raw: string): boolean {
  return /^263[17]\d{8}$/.test(normalizeMsisdn(raw))
}

export interface AfrosoftResult {
  ok: boolean
  status: number
  /** Afrosoft's raw response body, relayed verbatim so the caller can read
   *  the per-number detail out of it. */
  body: string
}

/**
 * Sends one message to one or more comma-separated recipients.
 *
 * `mobiles` is passed through as given — callers that accept user-entered
 * numbers should run them through normalizeMsisdn/isValidMsisdn first.
 */
export async function sendViaAfrosoft(mobiles: string, message: string): Promise<AfrosoftResult> {
  const apiKey = process.env.AFROSOFT_SMS_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      body: JSON.stringify({ error: 'AFROSOFT_SMS_API_KEY is not configured on the server.' }),
    }
  }

  const params = new URLSearchParams({
    apikey: apiKey,
    mobiles,
    sms: message,
    senderid: afrosoftSenderId(),
  })
  // Non-ASCII has to be declared or Afrosoft mangles it.
  if (/[^\x00-\x7F]/.test(message)) params.set('unicode', 'yes')

  const upstream = await fetch(`https://${afrosoftDomain()}/client/api/sendmessage?${params.toString()}`)
  return { ok: upstream.ok, status: upstream.status, body: await upstream.text() }
}

/**
 * Whether Afrosoft actually accepted the batch.
 *
 * It answers HTTP 200 even when it refuses the message outright, so the
 * transport status says nothing; the real verdict is error-code 000 in the
 * body. Callers needing per-number outcomes should parse the body instead —
 * a batch can come back 000 with individual numbers still failed.
 */
export function afrosoftAccepted(body: string): boolean {
  return /"error-code"\s*:\s*"000"/.test(body)
}
