import { describe, it, expect } from 'vitest'
import type { InsurerRecord } from '../types'
import { resolveClientInsurer, houseInsurerFirst, isHouseInsurer, findHouseInsurer } from './insurerAssignment'

function insurer(name: string): InsurerRecord {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    status: 'active',
    coverTypes: [],
    createdAt: '2026-01-01',
  }
}

const WITH_HOUSE = [insurer('Motions'), insurer('CBZ'), insurer('Old Mutual')]
const WITHOUT_HOUSE = [insurer('CBZ'), insurer('Old Mutual')]

describe('isHouseInsurer', () => {
  it('matches the house insurer however it is spelled', () => {
    expect(isHouseInsurer('Motions')).toBe(true)
    expect(isHouseInsurer('Motions Microinsurance')).toBe(true)
    expect(isHouseInsurer('motions')).toBe(true)
  })

  it('does not match anyone else, or nothing at all', () => {
    expect(isHouseInsurer('Old Mutual')).toBe(false)
    expect(isHouseInsurer('')).toBe(false)
    expect(isHouseInsurer(undefined)).toBe(false)
  })
})

describe('houseInsurerFirst', () => {
  it('pins the house insurer to the top and leaves the rest in order', () => {
    const ordered = houseInsurerFirst([insurer('CBZ'), insurer('Motions'), insurer('Old Mutual')])
    expect(ordered.map(i => i.name)).toEqual(['Motions', 'CBZ', 'Old Mutual'])
  })

  it('is a no-op when the house insurer is absent', () => {
    expect(houseInsurerFirst(WITHOUT_HOUSE).map(i => i.name)).toEqual(['CBZ', 'Old Mutual'])
  })
})

describe('findHouseInsurer', () => {
  it('returns the record so the stored name matches the real row', () => {
    expect(findHouseInsurer(WITH_HOUSE)?.name).toBe('Motions')
    expect(findHouseInsurer(WITHOUT_HOUSE)).toBeUndefined()
  })
})

describe('resolveClientInsurer', () => {
  it('keeps an explicit choice and does not mark it provisional', () => {
    expect(resolveClientInsurer('Old Mutual', WITH_HOUSE))
      .toEqual({ insurer: 'Old Mutual', insurerProvisional: false })
  })

  it('treats explicitly choosing the house insurer as a real choice', () => {
    // The distinction that matters: picked Motions, not defaulted to Motions.
    expect(resolveClientInsurer('Motions', WITH_HOUSE))
      .toEqual({ insurer: 'Motions', insurerProvisional: false })
  })

  it('defaults a blank selection to the house insurer, flagged provisional', () => {
    expect(resolveClientInsurer('', WITH_HOUSE))
      .toEqual({ insurer: 'Motions', insurerProvisional: true })
  })

  it('uses the name as it is spelled on the record, not a hardcoded one', () => {
    const renamed = [insurer('Motions Microinsurance'), insurer('CBZ')]
    expect(resolveClientInsurer('', renamed))
      .toEqual({ insurer: 'Motions Microinsurance', insurerProvisional: true })
  })

  it('leaves the field empty rather than inventing an insurer that is not listed', () => {
    // Naming an insurer nobody can currently place business with would be
    // worse than an empty field, so a missing house record stays blank.
    expect(resolveClientInsurer('', WITHOUT_HOUSE))
      .toEqual({ insurer: undefined, insurerProvisional: false })
  })

  it('never reports provisional without also naming the insurer', () => {
    for (const options of [WITH_HOUSE, WITHOUT_HOUSE, []]) {
      const r = resolveClientInsurer('', options)
      if (r.insurerProvisional) expect(r.insurer).toBeTruthy()
    }
  })
})
