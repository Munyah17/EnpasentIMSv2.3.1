import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { callGroq, extractJson } from './groq.js'

/**
 * Real AI fraud scoring via Groq — replaces the
 * hardcoded `Math.floor(Math.random() * 30)` that used to ship with every
 * submitted claim regardless of its actual content. Groq is the single AI
 * provider across the system, so lead scoring, claim fraud scoring and
 * assessment photo analysis all share one key.
 */

interface PreLossContext {
  subjectType: string
  cropType?: string
  cropPopulation?: string
  registrationNumber?: string
  vehicleMakeModel?: string
  existingDamage?: string
  recordedAt?: string
}

interface PostLossContext {
  descriptionOfLoss?: string
  farmerStatement?: string
  assessorComments?: string
  cropStage?: string
}

interface ScoreClaimBody {
  claimType: string
  amount: number
  coverAmount: number
  dateOfEvent: string
  policyStartDate: string
  dateSubmitted: string
  description: string
  priorClaimsOnPolicy: number
  /** Optional — only sent when this is a review-time re-analysis (see
   *  ReviewClaimModal's "Get AI Insights" action) rather than the original
   *  at-submission score. When present, the model is asked to specifically
   *  cross-check the claim against what was actually on file beforehand. */
  preLossAssessment?: PreLossContext
  postLossAssessment?: PostLossContext
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return res.status(200).json({ score: 20, signals: [] as string[], insights: [] as string[], reasoning: 'AI fraud scoring not configured (GROQ_API_KEY missing) — default low score.' })
  }

  const body: ScoreClaimBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  if (!body.claimType || body.amount == null || !body.dateOfEvent || !body.description) {
    return res.status(400).json({ error: 'claimType, amount, dateOfEvent, and description are required.' })
  }

  const daysPolicyToEvent = Math.round(
    (new Date(body.dateOfEvent).getTime() - new Date(body.policyStartDate).getTime()) / 86400000
  )
  const daysEventToSubmit = Math.round(
    (new Date(body.dateSubmitted).getTime() - new Date(body.dateOfEvent).getTime()) / 86400000
  )
  const pctOfCover = body.coverAmount > 0 ? Math.round((body.amount / body.coverAmount) * 100) : 0

  let preLossBlock = ''
  if (body.preLossAssessment) {
    const p = body.preLossAssessment
    preLossBlock = p.subjectType === 'vehicle'
      ? `\n\nA PRE-LOSS ASSESSMENT is on file for this policy, recorded ${p.recordedAt ?? 'previously'}, before this claim existed:\nRegistration: ${p.registrationNumber || 'not recorded'}\nVehicle: ${p.vehicleMakeModel || 'not recorded'}\nExisting damage noted at the time: ${p.existingDamage || 'none noted'}\nCheck specifically whether the claim's described damage plausibly happened AFTER this baseline, or whether it looks like pre-existing damage being claimed as new.`
      : `\n\nA PRE-LOSS ASSESSMENT is on file for this policy, recorded ${p.recordedAt ?? 'previously'}, before this claim existed:\nCrop recorded as planted: ${p.cropType || 'not recorded'}\nCrop population: ${p.cropPopulation || 'not recorded'}\nCheck specifically whether the crop/loss described in this claim is consistent with what was actually recorded as planted.`
  } else if (body.claimType) {
    preLossBlock = '\n\nNo pre-loss assessment is on file for this policy — the crop/vehicle condition before this claim was never independently recorded, which is itself worth noting if this claim is for agriculture or vehicle damage.'
  }

  let postLossBlock = ''
  if (body.postLossAssessment) {
    const a = body.postLossAssessment
    const parts = [
      a.descriptionOfLoss && `Assessor's description of loss on site: "${a.descriptionOfLoss}"`,
      a.farmerStatement && `Farmer's own statement, as recorded by the assessor: "${a.farmerStatement}"`,
      a.assessorComments && `Assessor's comments: "${a.assessorComments}"`,
      a.cropStage && `Crop stage observed: ${a.cropStage}`,
    ].filter(Boolean)
    if (parts.length) postLossBlock = `\n\nA physical (post-loss) assessment has also been completed:\n${parts.join('\n')}\nCheck for consistency between the farmer's own statement and the assessor's independent observations — a mismatch between what the farmer says and what was actually found on site is a meaningful signal.`
  }

  // Org-defined red flags (Fraud Detection page -> Custom Fraud Signals,
  // Super Admin/Admin only) — patterns staff have actually seen in the
  // field that the model wouldn't otherwise know to look for. Best-effort:
  // scoring still runs on the built-in red flags alone if this lookup fails.
  let customRulesBlock = ''
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl && serviceKey) {
    try {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
      const { data: rules } = await admin.from('fraud_signal_rules').select('description').eq('status', 'active')
      if (rules && rules.length > 0) {
        customRulesBlock = `\n\nThis organisation has also flagged these specific patterns as known fraud risks based on past cases — check the claim against each one and name any that match in "signals", using close to the rule's own wording:\n${rules.map(r => `- ${r.description}`).join('\n')}`
      }
    } catch { /* best-effort — never block scoring on this lookup */ }
  }

  const prompt = `You are a fraud-detection assistant for a Zimbabwean micro-insurance agency reviewing a submitted claim. Score fraud risk from 0-100 (higher = more suspicious) based on known red flags: claims filed very soon after policy inception, amounts at or near the full cover limit, long delays between event and submission (or suspiciously immediate submission), vague or inconsistent descriptions, repeat claims on the same policy, and — when provided — inconsistency against pre-loss records or between the farmer's statement and the assessor's own findings.

Claim type: ${body.claimType}
Claim amount: $${body.amount} (${pctOfCover}% of the policy's $${body.coverAmount} cover limit)
Days between policy start and date of event: ${daysPolicyToEvent}
Days between event and submission: ${daysEventToSubmit}
Prior claims already filed on this policy: ${body.priorClaimsOnPolicy}
Description provided by claimant: "${body.description}"${preLossBlock}${postLossBlock}${customRulesBlock}

Respond with ONLY a JSON object, no markdown fences, no explanation outside the JSON: {"score": <integer 0-100>, "signals": [<0-4 short strings naming specific red flags actually present, empty array if none>], "insights": [<0-4 short, specific observations a human reviewer should weigh — e.g. a pre-loss mismatch, a farmer/assessor inconsistency, or "no concerns found" if genuinely clean; empty array only if no context was given to analyze>], "reasoning": "<one sentence, under 25 words>"}`

  try {
    const result = await callGroq(apiKey, [{ role: 'user', content: prompt }], { maxTokens: 600 })
    if (!result.ok) {
      return res.status(502).json({ error: `AI service error (${result.status}): ${result.error}` })
    }
    const parsed = extractJson<{ score?: unknown; signals?: unknown; insights?: unknown; reasoning?: unknown }>(result.content)
    if (!parsed) return res.status(502).json({ error: 'AI service returned no usable result.' })
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)))
    const signals = Array.isArray(parsed.signals) ? parsed.signals.map(String).slice(0, 4) : []
    const insights = Array.isArray(parsed.insights) ? parsed.insights.map(String).slice(0, 4) : []
    return res.status(200).json({ score, signals, insights, reasoning: String(parsed.reasoning || '').slice(0, 200) })
  } catch (e) {
    return res.status(502).json({ error: `Failed to score claim: ${e}` })
  }
}
