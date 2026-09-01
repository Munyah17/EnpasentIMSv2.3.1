import type { VercelRequest, VercelResponse } from '@vercel/node'
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server is not configured (missing Supabase service credentials).' })
  }

  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header.' })
  }

  const body: Body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  if (!body.staffId) {
    return res.status(400).json({ error: 'staffId is required.' })
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: { user: caller }, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller) {
    return res.status(401).json({ error: 'Invalid or expired session.' })
  }

  const { data: callerProfile, error: profileError } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', caller.id)
    .single()
  if (profileError || !callerProfile || !callerProfile.active || callerProfile.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only Super Admin accounts can delete staff members.' })
  }

  if (body.staffId === caller.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' })
  }

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('role, email')
    .eq('id', body.staffId)
    .maybeSingle()
  if (targetError || !target) {
    return res.status(404).json({ error: 'Staff member not found. Their record may have failed to load from the server — refresh the page and try again.' })
  }
  if (target.email && PROTECTED_EMAILS.includes(target.email.toLowerCase())) {
    return res.status(403).json({ error: 'This account cannot be deleted.' })
  }
  if (target.role === 'super_admin') {
    return res.status(403).json({ error: 'Super Admin accounts cannot be deleted from here.' })
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(body.staffId)
  if (deleteError) {
    return res.status(400).json({ error: deleteError.message })
  }

  return res.status(200).json({ success: true })
}
