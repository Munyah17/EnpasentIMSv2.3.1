import type { AssessmentPhoto } from '../types'
import { db, type PhotoHashMatch } from './db'

/** Checks every hashed photo in a just-submitted assessment against the
 *  photo_hashes index (excluding the record it belongs to), then records
 *  each one so future submissions can be checked against it in turn.
 *  Runs after the assessment/claim already exists — never blocks
 *  submission, only reports what it found. */
export async function checkAndRecordPhotoDuplicates(
  photos: AssessmentPhoto[],
  sourceType: 'claim' | 'policy',
  sourceId: string,
  reference: string,
): Promise<(PhotoHashMatch & { photoLabel: string })[]> {
  const found: (PhotoHashMatch & { photoLabel: string })[] = []
  for (const photo of photos) {
    if (!photo.phash) continue
    const matches = await db.photoHashes.findMatches(photo.phash, sourceId)
    for (const m of matches) found.push({ ...m, photoLabel: photo.label })
    void db.photoHashes.record({
      hash: photo.phash, sourceType, sourceId, reference, label: photo.label, photoPath: photo.path,
    })
  }
  return found
}
