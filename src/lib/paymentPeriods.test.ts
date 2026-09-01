import { describe, it, expect } from 'vitest'

/**
 * The rule that decides how much cover a payment buys.
 *
 * Kept under test because the original version — Math.max(1, Math.round(…))
 * — gave a full month of cover for ANY payment: fifty cents against a $12
 * premium, a zero, even a negative. Rounding also over-credited, so $18
 * against $12 bought two months. Both are money leaving the business for
 * nothing, and neither was visible on any screen.
 *
 * Mirrors applyCompletedPaymentToPolicy in lib/db.ts and recordPayment in
 * api/v1/[...path].ts, which must agree with each other.
 */
function periodsPaid(amountPaid: number, perPeriod: number): number {
  return perPeriod > 0 && amountPaid > 0 ? Math.floor(amountPaid / perPeriod) : 0
}

describe('how much cover a payment buys', () => {
  it('buys exactly one period for the exact premium', () => {
    expect(periodsPaid(12, 12)).toBe(1)
  })

  it('buys two periods for double the premium', () => {
    expect(periodsPaid(24, 12)).toBe(2)
  })

  it('buys nothing for a part payment', () => {
    expect(periodsPaid(0.5, 12)).toBe(0)
    expect(periodsPaid(4, 12)).toBe(0)
    expect(periodsPaid(11.99, 12)).toBe(0)
  })

  it('buys nothing for zero or a negative', () => {
    expect(periodsPaid(0, 12)).toBe(0)
    expect(periodsPaid(-5, 12)).toBe(0)
  })

  it('does not round a part period up into a free one', () => {
    // 1.5x the premium is one period plus a balance still owed, not two.
    expect(periodsPaid(18, 12)).toBe(1)
    expect(periodsPaid(23.99, 12)).toBe(1)
  })

  it('buys nothing when the premium is zero, rather than dividing by it', () => {
    expect(periodsPaid(50, 0)).toBe(0)
  })

  it('counts whole periods on a per-head premium', () => {
    // A family of three at $12 each is $36 a period.
    expect(periodsPaid(36, 36)).toBe(1)
    expect(periodsPaid(12, 36)).toBe(0)
    expect(periodsPaid(72, 36)).toBe(2)
  })
})
