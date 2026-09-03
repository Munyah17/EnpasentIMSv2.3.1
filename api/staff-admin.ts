import type { VercelRequest, VercelResponse } from '@vercel/node'
import createAccount from './_lib/create-account.js'
import createApiDeveloper from './_lib/create-api-developer.js'
import createApiKey from './_lib/create-api-key.js'
import deleteStaff from './_lib/delete-staff.js'
import resetStaffPassword from './_lib/reset-staff-password.js'

/**
 * One function for the five staff/account-management endpoints.
 *
 * Same reason as api/ai.ts and api/cron.ts: Vercel builds every file under
 * api/ into its own Serverless Function, and the Hobby plan allows twelve
 * per deployment. The individual handlers are unchanged, just moved into
 * api/_lib/ (an underscore directory is not built as a function).
 * vercel.json rewrites each original path here, so nothing that calls
 * /api/create-account, /api/delete-staff, etc. needs to change.
 */

const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown> = {
  'create-account': createAccount,
  'create-api-developer': createApiDeveloper,
  'create-api-key': createApiKey,
  'delete-staff': deleteStaff,
  'reset-staff-password': resetStaffPassword,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action ?? '')
  const route = ROUTES[action]
  if (!route) {
    return res.status(404).json({
      error: `Unknown staff-admin action "${action}". Expected one of: ${Object.keys(ROUTES).join(', ')}.`,
    })
  }
  return route(req, res)
}
