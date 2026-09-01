import { describe, it, expect } from 'vitest'
import type { Policy } from '../types'
import { policyBillablePremium, billableHeadCount, premiumLines, formatBillablePremium } from './premium'

const base: Policy = {
  id: 'pol1',
  policyNumber: 'EMA2026001',
  clientId: 'c1',
  clientName: 'Harold Muwi',
  productId: 'prod-funeral',
  productName: 'Funeral Cash Plan',
  productCategory: 'funeral',
  premium: 12,
  coverAmount: 8000,
  startDate: '2026-01-01',
  endDate: '2027-01-01',
  status: 'active',
  dependants: [],
  paymentMethod: 'EcoCash',
  createdAt: '2026-01-01',
  nextPaymentDate: '2026-02-01',
}

describe('per-head premiums', () => {
  it('charges the policyholder alone when there are no dependants', () => {
    expect(policyBillablePremium(base)).toBe(12)
    expect(billableHeadCount(base)).toBe(1)
  })

  it('adds a premium for every dependant', () => {
    const policy: Policy = {
      ...base,
      dependants: [
        { name: 'Tendai', relationship: 'Spouse', dob: '1992-04-02', nationalId: 'A', premium: 12 },
        { name: 'Rudo', relationship: 'Daughter', dob: '2015-09-14', nationalId: 'B', premium: 8 },
      ],
    }
    expect(policyBillablePremium(policy)).toBe(32)
    expect(billableHeadCount(policy)).toBe(3)
  })

  it('puts a dependant with no plan of their own on the policyholder’s premium', () => {
    const policy: Policy = {
      ...base,
      dependants: [{ name: 'Rudo', relationship: 'Daughter', dob: '2015-09-14', nationalId: 'B' }],
    }
    expect(policyBillablePremium(policy)).toBe(24)
    expect(premiumLines(policy)[1].premium).toBe(12)
  })

  it('bills agriculture on the crop, not per head', () => {
    const policy: Policy = {
      ...base,
      productCategory: 'agriculture',
      productName: 'Tobacco Cover',
      premium: 400,
      dependants: [{ name: 'Farm hand', relationship: 'Worker', dob: '1990-01-01', nationalId: 'C', premium: 50 }],
    }
    expect(policyBillablePremium(policy)).toBe(400)
    expect(billableHeadCount(policy)).toBe(1)
  })

  it('says how many people a total covers', () => {
    const policy: Policy = {
      ...base,
      dependants: [{ name: 'Tendai', relationship: 'Spouse', dob: '1992-04-02', nationalId: 'A', premium: 12 }],
    }
    expect(formatBillablePremium(policy)).toBe('$24.00/mo (2 people)')
    expect(formatBillablePremium(base)).toBe('$12.00/mo')
  })
})
