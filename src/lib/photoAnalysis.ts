export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export interface PhotoAnalysisResult {
  visibleDateStamp?: string | null
  contentMatchesLabel?: boolean
  flagged?: boolean
  note?: string
  simulated?: boolean
}

/** Sends a photo to netlify/functions/analyze-assessment-photo.ts for an AI
 *  fraud-detection opinion. Best-effort — never throws; a failure just
 *  means no AI note, not a blocked assessment. */
export async function analyzePhotoForFraud(
  imageBase64: string, mediaType: string, label: string, claimDescription?: string,
): Promise<PhotoAnalysisResult> {
  try {
    const res = await fetch('/api/analyze-assessment-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mediaType, label, claimDescription }),
    })
    if (!res.ok) return { simulated: true }
    return await res.json()
  } catch {
    return { simulated: true }
  }
}
