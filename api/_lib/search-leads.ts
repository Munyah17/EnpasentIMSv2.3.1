import type { VercelRequest, VercelResponse } from '@vercel/node'
import { GROQ_TEXT_MODEL, extractJson } from './groq.js'

/**
 * AI-powered lead search — run on demand from Leads & Marketing (the "Run
 * Leads Search" button), not on a schedule. There's no need to search for
 * new leads every minute/hour/day; staff trigger it whenever they actually
 * want a fresh batch.
 *
 * Two credentials, both server-side only:
 *   GOOGLE_SEARCH_API_KEY / GOOGLE_SEARCH_ENGINE_ID — Google Custom Search
 *     JSON API, does the actual finding (the model has no built-in web/social
 *     search — it can only reason over what's handed to it).
 *   GROQ_API_KEY — already configured; turns raw search results into
 *     structured, scored candidate leads.
 *
 * Without the Google credentials, returns { simulated: true } so the UI
 * can show a clear "not configured yet" state rather than fail silently.
 */

interface Body {
  /** e.g. "funeral cover small business owners Harare" */
  query: string
  /** Restricts results to Zimbabwe by default — overridable for testing. */
  location?: string
}

interface GoogleSearchResult {
  title: string
  link: string
  snippet: string
}

async function googleSearch(apiKey: string, engineId: string, query: string): Promise<GoogleSearchResult[]> {
  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('cx', engineId)
  url.searchParams.set('q', query)
  url.searchParams.set('num', '10')

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Google Custom Search error (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return ((data.items ?? []) as Array<{ title: string; link: string; snippet: string }>).map(item => ({
    title: item.title, link: item.link, snippet: item.snippet,
  }))
}

async function extractLeadsWithAI(apiKey: string, results: GoogleSearchResult[], query: string): Promise<Array<{
  name: string; phone?: string; source: string; productInterest: string; intentScore: number; notes: string
}>> {
  const resultsText = results.map((r, i) => `${i + 1}. ${r.title}\n${r.link}\n${r.snippet}`).join('\n\n')
  const prompt = `You are helping a Zimbabwean micro-insurance agency (Enpasent/Motions) find potential customers from web search results. The search was for: "${query}".

Search results:
${resultsText}

From these results, extract any plausible SPECIFIC leads — individuals or small businesses who could realistically be insurance prospects (NOT insurance companies, NOT news articles, NOT government sites, NOT irrelevant results). For each, guess a product interest that fits the search context and an intent score.

Respond with ONLY a JSON array, no markdown fences, no explanation, one entry per plausible lead (empty array if none found): [{"name": string, "phone": string or null (only if visible in the snippet, never invented), "source": string (the site/platform this came from, e.g. "Facebook", "Google"), "productInterest": string, "intentScore": integer 0-100, "notes": string (why this looks like a lead, one sentence)}]`

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_TEXT_MODEL,
      max_tokens: 1500,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`AI extraction error (${res.status}): ${await res.text()}`)
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content ?? '[]'
  try {
    const parsed = extractJson(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const googleKey = process.env.GOOGLE_SEARCH_API_KEY
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID
  if (!googleKey || !engineId) {
    return res.status(200).json({ simulated: true, reason: 'GOOGLE_SEARCH_API_KEY / GOOGLE_SEARCH_ENGINE_ID not configured yet.' })
  }

  const body: Body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  if (!body.query?.trim()) {
    return res.status(400).json({ error: 'query is required.' })
  }

  const location = body.location?.trim() || 'Zimbabwe'
  const fullQuery = `${body.query.trim()} ${location}`

  try {
    const results = await googleSearch(googleKey, engineId, fullQuery)
    if (results.length === 0) {
      return res.status(200).json({ leads: [], searched: fullQuery })
    }

    const groqKey = process.env.GROQ_API_KEY
    if (!groqKey) {
      return res.status(200).json({ leads: [], rawResults: results, searched: fullQuery, aiUnavailable: true })
    }

    const leads = await extractLeadsWithAI(groqKey, results, fullQuery)
    return res.status(200).json({ leads, searched: fullQuery })
  } catch (e) {
    return res.status(502).json({ error: `Lead search failed: ${e}` })
  }
}
