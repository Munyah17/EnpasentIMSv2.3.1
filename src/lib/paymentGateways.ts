/**
 * Payment Gateways
 *
 * EcoCash Instant — Econet's own direct merchant rail (EIP). A prompt is
 *                   pushed straight to the payer's handset and EcoCash
 *                   debits them. Standalone: nothing to do with Paynow.
 * Paynow          — an aggregator whose hosted page resells several rails
 *                   (EcoCash, OneMoney, InnBucks, ZIPIT, card). Its EcoCash
 *                   option is NOT EcoCash Instant — different credentials,
 *                   different references, different statuses, and a
 *                   transaction on one is invisible to the other.
 * Zipit           — ZimSwitch ZIPIT bank transfer (display-only; verified
 *                   manually by staff against the bank statement).
 *
 * No card, wallet or bank detail is ever entered in this application or
 * passed through it. Paynow's own hosted page collects all of that; this
 * side only ever sends a reference, an amount and a currency, and is later
 * told by the server whether that reference was paid.
 *
 * Every gateway credential lives on the server and never touches the
 * browser: EcoCash Instant behind EIP_* (api/ecocash-instant.ts), Paynow
 * behind PAYNOW_USD_* / PAYNOW_ZIG_* (api/paynow.ts). Paynow's integration
 * key is the webhook's signing secret -- anyone holding it can forge a
 * "paid" status update -- so it is server-only, not merely inconvenient to
 * expose.
 */

import type { GatewaySettings } from '../types'

// Neither rail is assembled in the browser any more, so the generic relay
// that used to sign and post Paynow requests from here is gone. EcoCash
// Instant goes through api/ecocash-instant.ts and Paynow through
// api/paynow.ts, each using that provider's own documented method with the
// credentials held server-side. api/gateway-proxy.ts still exists for SMS.

const GW_KEY = 'tqfy_gateway_settings'

export const DEFAULT_GW_SETTINGS: GatewaySettings = {
  ecocashMerchantCode: '',
  ecocashMerchantPin: '',
  ecocashMerchantPhone: '',
  ecocashApiUrl: 'https://api.ecocash.co.zw/merchant',
  paynowIntegrationId: '',
  paynowIntegrationKey: '',
  paynowReturnUrl: window.location.origin + '/payment/return',
  paynowResultUrl: window.location.origin + '/payment/result',
  zipitBankName: 'CABS',
  zipitAccountName: 'Enpasent Multiple Agent',
  zipitAccountNumber: '1001234567',
  zipitBranchCode: '003',
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpUser: '',
  smtpPass: '',
  smtpFrom: 'noreply@enpassent.co.zw',
  smtpFromName: 'Enpasent Multiple Agent',
}

export function getGatewaySettings(): GatewaySettings {
  try {
    const raw = localStorage.getItem(GW_KEY)
    if (raw) return { ...DEFAULT_GW_SETTINGS, ...JSON.parse(raw) }
  } catch { /**/ }
  return { ...DEFAULT_GW_SETTINGS }
}

export function saveGatewaySettings(s: GatewaySettings) {
  try { localStorage.setItem(GW_KEY, JSON.stringify(s)) } catch { /**/ }
}

// ── Common types ────────────────────────────────────────────────────

/**
 * ZWG is the ISO code for Zimbabwe Gold; "ZiG" is what everyone calls it.
 * Paynow has no currency field — an integration ID *is* a currency — so
 * this selects which of the two merchant integrations the server uses.
 */
export type Currency = 'USD' | 'ZWG'

export const CURRENCY_LABEL: Record<Currency, string> = { USD: 'USD', ZWG: 'ZiG' }
export const CURRENCY_SYMBOL: Record<Currency, string> = { USD: 'US$', ZWG: 'ZiG ' }

export function formatMoney(amount: number, currency: Currency): string {
  return `${CURRENCY_SYMBOL[currency]}${amount.toFixed(2)}`
}

export interface PaymentRequest {
  policyId: string
  policyNumber: string
  clientName: string
  clientPhone: string
  clientEmail: string
  amount: number
  reference: string
  /** Paynow only. Defaults to USD server-side when omitted. */
  currency?: Currency
}

export interface PaymentResponse {
  success: boolean
  transactionId?: string
  status: 'pending' | 'success' | 'failed' | 'redirect'
  redirectUrl?: string
  pollUrl?: string
  message: string
  gateway: 'ecocash' | 'paynow' | 'zipit'
  /** No longer set by any rail. An unconfigured gateway is reported as a
   *  refusal, not as a pretend payment that staff could then mark received. */
  simulated?: never
}

// ── Payment log ────────────────────────────────────────────────────

const PAYMENT_LOG_KEY = 'tqfy_online_payment_log'

export interface OnlinePaymentLog {
  id: string
  policyId: string
  policyNumber: string
  gateway: 'ecocash' | 'paynow' | 'zipit'
  amount: number
  reference: string
  status: 'pending' | 'success' | 'failed'
  transactionId?: string
  ts: string
}

