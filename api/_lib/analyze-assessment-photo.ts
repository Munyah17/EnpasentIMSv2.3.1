import type { VercelRequest, VercelResponse } from '@vercel/node'
import { GROQ_VISION_MODEL, extractJson } from './groq.js'

/**
 * Runs an assessment photo through Groq's vision model to help catch staged or
 * reused images — reads any visible burned-in date stamp, checks whether
 * the photo actually shows what it's labeled as (e.g. barn fire damage,
 * hail-damaged crop), and flags anything inconsistent. This is a second
 * opinion alongside the EXIF DateTimeOriginal check (src/lib/exifDate.ts)
 * done client-side — a photo can lack EXIF (screenshots, forwarded images)
 * or have a visible on-image stamp EXIF won't show, so both are used.
 *
 * Requires GROQ_API_KEY (server-side only). Without it, returns
 * { simulated: true } so the assessment flow can still be used — an AI
 * opinion is a fraud-detection aid, not a hard gate on submitting.
 */

interface Body {
  imageBase64: string
  mediaType: string
  label: string
  claimDescription?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return res.status(200).json({ simulated: true, reason: 'GROQ_API_KEY not configured' })
  }

  const body: Body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  if (!body.imageBase64 || !body.mediaType || !body.label) {
    return res.status(400).json({ error: 'imageBase64, mediaType, and label are required' })
  }

  const today = new Date().toISOString().split('T')[0]
  const prompt = `You are assisting an insurance assessor reviewing a photo submitted as evidence for an agriculture claim (label: "${body.label}"). Today's date is ${today}.${body.claimDescription ? ` Claim description: "${body.claimDescription}"` : ''}

Look at the image and answer, as strict JSON only (no markdown fences, no other text):
{
  "visibleDateStamp": string or null (a burned-in date/timestamp overlay printed on the photo by a camera app, if any — in YYYY-MM-DD format if found, else null),
  "contentMatchesLabel": boolean (does the image plausibly show what the label claims, e.g. barn fire damage, hail-damaged crop, wind-storm damage, flooded field, drought-affected crop, etc.),
  "flagged": boolean (true if anything raises fraud concern — the visible date stamp is more than 3 days before today, the image doesn't match the label, signs of screen-photography/reused stock imagery, or other inconsistency),
  "note": string (one or two sentences explaining your assessment, addressed to the assessor)
}`

  try {
    const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Vision-capable: this endpoint has to actually look at the photo,
        // not just reason about its label.
        model: GROQ_VISION_MODEL,
        max_tokens: 900,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${body.mediaType};base64,${body.imageBase64}` } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })
    if (!apiRes.ok) {
      const text = await apiRes.text()
      return res.status(502).json({ error: `AI service error (HTTP ${apiRes.status}): ${text}` })
    }
    const data = await apiRes.json()
    const text = data?.choices?.[0]?.message?.content ?? '{}'
    const parsed = extractJson<{ visibleDateStamp?: string | null; contentMatchesLabel?: boolean; flagged?: boolean; note?: string }>(text)
    // An unreadable answer must not block the assessment -- photo review is
    // a second opinion alongside the EXIF checks, not a gate on submitting.
    if (!parsed) return res.status(200).json({ simulated: true, reason: 'AI review returned no usable result.' })
    return res.status(200).json(parsed)
  } catch (e) {
    return res.status(502).json({ error: `Could not reach AI service: ${e}` })
  }
}
