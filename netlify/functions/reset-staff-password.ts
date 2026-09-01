import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Sets a new password for an existing staff member. The Staff management
 * modal only ever showed "Not editable here" for this field with no actual
 * way to act on it — this is what should happen when an admin clicks
 * Reset Password instead of routing them through the target staff member's
 * own Profile > Change Password flow (which needs the target's CURRENT
 * password to reauthenticate, so it's useless for an admin helping someone
 * who's locked out).
 *
 * Authorization: caller must be an authenticated, active admin/super_admin
 * — same bar as create-staff.ts. Resetting a super_admin's password is
 * blocked (those accounts are managed out of band, same restriction as
 * delete-staff.ts).
 */

interface Body {
  staffId: string
  newPassword: string
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing Supabase service credentials).' }) }
  }

  const authHeader = event.headers.authorization ?? event.headers.Authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing Authorization header.' }) }
  }

  let body: Body
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }
  if (!body.staffId || !body.newPassword) {
    return { statusCode: 400, body: JSON.stringify({ error: 'staffId and newPassword are required.' }) }
  }
  if (body.newPassword.length < 8) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Password must be at least 8 characters.' }) }
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: { user: caller }, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session.' }) }
  }

  const { data: callerProfile, error: profileError } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', caller.id)
    .single()
  if (profileError || !callerProfile || !callerProfile.active || !['admin', 'super_admin'].includes(callerProfile.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'You do not have permission to reset staff passwords.' }) }
  }

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', body.staffId)
    .maybeSingle()
  if (targetError || !target) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Staff member not found.' }) }
  }
  if (target.role === 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Super Admin passwords cannot be reset from here.' }) }
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(body.staffId, { password: body.newPassword })
  if (updateError) {
    return { statusCode: 400, body: JSON.stringify({ error: updateError.message }) }
  }

  return { statusCode: 200, body: JSON.stringify({ success: true }) }
}
