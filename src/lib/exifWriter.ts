/**
 * Writes an Exif APP1 block into a JPEG that doesn't have one.
 *
 * A frame captured from the in-app camera is encoded by the browser's canvas
 * and arrives with no metadata at all — no capture date, no camera make or
 * model. That is exactly the signature lib/photoIntegrity.ts treats as
 * blocking ("no capture date in the file"), which is correct for a file the
 * user picked out of a gallery and wrong for one this app just shot itself.
 *
 * So the capture stamps what it actually knows: the instant the shutter was
 * pressed, and the camera the browser handed us. The photo then carries its
 * own evidence everywhere it goes — into Storage, into an export, into a
 * loss adjuster's hands — instead of only inside our database row.
 *
 * Deliberately minimal: five IFD0 tags and two Exif-IFD tags, matching the
 * subset lib/exifDate.ts reads back.
 */

const TAG_MAKE = 0x010f
const TAG_MODEL = 0x0110
const TAG_SOFTWARE = 0x0131
const TAG_DATE_TIME = 0x0132
const TAG_EXIF_IFD_POINTER = 0x8769
const TAG_DATE_TIME_ORIGINAL = 0x9003
const TAG_DATE_TIME_DIGITIZED = 0x9004

const TYPE_ASCII = 2
const TYPE_LONG = 4

export interface ExifStamp {
  /** When the shutter was pressed. */
  taken: Date
  /** Camera manufacturer — the browser only ever gives us a device label,
   *  so this is the platform rather than a sensor vendor. */
  make: string
  /** The camera's own label, e.g. "back triple camera". */
  model: string
  /** What wrote the file. Must never look like an image editor: see
   *  EDITOR_SOFTWARE in lib/photoIntegrity.ts. */
  software: string
}

/** Exif strings are plain ASCII and NUL-terminated; anything else is dropped
 *  rather than written as bytes a reader would mis-decode. */
function asciiBytes(value: string): Uint8Array {
  const clean = value.replace(/[^\x20-\x7e]/g, '').slice(0, 96)
  const out = new Uint8Array(clean.length + 1)
  for (let i = 0; i < clean.length; i++) out[i] = clean.charCodeAt(i)
  return out
}

/** Exif dates are local wall-clock time in "YYYY:MM:DD HH:MM:SS" form. */
export function exifDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

interface PendingEntry {
  tag: number
  type: number
  bytes: Uint8Array
}

function buildTiff(stamp: ExifStamp): Uint8Array {
  const dateStr = exifDateString(stamp.taken)

  // Both IFDs must list their tags in ascending order, which is the order
  // they are declared in here.
  const ifd0: PendingEntry[] = [
    { tag: TAG_MAKE, type: TYPE_ASCII, bytes: asciiBytes(stamp.make) },
    { tag: TAG_MODEL, type: TYPE_ASCII, bytes: asciiBytes(stamp.model) },
    { tag: TAG_SOFTWARE, type: TYPE_ASCII, bytes: asciiBytes(stamp.software) },
    { tag: TAG_DATE_TIME, type: TYPE_ASCII, bytes: asciiBytes(dateStr) },
  ]
  const exifIfd: PendingEntry[] = [
    { tag: TAG_DATE_TIME_ORIGINAL, type: TYPE_ASCII, bytes: asciiBytes(dateStr) },
    { tag: TAG_DATE_TIME_DIGITIZED, type: TYPE_ASCII, bytes: asciiBytes(dateStr) },
  ]

  const ifd0Count = ifd0.length + 1 // + the Exif IFD pointer
  const ifd0Start = 8
  const ifd0End = ifd0Start + 2 + ifd0Count * 12 + 4
  const ifd0DataSize = ifd0.reduce((n, e) => n + (e.bytes.length > 4 ? e.bytes.length : 0), 0)
  const exifIfdStart = ifd0End + ifd0DataSize
  const exifIfdEnd = exifIfdStart + 2 + exifIfd.length * 12 + 4
  const exifDataSize = exifIfd.reduce((n, e) => n + (e.bytes.length > 4 ? e.bytes.length : 0), 0)

  const buf = new ArrayBuffer(exifIfdEnd + exifDataSize)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)

  // TIFF header, little-endian, IFD0 immediately after it.
  view.setUint16(0, 0x4949)
  view.setUint16(2, 0x002a, true)
  view.setUint32(4, ifd0Start, true)

  /** Writes one directory and its overflow values, returning where the
   *  value area ended. */
  const writeIfd = (entries: PendingEntry[], ifdStart: number, dataStart: number, extra?: { tag: number; value: number }) => {
    const count = entries.length + (extra ? 1 : 0)
    view.setUint16(ifdStart, count, true)
    let entryOffset = ifdStart + 2
    let dataOffset = dataStart
    for (const e of entries) {
      view.setUint16(entryOffset, e.tag, true)
      view.setUint16(entryOffset + 2, e.type, true)
      view.setUint32(entryOffset + 4, e.bytes.length, true)
      if (e.bytes.length > 4) {
        view.setUint32(entryOffset + 8, dataOffset, true)
        bytes.set(e.bytes, dataOffset)
        dataOffset += e.bytes.length
      } else {
        bytes.set(e.bytes, entryOffset + 8)
      }
      entryOffset += 12
    }
    if (extra) {
      view.setUint16(entryOffset, extra.tag, true)
      view.setUint16(entryOffset + 2, TYPE_LONG, true)
      view.setUint32(entryOffset + 4, 1, true)
      view.setUint32(entryOffset + 8, extra.value, true)
      entryOffset += 12
    }
    view.setUint32(entryOffset, 0, true) // no next IFD
    return dataOffset
  }

  writeIfd(ifd0, ifd0Start, ifd0End, { tag: TAG_EXIF_IFD_POINTER, value: exifIfdStart })
  writeIfd(exifIfd, exifIfdStart, exifIfdEnd)

  return bytes
}

/** True when the JPEG already carries an Exif APP1 segment of its own —
 *  a real camera file, which must be left exactly as it arrived. */
function hasExifSegment(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  while (offset < bytes.length - 4) {
    const marker = view.getUint16(offset)
    if ((marker & 0xff00) !== 0xff00) return false
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) return true
    // Start of scan: image data from here on, no more metadata segments.
    if (marker === 0xffda) return false
    offset += 2 + view.getUint16(offset + 2)
  }
  return false
}

/**
 * Returns the JPEG with an Exif block describing this capture, or the
 * original bytes unchanged if it already has one (or isn't a JPEG at all).
 */
export async function stampJpegExif(blob: Blob, stamp: ExifStamp): Promise<Blob> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return blob
    if (hasExifSegment(bytes)) return blob

    const tiff = buildTiff(stamp)
    const app1Length = 2 + 6 + tiff.length // length field + "Exif\0\0" + TIFF
    if (app1Length > 0xffff) return blob

    const segment = new Uint8Array(2 + app1Length)
    segment[0] = 0xff
    segment[1] = 0xe1
    segment[2] = (app1Length >> 8) & 0xff
    segment[3] = app1Length & 0xff
    segment.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4) // "Exif\0\0"
    segment.set(tiff, 10)

    // Exif wants APP1 first, straight after the start-of-image marker.
    const out = new Uint8Array(bytes.length + segment.length)
    out.set(bytes.subarray(0, 2), 0)
    out.set(segment, 2)
    out.set(bytes.subarray(2), 2 + segment.length)
    return new Blob([out], { type: 'image/jpeg' })
  } catch {
    // A photo with no metadata is still better than no photo; the integrity
    // check will flag it and the assessor can re-shoot.
    return blob
  }
}