export function getPaymentLog(): OnlinePaymentLog[] {
  try { return JSON.parse(localStorage.getItem(PAYMENT_LOG_KEY) ?? '[]') } catch { return [] }
}

function logPayment(entry: OnlinePaymentLog) {
  try {
    const log = getPaymentLog()
    log.unshift(entry)
    localStorage.setItem(PAYMENT_LOG_KEY, JSON.stringify(log.slice(0, 300)))
  } catch { /**/ }
}

// ── EcoCash Instant (direct rail — not Paynow) ─────────────────────

interface EipChargeReply {
  outcome?: 'success' | 'failed' | 'pending'
  lookupUrl?: string
  transactionId?: string
  message?: string
  sandbox?: boolean
  error?: string
}

/**
 * Pushes an EcoCash prompt straight to the payer's handset.
 *
 * With EIP credentials unset on the server this returns a clearly-labelled
 * simulation instead — never something a user could mistake for a real
 * payment, and never a "failed" verdict for a rail that is merely switched
 * off.
 */
export async function initiateEcoCash(req: PaymentRequest): Promise<PaymentResponse> {
  const ref = req.reference

  let reply: EipChargeReply
  let httpStatus: number
  try {
    const res = await fetch('/api/ecocash-instant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'charge',
        phone: req.clientPhone,
        amount: req.amount,
        reference: ref,
        description: `Insurance Premium: ${req.policyNumber}`,
      }),
    })
    httpStatus = res.status
    reply = await res.json().catch(() => ({})) as EipChargeReply
  } catch (e) {
    return { success: false, status: 'failed', message: `Could not reach the EcoCash service: ${e}`, gateway: 'ecocash' }
  }

  // 503 means the rail isn't configured on this deployment. That is a
  // refusal, not a payment. It used to return success with simulated:true,
  // which put a "pending" entry in the payment log and offered staff a
  // button to mark it received -- money recorded for a prompt that was
  // never sent. If EcoCash cannot be reached, nothing happened.
  if (httpStatus === 503) {
    return {
      success: false, status: 'failed', gateway: 'ecocash',
      message: 'EcoCash Instant is not configured on the server, so no prompt was sent. Set the EIP credentials to collect through this rail, or take the payment another way and record it on the Payments page.',
    }
  }

  if (reply.outcome === 'failed' || reply.error) {
    logPayment({ id: `ECO${Date.now()}`, policyId: req.policyId, policyNumber: req.policyNumber, gateway: 'ecocash', amount: req.amount, reference: ref, status: 'failed', ts: new Date().toISOString() })
    return { success: false, status: 'failed', message: reply.message ?? reply.error ?? 'EcoCash declined the request.', gateway: 'ecocash' }
  }

  const txnId = reply.transactionId ?? ref
  logPayment({ id: txnId, policyId: req.policyId, policyNumber: req.policyNumber, gateway: 'ecocash', amount: req.amount, reference: ref, status: 'pending', transactionId: txnId, ts: new Date().toISOString() })
  return {
    success: true,
    transactionId: txnId,
    pollUrl: reply.lookupUrl,
    status: 'pending',
    message: `Payment prompt sent to ${req.clientPhone}. Approve it on the phone${reply.sandbox ? ' (sandbox credentials: only numbers whitelisted with EcoCash will receive it)' : ''}.`,
    gateway: 'ecocash',
  }
}

/**
 * Asks EcoCash what became of one transaction.
 *
 * Anything short of a definite answer comes back pending. A payment that
 * has not been confirmed is not a payment that failed, and the difference
 * decides whether a policy gets marked paid.
 */
export async function pollEcoCash(lookupUrl: string): Promise<{ status: 'pending' | 'success' | 'failed'; message: string; amount?: number }> {
  try {
    const res = await fetch('/api/ecocash-instant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lookup', lookupUrl }),
    })
    const data = await res.json().catch(() => ({})) as { outcome?: 'success' | 'failed' | 'pending'; message?: string; amount?: number }
    // amount is best-effort here -- see AMOUNT_FIELDS in
    // api/_lib/ecocashInstant.ts -- undefined means EcoCash's reply did not
    // include anything recognisable as one, not that it was checked and
    // matched. The caller should only treat a present amount as a real
    // reconciliation, not absence-of-amount as absence-of-risk.
    if (data.outcome === 'success') return { status: 'success', message: data.message ?? 'Payment confirmed by EcoCash', amount: data.amount }
    if (data.outcome === 'failed') return { status: 'failed', message: data.message ?? 'EcoCash declined this transaction' }
    return { status: 'pending', message: data.message ?? 'Waiting for the payer to approve…' }
  } catch {
    return { status: 'pending', message: 'Could not reach EcoCash; still waiting…' }
  }
}

// ── Paynow ─────────────────────────────────────────────────────────

