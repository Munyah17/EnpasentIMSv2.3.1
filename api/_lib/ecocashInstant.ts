/**
 * EcoCash Instant Payment (EIP) -- https://developers.ecocash.co.zw
 *
 * A standalone, direct merchant rail: we push a USSD prompt to the payer's
 * handset and EcoCash debits them. It is NOT Paynow, and Paynow's EcoCash
 * option is NOT this. Paynow is an aggregator that resells several rails
 * (EcoCash, OneMoney, InnBucks, ZIPIT, card) behind its own hosted page; a
 * transaction started here is invisible to Paynow and vice versa, with
 * different references, different credentials and different statuses. The
 * two are kept entirely separate on purpose.
 *
 * Credentials live on the server (EIP_USERNAME / EIP_PASSWORD and the
 * merchant fields below), never in the browser -- a merchant PIN in
 * localStorage is a merchant PIN on every device that ever opened the app.
 *
 * Shared by api/ecocash-instant.ts (Vercel) and the Netlify mirror.
 */

export const EIP_BASE_URL = process.env.EIP_BASE_URL || 'https://developers.ecocash.co.zw/sandbox/payment/v1'

export function eipConfigured(): boolean {
  return !!(process.env.EIP_USERNAME && process.env.EIP_PASSWORD)
}

export function eipIsSandbox(): boolean {
  return EIP_BASE_URL.includes('/sandbox/')
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${process.env.EIP_USERNAME}:${process.env.EIP_PASSWORD}`).toString('base64')}`
}

/** EIP wants MSISDN as 263XXXXXXXXX. */
export function normalizeMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('263')) return digits
  if (digits.startsWith('0')) return `263${digits.slice(1)}`
  return `263${digits}`
}

export function lookupUrlFor(msisdn: string, reference: string): string {
  return `${EIP_BASE_URL}/${msisdn}/transactions/amount/${encodeURIComponent(reference)}`
}

export interface EipStatusResult {
  outcome: 'success' | 'failed' | 'pending'
  /** EcoCash's own words, kept verbatim -- more use to whoever is tracing
   *  this than any paraphrase of ours. */
  message?: string
  transactionId?: string
  /** The amount EcoCash itself reports for this transaction, when the
   *  response actually includes one (see AMOUNT_FIELDS). Lets the caller
   *  verify it matches what was charged before trusting a bare "success",
   *  rather than crediting whatever the paid flag alone claims. */
  amount?: number
}

/** paymentAmount.charginginformation.amount is nested three deep in what we
 *  SEND; if EIP mirrors that shape back, a flat field-name search misses it,
 *  so the charge-request nesting is also walked here specifically. */
function pickAmount(data: Record<string, unknown>): number | undefined {
  const nested = (data.paymentAmount as Record<string, unknown> | undefined)?.charginginformation as Record<string, unknown> | undefined
  const candidates = nested ? [nested, ...sources(data)] : sources(data)
  for (const source of candidates) {
    for (const field of AMOUNT_FIELDS) {
      const v = source[field]
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
      if (Number.isFinite(n)) return n
    }
  }
  return undefined
}

const SUCCESS_TOKENS = ['SUCCESS', 'COMPLETED', 'CHARGED', 'PAID']
/** Definite refusals only. Nothing meaning "not yet" belongs here: telling
 *  someone a payment failed when EcoCash simply has not answered is how a
 *  paid policy gets recorded as unpaid. */
const FAILURE_TOKENS = [
  'FAIL', 'DENIED', 'DECLINE', 'REJECT', 'CANCEL', 'EXPIRE', 'TIMED OUT', 'TIMEOUT',
  'INSUFFICIENT', 'LIMIT', 'INVALID PIN', 'BARRED', 'REVERSED', 'ABORT', 'NOT ALLOWED',
]

const STATUS_FIELDS = [
  'transactionOperationStatus', 'transactionStatus', 'status', 'statusMessage',
  'transactionStatusDescription', 'responseMessage', 'message', 'description', 'error',
]
const ID_FIELDS = ['ecocashReference', 'serverReferenceCode', 'transactionId', 'referenceCode']
// Best-effort only -- these field names mirror the shape of what we SEND
// (paymentAmount.charginginformation.amount) plus the plainer names other
// EIP responses have been seen to use, but have not been confirmed against
// a live sandbox reply. Never invented as a mismatch: pickAmount() returns
// undefined, not a wrong number, when none of these are present, so a
// gateway that genuinely doesn't echo the amount back degrades to today's
// paid-status-only behaviour rather than blocking every real payment.
const AMOUNT_FIELDS = ['amount', 'transactionAmount', 'chargedAmount', 'paidAmount']

