import type { VercelRequest, VercelResponse } from '@vercel/node'
import analyzeAssessmentPhoto from './_lib/analyze-assessment-photo.js'
import scoreClaimFraud from './_lib/score-claim-fraud.js'
import scoreLead from './_lib/score-lead.js'
import searchLeads from './_lib/search-leads.js'

/**
 * One function for all four Groq-backed endpoints.
 *
 * Vercel builds every file under api/ into its own Serverless Function, and
 * the Hobby plan allows twelve per deployment. The project had reached
 * fourteen, so every deployment failed with
 * exceeded_serverless_functions_per_deployment and nothing reached
 * production at all.
 *
 * These four were the obvious candidates to merge: same provider, same
 * shape, same credentials. The individual handlers now live in api/_lib/
 * (an underscore directory is not built as a function) and this dispatches
 * to them. vercel.json rewrites the original paths here, so
 * /api/score-lead and the rest keep working exactly as before and no
 * client code changes.
 */

const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown> = {
  'analyze-assessment-photo': analyzeAssessmentPhoto,
  'score-claim-fraud': scoreClaimFraud,
  'score-lead': scoreLead,
  'search-leads': searchLeads,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // The rewrite supplies ?action=; a direct call to /api/ai must name one.
  const action = String(req.query.action ?? '')
  const route = ROUTES[action]
  if (!route) {
    return res.status(404).json({
      error: `Unknown AI action "${action}". Expected one of: ${Object.keys(ROUTES).join(', ')}.`,
    })
  }
  return route(req, res)
}
