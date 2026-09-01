import { describe, it, expect } from 'vitest'
import {
  PLANTS_PER_HECTARE, expectedLeavesForHectares, stringsFromBarnCapacity,
  leavesInBarn, assessLoss, calculateClaim,
} from './agricultureClaim'

describe('agricultureClaim', () => {
  it('assumes 15,000 plants to the hectare', () => {
    expect(PLANTS_PER_HECTARE).toBe(15_000)
  })

  it('scales the expected crop by the leaves counted at topping', () => {
    // 1 ha x 15,000 plants x 18 leaves counted = 270,000
    expect(expectedLeavesForHectares(1, 18)).toBe(270_000)
    // A different count gives a different expectation -- it is not fixed.
    expect(expectedLeavesForHectares(1, 20)).toBe(300_000)
    expect(expectedLeavesForHectares(2.5, 18)).toBe(675_000)
  })

  it('needs both hectares and a leaf count before it can expect anything', () => {
    expect(expectedLeavesForHectares(0, 18)).toBe(0)
    expect(expectedLeavesForHectares(1, 0)).toBe(0)
  })

  it('derives barn capacity in strings from hooks x tiers x bays', () => {
    expect(stringsFromBarnCapacity(240, 4, 3)).toBe(2_880)
    // Any missing dimension makes the capacity unknown, not zero-ish.
    expect(stringsFromBarnCapacity(240, 0, 3)).toBe(0)
  })

  it('counts barn contents as strings x leaves per string', () => {
    expect(leavesInBarn(500, 100)).toBe(50_000)
  })

  it('expresses loss as a percentage of the expected crop', () => {
    expect(assessLoss(27_000, 270_000).percentageLoss).toBeCloseTo(10, 6)
  })

  it('caps loss at 100% rather than reporting more than a total loss', () => {
    expect(assessLoss(400_000, 270_000).percentageLoss).toBe(100)
  })

  it('reports 0% when there is no expected crop, instead of dividing by zero', () => {
    const result = assessLoss(1_000, 0)
    expect(result.percentageLoss).toBe(0)
    expect(Number.isFinite(result.percentageLoss)).toBe(true)
  })

  it('deducts 10% handling and 15% excess from the gross loss', () => {
    const c = calculateClaim(10, 2_000)
    expect(c.grossLoss).toBe(200)
    expect(c.handlingExpenses).toBe(20)
    expect(c.excess).toBe(30)
    expect(c.claimPayable).toBe(150)
  })

  it('leaves 75% of the gross loss payable at any loss level', () => {
    for (const pct of [1, 12.5, 50, 100]) {
      const c = calculateClaim(pct, 4_000)
      expect(c.claimPayable).toBeCloseTo(c.grossLoss * 0.75, 2)
    }
  })

  it('never returns a negative payable amount', () => {
    expect(calculateClaim(0, 2_000).claimPayable).toBe(0)
    expect(calculateClaim(10, 0).claimPayable).toBe(0)
  })

  /** The full barn-fire chain, end to end, as the assessor works it. */
  it('works end to end for a barn fire', () => {
    // 1 ha, 18 leaves counted at topping.
    const expected = expectedLeavesForHectares(1, 18)
    expect(expected).toBe(270_000)

    // Barn measured at pre-loss: 150 hooks x 4 tiers x 3 bays.
    const strings = stringsFromBarnCapacity(150, 4, 3)
    expect(strings).toBe(1_800)

    // 30 leaves to a string.
    const inBarn = leavesInBarn(strings, 30)
    expect(inBarn).toBe(54_000)

    const loss = assessLoss(inBarn, expected)
    expect(loss.percentageLoss).toBeCloseTo(20, 6)

    const claim = calculateClaim(loss.percentageLoss, 3_000)
    expect(claim.grossLoss).toBe(600)
    expect(claim.handlingExpenses).toBe(60)
    expect(claim.excess).toBe(90)
    expect(claim.claimPayable).toBe(450)
  })
})
