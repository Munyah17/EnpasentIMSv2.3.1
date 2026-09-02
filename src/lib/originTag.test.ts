import { describe, it, expect } from 'vitest'
import { ORIGIN_TAG, taggedReference, isOwnReference } from './originTag'

describe('originTag', () => {
  it('opens a reference with this app’s tag', () => {
    expect(taggedReference('EMA2024001LK3J9X')).toBe('ENPA-EMA2024001LK3J9X')
  })

  /** A reference that got tagged twice would no longer match the row written
   *  against it at initiate time — reconciliation would look up
   *  "ENPA-ENPA-…" and find nothing, which is worse than having no tag. */
  it('does not tag a reference twice', () => {
    const once = taggedReference('EMA2024001LK3J9X')
    expect(taggedReference(once)).toBe(once)
    expect(taggedReference(taggedReference(once))).toBe(once)
  })

  it('recognises its own references and not another app’s', () => {
    expect(isOwnReference('ENPA-EMA2024001LK3J9X')).toBe(true)
    // The other apps collecting through the same Paynow account.
    expect(isOwnReference('MIMS-EMA2024001LK3J9X')).toBe(false)
    expect(isOwnReference('MWEB-CKO2026123456ABC')).toBe(false)
    // Untagged, from before this existed.
    expect(isOwnReference('EMA2024001LK3J9X')).toBe(false)
  })

  /** The tag has to survive a gateway intact and stay legible on a bank
   *  statement, where the narration is often truncated. */
  it('is short, uppercase and separator-free', () => {
    expect(ORIGIN_TAG).toMatch(/^[A-Z]{3,5}$/)
  })

  it('is distinct from the other apps on the same Paynow account', () => {
    expect(['MIMS', 'MWEB']).not.toContain(ORIGIN_TAG)
  })
})
