/**
 * The tag that opens every payment reference this app creates.
 *
 * More than three applications collect through the same Paynow account, so
 * a reference on Paynow's side or on a bank statement has to say which one
 * started the transaction. Without it, a statement line is just an amount
 * and a date, and working out which system took the money means guessing
 * from timing. Reconciliation reads this prefix.
 *
 * ENPA is this application. Tags already taken by other systems on the same
 * Paynow account are MIMS and MWEB — never reuse one, or two systems become
 * impossible to tell apart after the fact.
 *
 * Kept short, uppercase and free of separators a gateway might normalise
 * away; the dash after it is the only separator. Paynow and EcoCash Instant
 * both accept it.
 *
 * Policy numbers are never run through taggedReference() below -- a client
 * reads and quotes those, and they identify cover rather than a movement of
 * money, so they get their own shape from generatePolicyNumber() instead.
 * Both start with the same ENPA identity; only the money-reference tagging
 * function's "-<original id>" mechanics don't apply to a policy number.
 */
export const ORIGIN_TAG = 'ENPA'

/**
 * Prefixes a reference with the origin tag, once.
 *
 * Idempotent because a reference can pass through here more than once — a
 * retry that reuses an existing reference must not become
 * "ENPA-ENPA-…", which would no longer match the row recorded against it
 * at initiate time and would break reconciliation rather than help it.
 */
export function taggedReference(reference: string): string {
  return reference.startsWith(`${ORIGIN_TAG}-`) ? reference : `${ORIGIN_TAG}-${reference}`
}

/** Whether a reference was created by this app. Useful when reconciling a
 *  mixed export from Paynow or a bank statement. */
export function isOwnReference(reference: string): boolean {
  return reference.startsWith(`${ORIGIN_TAG}-`)
}

/**
 * A new policy number.
 *
 * The app this was cloned from (Tariqify IMS) generates its own policy
 * numbers as `MIMS<year><3 digits>` -- its own origin tag directly followed
 * by a truncated timestamp, no separator. Enpassent's own two policy-number
 * sites had inherited that exact shape, one even reusing the literal string
 * "POL" byte-for-byte from Tariqify's USSD flow -- so two systems built by
 * the same author could produce numbers indistinguishable from each other
 * by format alone, on top of not sharing a prefix with anything else this
 * app already brands as ENPA (see taggedReference() above).
 *
 * `<TAG>-<YYMM>-<5 base36 chars>` is deliberately a different shape, not
 * just a different four letters in the same slots: dash-grouped, a
 * year+month instead of year alone, and a random alphanumeric tail rather
 * than trailing timestamp digits -- which also removes a real collision
 * risk the old scheme had (two policies created within the same
 * millisecond-derived slice could tie; 5 base36 characters is 36^5, over
 * 60 million values, checked per call site's own creation path, not
 * globally unique-guaranteed but astronomically unlikely to collide twice
 * in one run).
 */
export function generatePolicyNumber(now = new Date()): string {
  const year = String(now.getFullYear()).slice(-2)
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, '0')
  return `${ORIGIN_TAG}-${year}${month}-${suffix}`
}
