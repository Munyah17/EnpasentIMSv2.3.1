/**
 * The USD/ZiG rate used to convert a billed amount into a ZiG charge.
 *
 * `rate` is ZiG per 1 USD. It is entered by an admin and kept as history:
 * the newest effective_date is the rate in force, and older rows stay
 * untouched so past conversions remain reconstructable.
 *
 * Nothing here decides what is actually charged. The browser shows the
 * converted figure so the payer knows what they are agreeing to, but the
 * server does the conversion again from the USD price when it calls Paynow
 * -- see api/paynow.ts. A rate the client could influence is a rate someone
 * could pay a policy off with.
 */

export interface ExchangeRate {
  id: string
  currency: 'ZWG'
  rate: number
  effectiveDate: string
  source: 'manual' | 'estimate'
  note?: string
  setBy?: string
  createdAt: string
}

/** Rates are published weekly, so one older than this is due for review
 *  rather than wrong. */
export const RATE_STALE_AFTER_DAYS = 7

export function daysSince(effectiveDate: string, today = new Date()): number {
  const then = new Date(`${effectiveDate}T00:00:00`)
  if (Number.isNaN(then.getTime())) return Number.POSITIVE_INFINITY
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(0, Math.round((startOfToday.getTime() - then.getTime()) / 86400000))
}

export function isStale(rate: ExchangeRate | null, today = new Date()): boolean {
  if (!rate) return true
  return daysSince(rate.effectiveDate, today) >= RATE_STALE_AFTER_DAYS
}

/** How the rate's age should be described wherever it is surfaced. */
export function rateAgeLabel(rate: ExchangeRate | null, today = new Date()): string {
  if (!rate) return 'No rate set'
  const days = daysSince(rate.effectiveDate, today)
  if (days === 0) return 'Set today'
  if (days === 1) return 'Set yesterday'
  return `Set ${days} days ago`
}

/** Rounded to the cent, the same way the server rounds it, so the figure
 *  shown before redirecting is the figure Paynow asks for. */
export function convertUsdToZig(usd: number, rate: number): number {
  return Math.round(usd * rate * 100) / 100
}

/**
 * Rejects a typed rate before it can be saved.
 *
 * The bounds are deliberately wide. They are here to catch a slipped
 * decimal point or a figure entered the wrong way round (USD per ZiG rather
 * than ZiG per USD), not to second-guess a real rate -- both of which turn
 * every subsequent ZiG charge into the wrong amount, in a way nobody
 * notices until the money is counted.
 */
export function validateRate(input: string): { ok: true; rate: number } | { ok: false; error: string } {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Enter the rate.' }
  const rate = Number(trimmed)
  if (!Number.isFinite(rate)) return { ok: false, error: 'The rate must be a number.' }
  if (rate <= 0) return { ok: false, error: 'The rate must be greater than zero.' }
  if (rate < 1) return { ok: false, error: 'Enter ZiG per 1 USD — a rate below 1 looks inverted.' }
  if (rate > 100000) return { ok: false, error: 'That rate looks too large. Check for a misplaced decimal point.' }
  return { ok: true, rate }
}
