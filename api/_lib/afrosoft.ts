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
 * The account is registered with Afrosoft under the user ID "Motions",
 * which is also the default sender ID assigned to it — that default is what
 * recipients saw until this was set, and it is the wrong brand entirely.
 *
 * The intended name is "Enpasent Multiple Agent", but a GSM alphanumeric
 * sender ID is capped at 11 characters and that is 23, so it cannot be the
 * sender ID; carriers reject or truncate it. The handset shows "Enpasent"
 * and the message text carries the full name — see the bodies in
 * src/lib/signupNotifications.ts.
 *
 * Afrosoft only accepts sender IDs registered against the account and
 * rejects anything else outright with "sender-id is invalid", which fails
 * the whole batch rather than one message. So this stays overridable by
 * AFROSOFT_SMS_SENDER_ID: registering a different spelling is then an env
 * var change, not a redeploy.
 */
export const DEFAULT_SENDER_ID = 'Enpasent'

/** What the full brand name is, for message bodies. Not usable as a sender
 *  ID — see DEFAULT_SENDER_ID. */
export const BRAND_NAME = 'Enpasent Multiple Agent'

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

/**
 * Normalises any of the four ways a Zimbabwean number gets typed --
 * "0773909307", "263773909307", "+263773909307", and the common mistake
 * "+2630773909307" (country code AND the local leading 0, both present) --
 * to the same "263773909307".
 *
 * The country code is stripped first, before the leading 0 is checked, so a
 * number carrying both isn't left with a stray 0 wedged after 263 -- the
 * previous order (checking for a leading 0 first) never got there, because
 * "2630773909307" doesn't start with "0", so the whole number passed
 * through unchanged and failed validation.
 */
export function normalizeMsisdn(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('263')) digits = digits.slice(3)
  if (digits.startsWith('0')) digits = digits.slice(1)
  return `263${digits}`
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
    // "Optional, but better to pass unique id" per Afrosoft's docs: one id
    // per message, echoed back on both sent-sms-details and
    // failed-sms-details. Afrosoft reformats the numbers it returns
    // ("263…" comes back "+263…"), so matching a response row to a
    // recipient by number alone means normalising both sides and hoping;
    // an id we chose is exact.
    'client-sms-ids': clientSmsIds(mobiles),
  })
  // Non-ASCII has to be declared or Afrosoft mangles it.
  if (/[^\x00-\x7F]/.test(message)) params.set('unicode', 'yes')

  const upstream = await fetch(`https://${afrosoftDomain()}/client/api/sendmessage?${params.toString()}`)
  return { ok: upstream.ok, status: upstream.status, body: await upstream.text() }
}

/**
 * One id per recipient, positionally matching the comma-separated `mobiles`.
 *
 * Deterministic from the number plus a per-batch nonce, so the caller can
 * recompute the same ids to read the response without having to thread them
 * back through the relay.
 */
export function clientSmsIds(mobiles: string): string {
  const batch = Date.now().toString(36)
  return mobiles.split(',').map((m, i) => `${batch}-${i}-${m.replace(/\D/g, '').slice(-9)}`).join(',')
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
