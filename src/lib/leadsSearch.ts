export interface FoundLead {
  name: string
  phone?: string
  source: string
  productInterest: string
  intentScore: number
  notes: string
}

export interface LeadSearchResponse {
  leads: FoundLead[]
  searched?: string
  simulated?: boolean
  reason?: string
  aiUnavailable?: boolean
  error?: string
}

/** Calls netlify/functions/search-leads.ts. Never throws — a failure comes
 *  back as a normal response with `error` set, same as the rest of the
 *  app's AI-backed calls. */
export async function searchForLeads(query: string, location?: string): Promise<LeadSearchResponse> {
  try {
    const res = await fetch('/api/search-leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, location }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { leads: [], error: body?.error ?? `Search failed (HTTP ${res.status}).` }
    return { leads: [], ...body }
  } catch (e) {
    return { leads: [], error: `Could not reach the search service: ${e}` }
  }
}
