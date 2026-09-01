/**
 * Tobacco claim assessment maths.
 *
 * Loss is always expressed as a proportion of the crop the grower should
 * have had, then converted to money against the sum insured. How the
 * numerator and denominator are counted differs by peril, which is why the
 * two are modelled separately rather than as one generic percentage box:
 *
 *  - Hail / windstorm damage the standing crop, so both sides are counted
 *    in the field: leaves damaged against total leaves at topping.
 *  - Barn fire destroys leaf already reaped and hung, so the loss is
 *    counted in the barn (strings x leaves per string) but still measured
 *    against the whole expected crop, since that is what was insured.
 *
 * Every figure here is derived, never typed in, so an assessor cannot
 * quietly move the payable amount.
 */

/**
 * Standard plant population, assumed rather than counted: 15,000 plants to
 * the hectare.
 */
export const PLANTS_PER_HECTARE = 15_000

/**
 * Typical leaves per plant at topping. Only ever a starting suggestion --
 * this figure is counted in the field for each assessment, because it is
 * what the whole expected-crop calculation scales from and it genuinely
 * varies by variety and season.
 */
export const TYPICAL_LEAVES_AT_TOPPING = 18

/** Deductions applied to the assessed loss to reach the payable amount. */
export const HANDLING_EXPENSE_RATE = 0.10
export const EXCESS_RATE = 0.15

/**
 * Total leaves the crop should yield: plant population x leaves counted at
 * topping, over the hectarage under crop.
 */
export function expectedLeavesForHectares(hectares: number, leavesAtTopping: number): number {
  if (!Number.isFinite(hectares) || hectares <= 0) return 0
  if (!Number.isFinite(leavesAtTopping) || leavesAtTopping <= 0) return 0
  return Math.round(hectares * PLANTS_PER_HECTARE * leavesAtTopping)
}

/**
 * A barn's capacity in strings: hooks x tiers x bays. Derived rather than
 * asked for, because the three parts are measured once at pre-loss and a
 * separately-typed string count could quietly disagree with them.
 */
export function stringsFromBarnCapacity(hooks: number, tiers: number, bays: number): number {
  const parts = [hooks, tiers, bays]
  if (parts.some(n => !Number.isFinite(n) || n <= 0)) return 0
  return Math.round(hooks * tiers * bays)
}

/** Leaves hanging in a barn: strings x leaves per string. */
export function leavesInBarn(strings: number, leavesPerString: number): number {
  if (!Number.isFinite(strings) || !Number.isFinite(leavesPerString)) return 0
  if (strings <= 0 || leavesPerString <= 0) return 0
  return Math.round(strings * leavesPerString)
}

export interface LossAssessment {
  /** Leaves lost, however they were counted for this peril. */
  leavesLost: number
  /** Leaves the grower should have had at topping. */
  leavesExpected: number
  /** Proportion of the crop lost, 0-100, capped at 100. */
  percentageLoss: number
}

/**
 * Damaged leaves over total leaves at topping. Used directly for hail and
 * windstorm, and for barn fire once the barn count is known -- the shape of
 * the calculation is identical, only the counting differs.
 */
export function assessLoss(leavesLost: number, leavesExpected: number): LossAssessment {
  const lost = Number.isFinite(leavesLost) && leavesLost > 0 ? leavesLost : 0
  const expected = Number.isFinite(leavesExpected) && leavesExpected > 0 ? leavesExpected : 0
  // No expected crop means there is nothing to express the loss against;
  // reporting 0% is the only honest answer, rather than dividing by zero.
  const raw = expected > 0 ? (lost / expected) * 100 : 0
  return { leavesLost: lost, leavesExpected: expected, percentageLoss: Math.min(100, Math.max(0, raw)) }
}

export interface ClaimCalculation {
  percentageLoss: number
  /** Monetary value of the loss: % loss applied to the sum insured. */
  grossLoss: number
  handlingExpenses: number
  excess: number
  /** What the grower is actually paid. */
  claimPayable: number
}

/**
 * Converts an assessed percentage loss into a payable amount.
 *
 * Handling expenses and excess are each taken as a percentage of the gross
 * loss, not compounded one after the other, so the two deductions are
 * independent and the arithmetic stays checkable by hand:
 *
 *   gross     = % loss x sum insured
 *   handling  = 10% of gross
 *   excess    = 15% of gross
 *   payable   = gross - handling - excess
 */
export function calculateClaim(percentageLoss: number, sumInsured: number): ClaimCalculation {
  const pct = Number.isFinite(percentageLoss) ? Math.min(100, Math.max(0, percentageLoss)) : 0
  const insured = Number.isFinite(sumInsured) && sumInsured > 0 ? sumInsured : 0

  const round2 = (n: number) => Math.round(n * 100) / 100
  const grossLoss = round2((pct / 100) * insured)
  const handlingExpenses = round2(grossLoss * HANDLING_EXPENSE_RATE)
  const excess = round2(grossLoss * EXCESS_RATE)
  const claimPayable = round2(Math.max(0, grossLoss - handlingExpenses - excess))

  return { percentageLoss: pct, grossLoss, handlingExpenses, excess, claimPayable }
}

/** Formats a percentage for display without implying false precision. */
export function formatPercent(pct: number): string {
  return `${(Math.round(pct * 100) / 100).toFixed(2)}%`
}

export function formatMoney(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