function sources(data: Record<string, unknown>): Record<string, unknown>[] {
  const nested = [data.data, data.result, data.transaction, data.response]
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
  return [data, ...nested]
}

function pick(data: Record<string, unknown>, fields: string[]): string[] {
  const out: string[] = []
  for (const source of sources(data)) {
    for (const field of fields) {
      const v = source[field]
      if (typeof v === 'string' && v.trim()) out.push(v.trim())
    }
  }
  return out
}

export function interpretEipResponse(data: Record<string, unknown>): EipStatusResult {
  const strings = pick(data, STATUS_FIELDS)
  const upper = strings.map(v => v.toUpperCase())
  const message = strings.find(v => v.length > 2)
  const transactionId = pick(data, ID_FIELDS)[0]

  const amount = pickAmount(data)
  if (upper.some(v => SUCCESS_TOKENS.some(t => v.includes(t)))) return { outcome: 'success', message, transactionId, amount }
  if (upper.some(v => FAILURE_TOKENS.some(t => v.includes(t)))) return { outcome: 'failed', message: message ?? 'Transaction failed', transactionId }
  return { outcome: 'pending', message, transactionId }
}

export interface ChargeInput {
  phone: string
  amount: number
  reference: string
  description: string
  notifyUrl?: string
}

/** Pushes the payment prompt to the payer's handset. */
export async function chargeEip(input: ChargeInput): Promise<{
  httpStatus: number
  result: EipStatusResult
  lookupUrl: string
  msisdn: string
}> {
  const msisdn = normalizeMsisdn(input.phone)
  const res = await fetch(`${EIP_BASE_URL}/transactions/amount/`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientCorrelator: input.reference,
      notifyUrl: input.notifyUrl,
      referenceCode: input.reference,
      tranType: 'MER',
      endUserId: msisdn,
      remarks: input.description,
      transactionOperationStatus: 'Charged',
      paymentAmount: {
        charginginformation: { amount: Number(input.amount), currency: 'USD', description: input.description },
        chargeMetaData: { channel: 'WEB' },
      },
      merchantCode: process.env.EIP_MERCHANT_CODE,
      merchantPin: process.env.EIP_MERCHANT_PIN,
      merchantNumber: process.env.EIP_MERCHANT_NUMBER,
      countryCode: 'ZW',
      terminalID: process.env.EIP_TERMINAL_ID || 'IMS001',
      location: 'Harare',
      superMerchantName: process.env.EIP_SUPER_MERCHANT_NAME || 'Enpasent Multiple Agent',
      merchantName: process.env.EIP_MERCHANT_NAME || 'Enpasent Multiple Agent',
    }),
  })

  const text = await res.text()
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) as Record<string, unknown> } catch { /* interpreted as pending below */ }

  return {
    httpStatus: res.status,
    result: interpretEipResponse(data),
    lookupUrl: lookupUrlFor(msisdn, input.reference),
    msisdn,
  }
}

/**
 * Asks EcoCash what became of one transaction.
 *
 * Anything that isn't a definite answer -- a 404, an unreachable host, an
 * unparseable body -- comes back pending. Not being able to ask is not the
 * same as being told no, and this is the check a payment is confirmed by.
 */
export async function lookupEip(lookupUrl: string): Promise<EipStatusResult> {
  try {
    const res = await fetch(lookupUrl, { headers: { Authorization: authHeader(), Accept: 'application/json' } })
    const text = await res.text()
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(text) as Record<string, unknown> } catch { /* handled below */ }

    if (res.status === 404) return { outcome: 'pending', message: 'EcoCash has no record of this transaction yet.' }

    // Being turned away at the door tells us nothing about the money. Bad or
    // missing credentials return bodies like "Authentication Failed", and
    // FAILURE_TOKENS matches "FAIL" -- so without this a config problem on
    // our side would be reported as the payer's payment having failed.
    if (res.status === 401 || res.status === 403) {
      return { outcome: 'pending', message: `EcoCash rejected our credentials (HTTP ${res.status}); the transaction was not checked.` }
    }
    if (!res.ok && Object.keys(data).length === 0) return { outcome: 'pending', message: `EcoCash lookup returned HTTP ${res.status}` }
    return interpretEipResponse(data)
  } catch (e) {
    return { outcome: 'pending', message: `Could not reach EcoCash: ${e}` }
  }
}