/**
 * Starts a Paynow transaction.
 *
 * The request is built and signed by Paynow's own SDK on the server (see
 * api/paynow.ts). This used to be assembled here by hand and signed with
 * MD5; Paynow signs with SHA512, so every call came back "Invalid Hash"
 * and no transaction was ever created, whatever key was configured.
 * Nothing in this file reimplements Paynow's protocol any more.
 *
 * A hosted checkout: Paynow's own page presents the full rail picker
 * (EcoCash, OneMoney, InnBucks, Omari, ZIPIT, card), so no method is
 * pre-selected on the payer's behalf.
 */
export async function initiatePaynow(req: PaymentRequest): Promise<PaymentResponse> {
  const ref = req.reference

  let reply: { ok?: boolean; redirectUrl?: string; pollUrl?: string; error?: string }
  let httpStatus: number
  try {
    const res = await fetch('/api/paynow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'initiate',
        reference: ref,
        amount: req.amount,
        // Picks which merchant integration the server uses. Sending this
        // wrong does not fail loudly -- it bills the wrong ledger in the
        // wrong denomination, and only reconciliation finds it.
        currency: req.currency ?? 'USD',
        description: `Insurance Premium: ${req.policyNumber}`,
        email: req.clientEmail,
        // Required server-side so api/paynow-webhook.ts has a record of
        // what this reference was actually for -- see paynow_transactions.
        policyId: req.policyId,
      }),
    })
    httpStatus = res.status
    reply = await res.json().catch(() => ({}))
  } catch (e) {
    return { success: false, status: 'failed', message: `Could not reach the Paynow service: ${e}`, gateway: 'paynow' }
  }

  // Unconfigured is a refusal, not a payment. The server names the exact
  // missing pair (each currency has its own integration), so its message is
  // more useful than anything this side could guess at.
  if (httpStatus === 503) {
    return {
      success: false, status: 'failed', gateway: 'paynow',
      message: reply.error
        ?? 'Paynow is not configured on the server. Take the payment another way and record it on the Payments page.',
    }
  }

  if (!reply.ok || !reply.redirectUrl) {
    // Paynow's own words -- "the integration ID is in test mode…", "not a
    // site integration", "currently inactive" -- each name the actual fix.
    logPayment({ id: `PNW${Date.now()}`, policyId: req.policyId, policyNumber: req.policyNumber, gateway: 'paynow', amount: req.amount, reference: ref, status: 'failed', ts: new Date().toISOString() })
    return { success: false, status: 'failed', message: reply.error ?? 'Paynow declined the request.', gateway: 'paynow' }
  }

  logPayment({ id: ref, policyId: req.policyId, policyNumber: req.policyNumber, gateway: 'paynow', amount: req.amount, reference: ref, status: 'pending', transactionId: ref, ts: new Date().toISOString() })
  return {
    success: true,
    transactionId: ref,
    redirectUrl: reply.redirectUrl,
    pollUrl: reply.pollUrl,
    status: 'redirect',
    message: 'Redirecting to Paynow…',
    gateway: 'paynow',
  }
}

/**
 * Asks Paynow what became of a transaction, through the SDK's own
 * pollTransaction -- which POSTs as Paynow expects and verifies the
 * response hash before trusting it.
 */
export async function pollPaynow(pollUrl: string): Promise<{ status: 'pending' | 'success' | 'failed'; message: string; amount?: number }> {
  try {
    const res = await fetch('/api/paynow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'poll', pollUrl }),
    })
    const data = await res.json().catch(() => ({})) as { status?: string; paid?: boolean; amount?: number | null }
    // Paynow always states an amount for a real transaction, so the caller
    // is expected to check it against what it asked for before crediting
    // "paid" -- see OnlinePaymentModal.tsx's reconciliation against
    // totalAmount, and api/paynow-webhook.ts for the same check on the
    // server-side path.
    if (data.paid) return { status: 'success', message: 'Payment successful', amount: data.amount ?? undefined }
    const s = (data.status ?? '').toLowerCase()
    if (s.includes('cancel') || s.includes('disputed')) return { status: 'failed', message: data.status ?? 'Cancelled' }
    // Anything else is not an answer yet, so it stays pending.
    return { status: 'pending', message: data.status || 'Awaiting payment' }
  } catch {
    return { status: 'pending', message: 'Could not reach Paynow; still waiting…' }
  }
}

// ── Zipit (ZimSwitch bank transfer) ────────────────────────────────

export function getZipitDetails(req: PaymentRequest): PaymentResponse & { bankDetails: typeof _details } {
  const cfg = getGatewaySettings()
  const _details = {
    bankName: cfg.zipitBankName,
    accountName: cfg.zipitAccountName,
    accountNumber: cfg.zipitAccountNumber,
    branchCode: cfg.zipitBranchCode,
    reference: req.reference,
    amount: req.amount,
  }
  logPayment({ id: `ZIPIT${Date.now()}`, policyId: req.policyId, policyNumber: req.policyNumber, gateway: 'zipit', amount: req.amount, reference: req.reference, status: 'pending', ts: new Date().toISOString() })
  return {
    success: true,
    status: 'pending',
    message: 'Transfer bank details below. Payment will be confirmed by staff within 1 business day.',
    gateway: 'zipit',
    bankDetails: _details,
  }
}
