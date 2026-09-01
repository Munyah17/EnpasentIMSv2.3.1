import type { VercelRequest, VercelResponse } from '@vercel/node'
import { GROQ_TEXT_MODEL, extractJson } from './groq.js'

/**
 * Real AI lead scoring via Groq. Replaces the
 * hardcoded fake intentScore that used to ship with every "AI-discovered"
 * lead. Takes what a staff member actually knows about a lead and returns
 * a genuine 0-100 intent score plus one-line reasoning.
 */

interface ScoreLeadBody {
  name: string
  source: string
  productInterest: string
  notes?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return res.status(200).json({ score: 50, reasoning: 'AI scoring not configured (GROQ_API_KEY missing) — default score.' })
  }

  const body: ScoreLeadBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  if (!body.name || !body.source || !body.productInterest) {
    return res.status(400).json({ error: 'name, source, and productInterest are required.' })
  }

  const prompt = `You are a lead-scoring assistant for a Zimbabwean micro-insurance agency. Score this sales lead's purchase intent from 0-100 based on the information given. Higher = more likely to convert to a paying policy soon.

Lead name: ${body.name}
Source: ${body.source}
Product interest: ${body.productInterest}
Notes: ${body.notes || '(none)'}

Respond with ONLY a JSON object, no markdown, no explanation outside the JSON: {"score": <integer 0-100>, "reasoning": "<one sentence, under 20 words>"}`

  try {
    const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 300,
      }),
    })
    if (!apiRes.ok) {
      const text = await apiRes.text().catch(() => '')
      return res.status(502).json({ error: `Groq API error (${apiRes.status}): ${text}` })
    }
    const data = await apiRes.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) return res.status(502).json({ error: 'Groq returned no content.' })

    const parsed = extractJson<{ score?: unknown; reasoning?: unknown }>(content)
    if (!parsed) return res.status(502).json({ error: `Groq returned no usable result.` })
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 50)))
    return res.status(200).json({ score, reasoning: String(parsed.reasoning || '').slice(0, 200) })
  } catch (e) {
    return res.status(502).json({ error: `Failed to score lead: ${e}` })
  }
}
