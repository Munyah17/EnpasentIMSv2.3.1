/** Groq-backed AI scoring, called via Netlify functions so the API key never reaches the browser. */

export async function scoreLead(input: { name: string; source: string; productInterest: string; notes?: string }): Promise<{ score: number; reasoning: string }> {
  try {
    const res = await fetch('/api/score-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) return { score: 50, reasoning: 'AI scoring unavailable, default score used.' }
    return await res.json()
  } catch {
    return { score: 50, reasoning: 'AI scoring unavailable, default score used.' }
  }
}

export interface PreLossAiContext {
  subjectType: string
  cropType?: string
  cropPopulation?: string
  registrationNumber?: string
  vehicleMakeModel?: string
  existingDamage?: string
  recordedAt?: string
}

export interface PostLossAiContext {
  descriptionOfLoss?: string
  farmerStatement?: string
  assessorComments?: string
  cropStage?: string
}

/**
 * The outcome of asking the model to score a claim.
 *
 * `unavailable` exists because this used to answer a failed call with a
 * hardcoded score of 20 and the note "default score used". The review
 * screen then rendered "AI Fraud Score: 20%" and "No specific concerns
 * identified" directly beneath the claim's real stored score — so a claim
 * flagged at 95% HIGH RISK appeared to have been cleared by the AI. A score
 * we do not have must not be presented as a low one.
 */
export type ClaimFraudResult =
  | { unavailable: false; score: number; signals: string[]; insights: string[]; reasoning: string }
  | { unavailable: true; score: null; signals: never[]; insights: never[]; reasoning: string }

const UNAVAILABLE: ClaimFraudResult = {
  unavailable: true,
  score: null,
  signals: [],
  insights: [],
  reasoning: 'AI fraud scoring is unavailable right now, so no AI score was produced. The claim keeps the score it already has.',
}

export async function scoreClaimFraud(input: {
  claimType: string; amount: number; coverAmount: number; dateOfEvent: string
  policyStartDate: string; dateSubmitted: string; description: string; priorClaimsOnPolicy: number
  preLossAssessment?: PreLossAiContext
  postLossAssessment?: PostLossAiContext
}): Promise<ClaimFraudResult> {
  try {
    const res = await fetch('/api/score-claim-fraud', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) return UNAVAILABLE
    const body = await res.json()
    // A response with no score is the service answering without having
    // scored anything; treat it as unavailable rather than reading the
    // absence as a low score.
    if (typeof body.score !== 'number') return UNAVAILABLE
    return {
      unavailable: false,
      score: body.score,
      signals: body.signals ?? [],
      insights: body.insights ?? [],
      reasoning: body.reasoning ?? '',
    }
  } catch {
    return UNAVAILABLE
  }
}
