import type { InsurerRecord } from '../types'

/**
 * Which insurer a client is placed with, and what happens when nobody picks.
 *
 * Enpasent is a broker: it places business with almost every insurer in
 * Zimbabwe, so the insurer is a real choice and the field is deliberately
 * optional -- a signup must never be blocked because the question was not
 * answered yet.
 *
 * When it is left blank the client is provisionally placed with the default
 * insurer, Motions, so the record has somewhere to sit and staff have
 * something to work from. That assignment is PROVISIONAL and is recorded as
 * such. Two rules follow from that word, and both matter:
 *
 *  1. It applies to the client record only, never to a policy. Registering a
 *     client puts no cover in place (see notifyClientRegistered), so nothing
 *     about anyone's risk has been decided and there is nothing to disclose.
 *     A policy is different: the insurer on it is the party that pays the
 *     claim, so it stays whatever was explicitly chosen and is never
 *     back-filled from a provisional assignment.
 *  2. It is never presented as a choice the client made. Staff see the flag
 *     -- it is their queue of people still to be asked -- and it is stored
 *     honestly rather than being made to look deliberate.
 */

/** Matched loosely so renaming the record ("Motions Microinsurance") keeps working. */
export const DEFAULT_INSURER_MATCH = 'motions'

export function isDefaultInsurer(name: string | undefined | null): boolean {
  return !!name && name.toLowerCase().includes(DEFAULT_INSURER_MATCH)
}

/** The default insurer as it is actually spelled on the insurers table, so
 *  the stored value matches a real record rather than a hardcoded guess. */
export function findDefaultInsurer(list: InsurerRecord[]): InsurerRecord | undefined {
  return list.find(i => isDefaultInsurer(i.name))
}

/** Default insurer first, everything else left as it came (A-Z from the query). */
export function defaultInsurerFirst<T extends { name: string }>(list: T[]): T[] {
  return [...list.filter(i => isDefaultInsurer(i.name)), ...list.filter(i => !isDefaultInsurer(i.name))]
}

export interface ResolvedInsurer {
  insurer: string | undefined
  insurerProvisional: boolean
}

/**
 * Turns what the form had into what gets stored.
 *
 * A blank selection becomes the default insurer, flagged provisional. If the
 * default insurer is not among the active records it stays blank rather than
 * being invented -- writing the name of an insurer nobody can currently place
 * business with would be worse than an empty field.
 */
export function resolveClientInsurer(selected: string, options: InsurerRecord[]): ResolvedInsurer {
  if (selected) return { insurer: selected, insurerProvisional: false }

  const fallback = findDefaultInsurer(options)
  if (!fallback) return { insurer: undefined, insurerProvisional: false }
  return { insurer: fallback.name, insurerProvisional: true }
}
