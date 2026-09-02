/**
 * The tag that opens every payment reference this app creates.
 *
 * More than three applications collect through the same Paynow account, so
 * a reference on Paynow's side or on a bank statement has to say which one
 * started the transaction. Without it, a statement line is just an amount
 * and a date, and working out which system took the money means guessing
 * from timing. Reconciliation reads this prefix.
 *
 * The tags in use across the estate — keep them distinct, and never reuse
 * one, or the two apps sharing it become impossible to tell apart after
 * the fact:
 *
 *   ENPA  this app — Enpasent IMS (the broker)
 *   MIMS  Motions Tariqify IMS      (imsv3/src/lib/originTag.ts)
 *   MWEB  Motions website           (motions-website/api/create-checkout.ts)
 *
 * Kept short, uppercase and free of separators a gateway might normalise
 * away; the dash after it is the only separator. Paynow and EcoCash Instant
 * both accept it — EcoCash carries it as clientCorrelator/referenceCode and
 * URL-encodes it for the lookup, and the other two apps have been sending
 * dashed references through the same Paynow account already.
 *
 * Policy numbers are deliberately left untagged: a client reads and quotes
 * those, and they identify cover rather than a movement of money.
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
