/**
 * Perceptual hashing for duplicate/reused photo detection — a claim photo
 * that's actually a recycled shot from an earlier claim (possibly recompressed,
 * resized, or lightly cropped) won't match byte-for-byte, so a plain file
 * hash isn't enough. This uses a difference hash (dHash): shrink the image
 * to a tiny 9x8 greyscale grid and record, for each row, whether each pixel
 * is brighter than the one to its right — 64 bits total. Two images of the
 * same underlying photo produce hashes that differ in only a handful of
 * bits even after recompression/minor edits; two unrelated photos differ in
 * roughly half.
 */

const HASH_WIDTH = 9
const HASH_HEIGHT = 8

/** Computes a 64-bit dHash for an image file, returned as a 16-char hex string. */
export async function computePerceptualHash(file: File): Promise<string | null> {
  try {
    const bitmap = await loadBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = HASH_WIDTH
    canvas.height = HASH_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, HASH_WIDTH, HASH_HEIGHT)
    const { data } = ctx.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT)

    const gray: number[] = []
    for (let i = 0; i < data.length; i += 4) {
      gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    }

    let bits = ''
    for (let row = 0; row < HASH_HEIGHT; row++) {
      for (let col = 0; col < HASH_WIDTH - 1; col++) {
        const left = gray[row * HASH_WIDTH + col]
        const right = gray[row * HASH_WIDTH + col + 1]
        bits += left > right ? '1' : '0'
      }
    }

    // 64 bits → 16 hex chars
    let hex = ''
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
    }
    return hex
  } catch {
    return null // best-effort — a hash failure should never block an upload
  }
}

function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file)
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

/** Hamming distance between two same-length hex hash strings — number of
 *  differing bits. 0 = identical, 64 = completely different. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { distance += x & 1; x >>= 1 }
  }
  return distance
}

/** Empirically: ≤6 bits of 64 reliably catches recompressed/resized copies
 *  of the same photo while staying well clear of unrelated images (which
 *  land around 28-36 bits different). */
export const DUPLICATE_THRESHOLD = 6
