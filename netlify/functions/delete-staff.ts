import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Permanently deletes a staff member's Supabase Auth identity (which
 * cascades to their profiles row via ON DELETE CASCADE). Deleting only the
 * profiles row — the one thing an RLS policy alone could do from the
 * client — isn't enough: fetchProfile() in AuthContext falls back to the
 * still-valid JWT's user_metadata whenever the profiles read comes back
 * empty, so a profiles-only delete would leave the auth identity able to
 * log back in as an active, fully-permissioned "phantom" account. Going
 * through admin.auth.admin.deleteUser() here removes the identity itself,
 * so signInWithPassword fails outright afterwards.
 *
 * Authorization: caller must be an authenticated, active super_admin —
 * stricter than create-staff.ts's admin-or-super_admin, since this is
 * irreversible. Self-deletion and deleting another super_admin are both
 * blocked (super_admin accounts are managed out of band, same as
 * create-staff.ts refusing to ever create one).
 */

interface Body {
  staffId: string
}

/** Founder account — never deletable through this endpoint, full stop,
 *  regardless of role or any future refactor of the super_admin check below. */
const PROTECTED_EMAILS = ['hello@munya.co.zw']

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
  if (!body.staffId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'staffId is required.' }) }
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
  if (profileError || !callerProfile || !callerProfile.active || callerProfile.role !== 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only Super Admin accounts can delete staff members.' }) }
  }

  if (body.staffId === caller.id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'You cannot delete your own account.' }) }
  }

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('role, email')
    .eq('id', body.staffId)
    .maybeSingle()
  if (targetError || !target) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Staff member not found. Their record may have failed to load from the server — refresh the page and try again.' }) }
  }
  if (target.email && PROTECTED_EMAILS.includes(target.email.toLowerCase())) {
    return { statusCode: 403, body: JSON.stringify({ error: 'This account cannot be deleted.' }) }
  }
  if (target.role === 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Super Admin accounts cannot be deleted from here.' }) }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(body.staffId)
  if (deleteError) {
    return { statusCode: 400, body: JSON.stringify({ error: deleteError.message }) }
  }

  return { statusCode: 200, body: JSON.stringify({ success: true }) }
}
