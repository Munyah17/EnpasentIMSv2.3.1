/** Agriculture products are billed once per year (Stop Order), not
 *  monthly like every other category — anywhere a premium is shown next to
 *  its billing period, use these instead of a hardcoded "/mo". */
export function premiumPeriodLabel(category: string): '/yr' | '/mo' {
  return category === 'agriculture' ? '/yr' : '/mo'
}

export function formatPremium(premium: number, category: string): string {
  return `$${premium.toFixed(2)}${premiumPeriodLabel(category)}`
}

/**
 * Categories that cover named people, and therefore issue membership cards.
 *
 * A card identifies a person at a service desk — the funeral, hospital cash
 * and diaspora combo plans are held by a policyholder and their dependants,
 * and each of those people needs to be identifiable. The rest of the book
 * insures property: agriculture covers a crop and a barn, motor covers a
 * vehicle, property covers a building. There is nobody to hand a card to,
 * and issuing one would imply cover that follows a person when it does not.
 */
const MEMBER_CARD_CATEGORIES = ['funeral', 'life', 'health', 'accident']

export function categoryIssuesMemberCards(category?: string): boolean {
  return !!category && MEMBER_CARD_CATEGORIES.includes(category)
}
