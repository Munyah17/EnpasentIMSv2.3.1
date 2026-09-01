import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Creates a real Supabase Auth user + profiles row for a new staff member.
 * Requires the service-role key (server-side only — never sent to the
 * client), so this can't run in the browser. profiles.name/role/department
 * are populated by the existing `on_auth_user_created` DB trigger from
 * user_metadata; phone is set in a follow-up update since the trigger
 * doesn't set it.
 *
 * Authorization: the caller must send their own Supabase access token
 * (Authorization: Bearer <token>) and must already be an admin/super_admin
 * — this function has no other access control of its own, and the service
 * role key bypasses RLS entirely, so this check is the only thing standing
 * between this endpoint and anyone on the internet creating accounts.
 */

// Work roles only — super_admin/admin/tech_support are system access roles,
// created via create-system-user.ts (Super Admin only).
const STAFF_ROLES = ['claims_officer', 'policy_admin', 'finance', 'client_relations'] as const

interface CreateStaffBody {
  name: string
  username?: string
  email: string
  password: string
  phone?: string
  role: string
  department: string
  customRoleId?: string
  permissions?: string[]
}

/** Next free "Agent N" / "Admin N" default for a role's group, so a blank
 *  username field still gets something usable — matches the convention
 *  used to backfill existing accounts (see database/reset_default_usernames.sql). */
async function nextDefaultUsername(admin: ReturnType<typeof createClient>, role: string): Promise<string> {
  const group = role === 'super_admin' || role === 'admin' ? 'Admin'
    : role === 'policyholder' ? 'User'
    : 'Agent'
  const { data } = await admin
    .from('profiles')
    .select('username')
    .ilike('username', `${group} %`)
  const maxN = (data ?? []).reduce((max, row) => {
    const n = parseInt(String(row.username).slice(group.length + 1), 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return `${group} ${maxN + 1}`
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

  let body: CreateStaffBody
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  if (!body.name || !body.email || !body.password || !body.role || !body.department) {
    return { statusCode: 400, body: JSON.stringify({ error: 'name, email, password, role, and department are required.' }) }
  }
  if (body.password.length < 8) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Password must be at least 8 characters.' }) }
  }
  if (!STAFF_ROLES.includes(body.role as typeof STAFF_ROLES[number])) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid role for this endpoint — system access roles (Super Admin, Admin, Tech Support) are created on the System Access Roles page.' }) }
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
    return { statusCode: 403, body: JSON.stringify({ error: 'You do not have permission to create staff accounts.' }) }
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { name: body.name, role: body.role, department: body.department },
  })
  if (createError || !created.user) {
    return { statusCode: 400, body: JSON.stringify({ error: createError?.message ?? 'Failed to create user.' }) }
  }

  if (body.phone) {
    await admin.from('profiles').update({ phone: body.phone }).eq('id', created.user.id)
  }

  const username = body.username?.trim() || await nextDefaultUsername(admin, body.role)
  const extra: Record<string, unknown> = { username }
  if (body.customRoleId) extra.custom_role_id = body.customRoleId
  if (body.permissions) extra.permissions = body.permissions
  const { error: usernameError } = await admin.from('profiles').update(extra).eq('id', created.user.id)
  if (usernameError) {
    return { statusCode: 400, body: JSON.stringify({ error: usernameError.code === '23505' ? 'That username is already taken.' : usernameError.message }) }
  }

  const { data: profile } = await admin.from('profiles').select('*, custom_roles!profiles_custom_role_id_fkey(name)').eq('id', created.user.id).single()

  return { statusCode: 200, body: JSON.stringify({ success: true, profile: { ...profile, email: created.user.email } }) }
}
