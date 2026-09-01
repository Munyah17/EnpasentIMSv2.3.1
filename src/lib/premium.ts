import type { Dependant, Policy } from '../types'

/**
 * What a policy actually costs to run.
 *
 * Premiums are per head. Every dependant on a policy is a separately
 * covered person paying their own premium, so the amount invoiced is the
 * policyholder's premium PLUS one premium for each dependant — adding a
 * dependant raises the bill from that moment on.
 *
 * `policy.premium` is only ever the policyholder's own share (it comes
 * straight off the product), which is why billing must not read it
 * directly: a family of four was being invoiced for one person.
 *
 * Agriculture is the exception and always has been: the cover is on the
 * crop and the barn, not on a household, so it is billed once a year at the
 * policy premium regardless of who is listed.
 */

export function isPerHeadCategory(category?: string): boolean {
  return category !== 'agriculture'
}

/** A dependant on no plan of their own is covered on the policyholder's. */
export function dependantPremium(policy: Policy, dependant: Dependant): number {
  const own = dependant.premium
  return typeof own === 'number' && Number.isFinite(own) && own > 0 ? own : policy.premium
}

export interface PremiumLine {
  name: string
  role: 'holder' | 'dependant'
  planName: string
  premium: number
}

/** Every person being charged on this policy, and what each one costs. */
export function premiumLines(policy: Policy, category?: string): PremiumLine[] {
  const holder: PremiumLine = {
    name: policy.clientName,
    role: 'holder',
    planName: policy.productName,
    premium: policy.premium,
  }
  if (!isPerHeadCategory(category ?? policy.productCategory)) return [holder]
  return [
    holder,
    ...policy.dependants.map(d => ({
      name: d.name,
      role: 'dependant' as const,
      planName: d.productName ?? policy.productName,
      premium: dependantPremium(policy, d),
    })),
  ]
}

/**
 * The amount to invoice for one billing period — the figure every payment
 * prompt, reminder and receipt should be built from.
 */
export function policyBillablePremium(policy: Policy, category?: string): number {
  const total = premiumLines(policy, category).reduce((sum, line) => sum + line.premium, 0)
  return Math.round(total * 100) / 100
}

/** How many people this policy is charged for. */
export function billableHeadCount(policy: Policy, category?: string): number {
  return premiumLines(policy, category).length
}

/** e.g. "$36.00/mo (3 people)" — one phrasing everywhere a total is shown. */
export function formatBillablePremium(policy: Policy, category?: string): string {
  const cat = category ?? policy.productCategory
  const total = policyBillablePremium(policy, cat)
  const heads = billableHeadCount(policy, cat)
  const period = isPerHeadCategory(cat) ? '/mo' : '/yr'
  return heads > 1 ? `$${total.toFixed(2)}${period} (${heads} people)` : `$${total.toFixed(2)}${period}`
}
