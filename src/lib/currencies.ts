import { db } from './db'

/**
 * Which currencies can currently be paid in.
 *
 * USD is the base currency: every product price is held in USD, and any
 * other currency's price is worked out from it at the rate on record.
 * Turning a currency off leaves it visible but unselectable, rather than
 * removing it -- a client who was expecting to pay in ZiG should be told it
 * is unavailable, not left wondering where the option went.
 *
 * Paynow settles in the currency of the integration that created the
 * transaction, so each currency here corresponds to a separate merchant
 * integration server-side (see api/_lib/paynow.ts). Choosing a currency is
 * therefore choosing which account the money lands in, not a display
 * preference.
 */

export type CurrencyCode = 'USD' | 'ZWG'

export const CURRENCY_CODES: CurrencyCode[] = ['USD', 'ZWG']

/** ZWG is the ISO code; "ZiG" is what it is called in Zimbabwe and what a
 *  client will look for on screen. */
export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  USD: 'USD',
  ZWG: 'ZiG',
}

export const CURRENCY_NAMES: Record<CurrencyCode, string> = {
  USD: 'US Dollar',
  ZWG: 'Zimbabwe Gold',
}

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: 'US$',
  ZWG: 'ZiG ',
}

/** Shown on a currency that has been turned off. */
export const CURRENCY_UNAVAILABLE_MESSAGE = 'Temporarily unavailable due to maintenance'

export const SETTINGS_KEY = 'currency_settings'

export interface CurrencySettings {
  active: Record<CurrencyCode, boolean>
}

export const DEFAULT_CURRENCY_SETTINGS: CurrencySettings = {
  active: { USD: true, ZWG: true },
}

export async function getCurrencySettings(): Promise<CurrencySettings> {
  const stored = await db.settings.get<Partial<CurrencySettings>>(SETTINGS_KEY)
  return { active: { ...DEFAULT_CURRENCY_SETTINGS.active, ...(stored?.active ?? {}) } }
}

export async function saveCurrencySettings(value: CurrencySettings): Promise<{ error: string | null }> {
  return db.settings.set(SETTINGS_KEY, value)
}

/** The base currency is never turned off: prices are held in it, so there
 *  would be nothing left to price from. */
export function canDeactivate(code: CurrencyCode): boolean {
  return code !== 'USD'
}

export function isActive(settings: CurrencySettings, code: CurrencyCode): boolean {
  if (!canDeactivate(code)) return true
  return settings.active[code] !== false
}

export function formatMoney(amount: number, code: CurrencyCode): string {
  return `${CURRENCY_SYMBOLS[code]}${amount.toFixed(2)}`
}
