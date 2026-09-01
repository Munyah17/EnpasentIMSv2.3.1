import { describe, it, expect } from 'vitest'
import type { Policy } from '../types'
import {
  holderMemberNumber, dependantMemberNumber, parseMemberNumber,
  policyMembers, findMember, searchMembers,
} from './memberNumbers'

const policy: Policy = {
  id: 'pol1',
  policyNumber: 'WEBFC12345678',
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
  dependants: [
    { name: 'Tendai Muwi', relationship: 'Spouse', dob: '1992-04-02', nationalId: '63111222A63', productName: 'Funeral Cash Plan', premium: 8, coverAmount: 5000 },
    { name: 'Rudo Muwi', relationship: 'Daughter', dob: '2015-09-14', nationalId: 'BR-99812' },
  ],
  paymentMethod: 'EcoCash',
  createdAt: '2026-01-01',
  nextPaymentDate: '2026-02-01',
}

describe('member numbers', () => {
  it('numbers the holder 00 and dependants from 01', () => {
    expect(holderMemberNumber('WEBFC12345678')).toBe('WEBFC12345678-00')
    expect(dependantMemberNumber('WEBFC12345678', 0)).toBe('WEBFC12345678-01')
    expect(dependantMemberNumber('WEBFC12345678', 1)).toBe('WEBFC12345678-02')
  })

  it('parses a member number back into policy and position', () => {
    expect(parseMemberNumber('WEBFC12345678-02')).toEqual({
      policyNumber: 'WEBFC12345678', position: 2, isHolder: false, dependantIndex: 1,
    })
  })

  it('treats a bare policy number as the policyholder', () => {
    expect(parseMemberNumber('webfc12345678')).toEqual({
      policyNumber: 'WEBFC12345678', position: 0, isHolder: true, dependantIndex: null,
    })
  })

  it('lists everyone on the policy, holder first', () => {
    const members = policyMembers(policy)
    expect(members.map(m => m.memberNumber)).toEqual([
      'WEBFC12345678-00', 'WEBFC12345678-01', 'WEBFC12345678-02',
    ])
    expect(members[0].role).toBe('holder')
    expect(members[1].name).toBe('Tendai Muwi')
  })

  it('falls back to the policy plan for a dependant with no plan of their own', () => {
    const rudo = policyMembers(policy)[2]
    expect(rudo.planName).toBe('Funeral Cash Plan')
    expect(rudo.coverAmount).toBe(8000)
  })

  it('carries the policyholder with every dependant it returns', () => {
    const found = findMember([policy], 'WEBFC12345678-01')
    expect(found?.name).toBe('Tendai Muwi')
    expect(found?.holderName).toBe('Harold Muwi')
    expect(found?.policyNumber).toBe('WEBFC12345678')
  })

  it('finds nobody for a position the policy does not have', () => {
    expect(findMember([policy], 'WEBFC12345678-09')).toBeNull()
    expect(findMember([policy], 'NOSUCH-01')).toBeNull()
  })

  it('searches dependants by name, ID or member number', () => {
    expect(searchMembers([policy], 'rudo').map(m => m.memberNumber)).toEqual(['WEBFC12345678-02'])
    expect(searchMembers([policy], '63111222A63').map(m => m.name)).toEqual(['Tendai Muwi'])
    expect(searchMembers([policy], '12345678-01').map(m => m.name)).toEqual(['Tendai Muwi'])
  })

  it('searching the policy number returns the whole household', () => {
    expect(searchMembers([policy], 'WEBFC12345678')).toHaveLength(3)
  })
})
