import { Paynow } from 'paynow'

/**
 * Paynow credentials, per currency.
 *
 * Paynow does not take a currency parameter: an integration ID *is* a
 * currency. Ours are two separate merchant integrations, and sending a ZiG
 * payment through the USD pair does not fail loudly — it bills the wrong
 * ledger in the wrong denomination, which is only discovered at
 * reconciliation. So currency is chosen once, here, and every call site
 * names it rather than assuming.
 *
 * Nothing is hardcoded. Integration keys are the signing secret for the
 * webhook — anyone holding one can forge a "paid" status update — and this
 * repository is on GitHub, so they live only in the server environment
 * (gitignored .env locally, project settings on Vercel).
 */

export const CURRENCIES = ['USD', 'ZWG'] as const
export type Currency = (typeof CURRENCIES)[number]

/** ZWG is the ISO code; "ZiG" is what it is called in Zimbabwe and what
 *  staff and clients will look for on screen. */
export const CURRENCY_LABEL: Record<Currency, string> = { USD: 'USD', ZWG: 'ZiG' }
export const CURRENCY_SYMBOL: Record<Currency, string> = { USD: 'US$', ZWG: 'ZiG ' }

export function isCurrency(v: unknown): v is Currency {
  return typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v)
}

export interface PaynowCredentials {
  integrationId: string
  integrationKey: string
  currency: Currency
}

/**
 * Resolves the integration pair for one currency.
 *
 * Falls back to the currency-less PAYNOW_INTEGRATION_ID/KEY so a deployment
 * that has not yet had the per-currency variables added keeps working
 * exactly as it did — that pair was USD, so only USD inherits it. Letting
 * ZiG fall back too would silently bill ZiG through a USD integration,
 * which is the precise mistake this split exists to prevent.
 */
export function paynowCredentials(currency: Currency): PaynowCredentials | null {
  const prefix = currency === 'ZWG' ? 'PAYNOW_ZIG' : 'PAYNOW_USD'
  const integrationId = process.env[`${prefix}_INTEGRATION_ID`]
    || (currency === 'USD' ? process.env.PAYNOW_INTEGRATION_ID : undefined)
  const integrationKey = process.env[`${prefix}_INTEGRATION_KEY`]
    || (currency === 'USD' ? process.env.PAYNOW_INTEGRATION_KEY : undefined)

  if (!integrationId || !integrationKey) return null
  return { integrationId, integrationKey, currency }
}

/** Every currency this deployment can actually take money in. */
export function configuredCurrencies(): Currency[] {
  return CURRENCIES.filter(c => paynowCredentials(c) !== null)
}

/**
 * An SDK client for verifying and polling, which need only the key.
 *
 * Paynow's own quickstart constructs it this way for pollTransaction and
 * parseStatusUpdate — the integration ID is not part of either signature.
 */
export function paynowVerifier(integrationKey: string): Paynow {
  return new Paynow('', integrationKey, '', '')
}

/**
 * Whether Paynow has approved these integrations for live use.
 *
 * While an integration is in test mode Paynow rejects the entire
 * transaction if authemail is anything but the merchant's own registered
 * address, so the payer's email is withheld until this is true. A missing
 * auto-login is an inconvenience; a transaction Paynow refuses outright is
 * a client who cannot pay at all.
 */
export function paynowIsLive(): boolean {
  return process.env.PAYNOW_LIVE === 'true'
}
