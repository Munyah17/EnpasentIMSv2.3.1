import { describe, it, expect } from 'vitest'
import { stampJpegExif, exifDateString } from './exifWriter'
import { readExifSignals } from './exifDate'

/**
 * The in-app camera writes this metadata and lib/photoIntegrity.ts reads it
 * back to decide whether a photo can be submitted at all. If the two ever
 * stop agreeing, every photo shot through the Camera button is rejected as
 * having "no capture date" and no assessment can be saved — so the round
 * trip is pinned down here rather than left to be discovered on a farm.
 */

/** A structurally valid JPEG: SOI, a JFIF APP0 segment, then EOI. */
function bareJpeg(): Blob {
  const bytes = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xd9, // EOI
  ])
  return new Blob([bytes], { type: 'image/jpeg' })
}

const asFile = (blob: Blob) => new File([blob], 'capture.jpg', { type: 'image/jpeg' })

describe('exifWriter → exifDate round trip', () => {
  const taken = new Date(2026, 7, 19, 14, 32, 5)
  const stamp = { taken, make: 'Win32', model: 'back triple camera', software: 'Tariqify IMS Live Capture' }

  it('a stamped capture reads back with its capture time, camera and software', async () => {
    const stamped = await stampJpegExif(bareJpeg(), stamp)
    const signals = await readExifSignals(asFile(stamped))

    expect(signals.hasExif).toBe(true)
    expect(signals.dateTaken).toBe('2026-08-19T14:32:05')
    expect(signals.make).toBe('Win32')
    expect(signals.model).toBe('back triple camera')
    expect(signals.software).toBe('Tariqify IMS Live Capture')
  })

  it('an unstamped capture has no capture date, which is what blocks it', async () => {
    const signals = await readExifSignals(asFile(bareJpeg()))
    expect(signals.hasExif).toBe(false)
    expect(signals.dateTaken).toBeNull()
  })

  it('leaves a file that already carries Exif exactly as it arrived', async () => {
    const once = await stampJpegExif(bareJpeg(), stamp)
    const twice = await stampJpegExif(once, { ...stamp, make: 'Overwritten', taken: new Date(2020, 0, 1) })

    expect(twice.size).toBe(once.size)
    const signals = await readExifSignals(asFile(twice))
    expect(signals.make).toBe('Win32')
    expect(signals.dateTaken).toBe('2026-08-19T14:32:05')
  })

  it('does not touch anything that is not a JPEG', async () => {
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
    const out = await stampJpegExif(png, stamp)
    expect(out.size).toBe(png.size)
  })

  it('writes the Exif date in EXIF wall-clock form', () => {
    expect(exifDateString(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026:01:02 03:04:05')
  })
})
