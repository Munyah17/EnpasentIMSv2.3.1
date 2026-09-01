import type { Handler } from '@netlify/functions'

/**
 * Real AI lead scoring via Groq (llama-3.3-70b-versatile). Replaces the
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

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return { statusCode: 200, body: JSON.stringify({ score: 50, reasoning: 'AI scoring not configured (GROQ_API_KEY missing) — default score.' }) }
  }

  let body: ScoreLeadBody
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }
  if (!body.name || !body.source || !body.productInterest) {
    return { statusCode: 400, body: JSON.stringify({ error: 'name, source, and productInterest are required.' }) }
  }

  const prompt = `You are a lead-scoring assistant for a Zimbabwean micro-insurance agency. Score this sales lead's purchase intent from 0-100 based on the information given. Higher = more likely to convert to a paying policy soon.

Lead name: ${body.name}
Source: ${body.source}
Product interest: ${body.productInterest}
Notes: ${body.notes || '(none)'}

Respond with ONLY a JSON object, no markdown, no explanation outside the JSON: {"score": <integer 0-100>, "reasoning": "<one sentence, under 20 words>"}`

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 120,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { statusCode: 502, body: JSON.stringify({ error: `Groq API error (${res.status}): ${text}` }) }
    }
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) return { statusCode: 502, body: JSON.stringify({ error: 'Groq returned no content.' }) }

    const parsed = JSON.parse(content)
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 50)))
    return { statusCode: 200, body: JSON.stringify({ score, reasoning: String(parsed.reasoning || '').slice(0, 200) }) }
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: `Failed to score lead: ${e}` }) }
  }
}
