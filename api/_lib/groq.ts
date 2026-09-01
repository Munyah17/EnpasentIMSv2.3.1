/**
 * Shared Groq access for the AI endpoints.
 *
 * Underscore-prefixed so Vercel treats it as a library rather than another
 * serverless function (the Hobby plan caps those at 12).
 *
 * Model choice is deliberate: this account exposes a small set of models,
 * and of those only gpt-oss-120b reliably returns clean JSON. Groq's strict
 * `response_format: json_object` mode rejects these models' output, and the
 * qwen model narrates its reasoning in <think> blocks, so we ask for JSON in
 * the prompt and extract it defensively instead.
 */

export const GROQ_TEXT_MODEL = 'openai/gpt-oss-120b'
/** The only model on this account that can actually see an image. It
 *  narrates its reasoning in <think> blocks, which extractJson strips. */
export const GROQ_VISION_MODEL = 'qwen/qwen3.6-27b'
export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

export interface GroqMessage {
  role: 'user'
  content: string | Array<Record<string, unknown>>
}

export async function callGroq(
  apiKey: string,
  messages: GroqMessage[],
  opts: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<{ ok: true; content: string } | { ok: false; status: number; error: string }> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model ?? GROQ_TEXT_MODEL,
      messages,
      max_tokens: opts.maxTokens ?? 500,
      temperature: opts.temperature ?? 0.2,
    }),
  })
  if (!res.ok) {
    return { ok: false, status: res.status, error: await res.text().catch(() => '') }
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, status: 502, error: 'Model returned no content.' }
  }
  return { ok: true, content }
}

/**
 * Pulls the first JSON value out of a model response. Tolerates markdown
 * fences and any prose the model wraps around it, so a stray sentence never
 * costs us the whole result. Returns null when there's nothing parseable.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  const text = raw
    // Reasoning models narrate before answering; that prose can contain
    // braces, so it has to go before we scan for the JSON.
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .replace(/```(?:json)?/gi, '')
    .trim()
  try {
    return JSON.parse(text) as T
  } catch { /* fall through to a scan */ }

  // Scan for the first balanced { } or [ ] block, respecting strings so a
  // brace inside a value doesn't end the scan early.
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const start = text.indexOf(open)
    if (start === -1) continue
    let depth = 0, inString = false, escaped = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === open) depth++
      else if (ch === close) {
        depth--
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)) as T } catch { break }
        }
      }
    }
  }
  return null
}
