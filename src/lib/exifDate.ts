/**
 * Minimal EXIF DateTimeOriginal reader for JPEGs — just enough to answer
 * "when was this photo actually taken" for the assessment fraud check,
 * without pulling in a full EXIF library. Falls back to the top-level
 * DateTime tag if DateTimeOriginal isn't present. Returns null for
 * non-JPEG files or photos with no EXIF block (common for screenshots,
 * downloaded/forwarded images, or a camera with EXIF stripped).
 */

const TAG_DATE_TIME_ORIGINAL = 0x9003
const TAG_DATE_TIME = 0x0132
const TAG_EXIF_IFD_POINTER = 0x8769
const TAG_MAKE = 0x010F
const TAG_MODEL = 0x0110
const TAG_SOFTWARE = 0x0131

function readIfd(view: DataView, tiffStart: number, ifdOffset: number, little: boolean, wanted: number[]): Map<number, unknown> {
  const found = new Map<number, unknown>()
  const entryCount = view.getUint16(tiffStart + ifdOffset, little)
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = tiffStart + ifdOffset + 2 + i * 12
    const tag = view.getUint16(entryOffset, little)
    if (!wanted.includes(tag)) continue
    const type = view.getUint16(entryOffset + 2, little)
    // ASCII (type 2) and LONG (type 4) are all we need here.
    if (type === 2) {
      const count = view.getUint32(entryOffset + 4, little)
      const valueOffset = count <= 4 ? entryOffset + 8 : tiffStart + view.getUint32(entryOffset + 8, little)
      let str = ''
      for (let j = 0; j < count - 1; j++) str += String.fromCharCode(view.getUint8(valueOffset + j))
      found.set(tag, str)
    } else if (type === 4) {
      found.set(tag, view.getUint32(entryOffset + 8, little))
    }
  }
  return found
}

function parseExifDate(str: string): string | null {
  // EXIF dates look like "2026:08:10 14:32:00"
  const m = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(str)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`
}

/** What the file's own metadata says about how it came to exist. Every
 *  field is optional because stripped EXIF is itself the finding -- a
 *  screenshot, a WhatsApp forward, or a download arrives with nothing. */
export interface ExifSignals {
  /** DateTimeOriginal, or the top-level DateTime tag as a fallback. */
  dateTaken: string | null
  /** Camera manufacturer/model. Absent on anything not straight off a camera. */
  make: string | null
  model: string | null
  /** Editing software that last wrote the file, when it announces itself
   *  (Photoshop, GIMP, Snapseed and most editors do). */
  software: string | null
  /** False when the file carried no readable EXIF block at all. */
  hasExif: boolean
}

const NO_EXIF: ExifSignals = { dateTaken: null, make: null, model: null, software: null, hasExif: false }

export async function readExifSignals(file: File): Promise<ExifSignals> {
  if (!file.type.includes('jpeg') && !file.type.includes('jpg')) return { ...NO_EXIF }
  try {
    const buf = await file.slice(0, 128 * 1024).arrayBuffer()
    const view = new DataView(buf)
    if (view.getUint16(0) !== 0xFFD8) return { ...NO_EXIF } // not a JPEG

    let offset = 2
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset)
      if (marker === 0xFFE1) {
        const exifStart = offset + 4
        if (view.getUint32(exifStart) !== 0x45786966) { offset += 2 + view.getUint16(offset + 2); continue } // "Exif"
        const tiffStart = exifStart + 6
        const little = view.getUint16(tiffStart) === 0x4949
        const ifd0Offset = view.getUint32(tiffStart + 4, little)
        const ifd0 = readIfd(view, tiffStart, ifd0Offset, little, [
          TAG_DATE_TIME, TAG_EXIF_IFD_POINTER, TAG_MAKE, TAG_MODEL, TAG_SOFTWARE,
        ])

        const str = (tag: number) => {
          const v = ifd0.get(tag)
          return typeof v === 'string' && v.trim() ? v.trim() : null
        }

        let dateTaken: string | null = null
        const exifPointer = ifd0.get(TAG_EXIF_IFD_POINTER) as number | undefined
        if (exifPointer !== undefined) {
          const exifIfd = readIfd(view, tiffStart, exifPointer, little, [TAG_DATE_TIME_ORIGINAL])
          const original = exifIfd.get(TAG_DATE_TIME_ORIGINAL) as string | undefined
          if (original) dateTaken = parseExifDate(original)
        }
        if (!dateTaken) {
          const fallback = ifd0.get(TAG_DATE_TIME) as string | undefined
          dateTaken = fallback ? parseExifDate(fallback) : null
        }

        return { dateTaken, make: str(TAG_MAKE), model: str(TAG_MODEL), software: str(TAG_SOFTWARE), hasExif: true }
      }
      if ((marker & 0xFF00) !== 0xFF00) break
      offset += 2 + view.getUint16(offset + 2)
    }
    return { ...NO_EXIF }
  } catch {
    return { ...NO_EXIF }
  }
}

export async function readExifDateTaken(file: File): Promise<string | null> {
  return (await readExifSignals(file)).dateTaken
}
