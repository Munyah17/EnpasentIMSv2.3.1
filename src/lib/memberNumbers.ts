import type { Dependant, Policy } from '../types'

/**
 * Member numbers.
 *
 * A dependant has no policy number of their own — they are carried on
 * someone else's policy — which left no way to name one on a signature
 * line, a claim form, or a physical card. So every person on a policy gets
 * a member number: the policy number, a dash, and a two-digit position.
 *
 *   WEBFC12345678-00   the policyholder, always
 *   WEBFC12345678-01   first dependant
 *   WEBFC12345678-02   second dependant
 *
 * The suffix is the member's position on the policy, so it stays with them
 * for as long as they are on it. Removing a dependant renumbers the ones
 * after them — which is why a card is issued against the member number and
 * the holder's policy together, never the suffix alone.
 */

export const HOLDER_SUFFIX = '00'

/** Position -> suffix. 0 is the holder, 1..n are dependants in list order. */
export function memberSuffix(position: number): string {
  return String(Math.max(0, Math.trunc(position))).padStart(2, '0')
}

export function memberNumber(policyNumber: string, position: number): string {
  return `${policyNumber}-${memberSuffix(position)}`
}

export function holderMemberNumber(policyNumber: string): string {
  return memberNumber(policyNumber, 0)
}

/** `index` is the dependant's index in policy.dependants. */
export function dependantMemberNumber(policyNumber: string, index: number): string {
  return memberNumber(policyNumber, index + 1)
}

export interface ParsedMemberNumber {
  policyNumber: string
  position: number
  isHolder: boolean
  /** Index into policy.dependants, or null for the holder. */
  dependantIndex: number | null
}

/**
 * Splits a member number back into the policy and the position on it.
 *
 * A bare policy number parses as the holder, since that is what someone
 * means when they type one into a search box.
 */
export function parseMemberNumber(input: string): ParsedMemberNumber | null {
  const trimmed = input.trim().toUpperCase()
  if (!trimmed) return null

  const match = /^(.*?)-(\d{1,3})$/.exec(trimmed)
  if (!match) {
    return { policyNumber: trimmed, position: 0, isHolder: true, dependantIndex: null }
  }
  const [, policyNumber, digits] = match
  if (!policyNumber) return null
  const position = Number(digits)
  return {
    policyNumber,
    position,
    isHolder: position === 0,
    dependantIndex: position === 0 ? null : position - 1,
  }
}

export type MemberRole = 'holder' | 'dependant'

/** One person on a policy, as they appear on cards, forms and searches. */
export interface PolicyMember {
  memberNumber: string
  position: number
  role: MemberRole
  name: string
  relationship: string
  dob: string
  nationalId: string
  /** The plan this member is actually covered under. A dependant chooses
   *  their own within the policy's category; the holder is on the policy's. */
  planName: string
  premium: number
  coverAmount: number
  policyId: string
  policyNumber: string
  policyStatus: Policy['status']
  productCategory?: string
  /** Which insurer actually underwrites this cover -- Enpassent places
   *  business with almost every insurer in Zimbabwe, so a card must never
   *  assume it is any one of them by default. Undefined when the policy
   *  hasn't had an insurer chosen yet. */
  insurer?: string
  /** Who carries this member. A dependant is never shown or fetched on
   *  their own — they always arrive attached to their policyholder. */
  holderName: string
  holderClientId: string
}

function dependantMember(policy: Policy, dependant: Dependant, index: number): PolicyMember {
  return {
    memberNumber: dependantMemberNumber(policy.policyNumber, index),
    position: index + 1,
    role: 'dependant',
    name: dependant.name,
    relationship: dependant.relationship,
    dob: dependant.dob,
    nationalId: dependant.nationalId,
    planName: dependant.productName ?? policy.productName,
    premium: dependant.premium ?? policy.premium,
    coverAmount: dependant.coverAmount ?? policy.coverAmount,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    policyStatus: policy.status,
    productCategory: policy.productCategory,
    insurer: policy.insurer,
    holderName: policy.clientName,
    holderClientId: policy.clientId,
  }
}

export function holderMember(policy: Policy, holderDob = '', holderNationalId = ''): PolicyMember {
  return {
    memberNumber: holderMemberNumber(policy.policyNumber),
    position: 0,
    role: 'holder',
    name: policy.clientName,
    relationship: 'Policyholder',
    dob: holderDob,
    nationalId: holderNationalId,
    planName: policy.productName,
    premium: policy.premium,
    coverAmount: policy.coverAmount,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    policyStatus: policy.status,
    productCategory: policy.productCategory,
    insurer: policy.insurer,
    holderName: policy.clientName,
    holderClientId: policy.clientId,
  }
}

/** Everyone on one policy, holder first, in member-number order. */
export function policyMembers(policy: Policy, holderDob = '', holderNationalId = ''): PolicyMember[] {
  return [
    holderMember(policy, holderDob, holderNationalId),
    ...policy.dependants.map((d, i) => dependantMember(policy, d, i)),
  ]
}

/**
 * Finds one member by member number across a set of policies.
 *
 * Matching is on the policy AND the position together: a suffix on its own
 * belongs to no one, and a dependant only exists in the context of the
 * policy carrying them.
 */
export function findMember(policies: Policy[], input: string): PolicyMember | null {
  const parsed = parseMemberNumber(input)
  if (!parsed) return null
  const policy = policies.find(p => p.policyNumber.toUpperCase() === parsed.policyNumber)
  if (!policy) return null
  if (parsed.isHolder) return holderMember(policy)
  const dependant = policy.dependants[parsed.dependantIndex!]
  if (!dependant) return null
  return dependantMember(policy, dependant, parsed.dependantIndex!)
}

/**
 * Members matching a free-text query, each still carrying their
 * policyholder. Matches member number, name, national ID, or the holder's
 * name, so a dependant can be found by any of the things a person actually
 * knows at the counter.
 */
export function searchMembers(policies: Policy[], query: string, limit = 25): PolicyMember[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const results: PolicyMember[] = []
  for (const policy of policies) {
    for (const member of policyMembers(policy)) {
      const haystack = [member.memberNumber, member.name, member.nationalId, member.holderName, member.policyNumber]
        .filter(Boolean).map(v => v.toLowerCase())
      if (haystack.some(v => v.includes(q))) {
        results.push(member)
        if (results.length >= limit) return results
      }
    }
  }
  return results
}
