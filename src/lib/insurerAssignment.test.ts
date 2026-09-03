import { describe, it, expect } from 'vitest'
import type { InsurerRecord } from '../types'
import { resolveClientInsurer, defaultInsurerFirst, isDefaultInsurer, findDefaultInsurer } from './insurerAssignment'

function insurer(name: string): InsurerRecord {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    status: 'active',
    coverTypes: [],
    createdAt: '2026-01-01',
  }
}

const WITH_DEFAULT = [insurer('Motions'), insurer('CBZ'), insurer('Old Mutual')]
const WITHOUT_DEFAULT = [insurer('CBZ'), insurer('Old Mutual')]

describe('isDefaultInsurer', () => {
  it('matches the default insurer however it is spelled', () => {
    expect(isDefaultInsurer('Motions')).toBe(true)
    expect(isDefaultInsurer('Motions Microinsurance')).toBe(true)
    expect(isDefaultInsurer('motions')).toBe(true)
  })

  it('does not match anyone else, or nothing at all', () => {
    expect(isDefaultInsurer('Old Mutual')).toBe(false)
    expect(isDefaultInsurer('')).toBe(false)
    expect(isDefaultInsurer(undefined)).toBe(false)
  })
})

describe('defaultInsurerFirst', () => {
  it('pins the default insurer to the top and leaves the rest in order', () => {
    const ordered = defaultInsurerFirst([insurer('CBZ'), insurer('Motions'), insurer('Old Mutual')])
    expect(ordered.map(i => i.name)).toEqual(['Motions', 'CBZ', 'Old Mutual'])
  })

  it('is a no-op when the default insurer is absent', () => {
    expect(defaultInsurerFirst(WITHOUT_DEFAULT).map(i => i.name)).toEqual(['CBZ', 'Old Mutual'])
  })
})

describe('findDefaultInsurer', () => {
  it('returns the record so the stored name matches the real row', () => {
    expect(findDefaultInsurer(WITH_DEFAULT)?.name).toBe('Motions')
    expect(findDefaultInsurer(WITHOUT_DEFAULT)).toBeUndefined()
  })
})

describe('resolveClientInsurer', () => {
  it('keeps an explicit choice and does not mark it provisional', () => {
    expect(resolveClientInsurer('Old Mutual', WITH_DEFAULT))
      .toEqual({ insurer: 'Old Mutual', insurerProvisional: false })
  })

  it('treats explicitly choosing the default insurer as a real choice', () => {
    // The distinction that matters: picked Motions, not defaulted to Motions.
    expect(resolveClientInsurer('Motions', WITH_DEFAULT))
      .toEqual({ insurer: 'Motions', insurerProvisional: false })
  })

  it('defaults a blank selection to the default insurer, flagged provisional', () => {
    expect(resolveClientInsurer('', WITH_DEFAULT))
      .toEqual({ insurer: 'Motions', insurerProvisional: true })
  })

  it('uses the name as it is spelled on the record, not a hardcoded one', () => {
    const renamed = [insurer('Motions Microinsurance'), insurer('CBZ')]
    expect(resolveClientInsurer('', renamed))
      .toEqual({ insurer: 'Motions Microinsurance', insurerProvisional: true })
  })

  it('leaves the field empty rather than inventing an insurer that is not listed', () => {
    // Naming an insurer nobody can currently place business with would be
    // worse than an empty field, so a missing default record stays blank.
    expect(resolveClientInsurer('', WITHOUT_DEFAULT))
      .toEqual({ insurer: undefined, insurerProvisional: false })
  })

  it('never reports provisional without also naming the insurer', () => {
    for (const options of [WITH_DEFAULT, WITHOUT_DEFAULT, []]) {
      const r = resolveClientInsurer('', options)
      if (r.insurerProvisional) expect(r.insurer).toBeTruthy()
    }
  })
})
