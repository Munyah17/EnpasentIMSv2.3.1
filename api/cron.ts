import type { VercelRequest, VercelResponse } from '@vercel/node'
import cronReminders from './_lib/cron-reminders.js'
import paynowReconcile from './_lib/paynow-reconcile.js'

/**
 * One function for both cron jobs run on this project.
 *
 * Same reason as api/ai.ts: Vercel builds every file under api/ into its
 * own Serverless Function, and the Hobby plan allows twelve per deployment.
 * The individual jobs live in api/_lib/ (an underscore directory is not
 * built as a function) and this dispatches to them. vercel.json rewrites
 * /api/cron-reminders and /api/paynow-reconcile here, so Vercel Cron's
 * configured paths (see vercel.json's "crons") keep working unchanged.
 */

const JOBS: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown> = {
  'cron-reminders': cronReminders,
  'paynow-reconcile': paynowReconcile,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const job = String(req.query.job ?? '')
  const run = JOBS[job]
  if (!run) {
    return res.status(404).json({ error: `Unknown cron job "${job}". Expected one of: ${Object.keys(JOBS).join(', ')}.` })
  }
  return run(req, res)
}
