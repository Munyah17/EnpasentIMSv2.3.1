import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Creates a system-access account (Super Admin, Admin, or Tech Support) —
 * the sibling of create-staff.ts, but for the System Access Roles page
 * instead of Staff Management (work roles). Requires the service-role key,
 * so this can't run in the browser.
 *
 * Authorization: the caller must already BE a super_admin — stricter than
 * create-staff.ts (which allows admin or super_admin), since only a Super
 * Admin may provision another system-tier account. The DB also enforces
 * this independently via trg_block_non_super_admin_system_role_changes.
 */

const SYSTEM_ROLES = ['super_admin', 'admin', 'tech_support'] as const

interface CreateSystemUserBody {
  name: string
  username?: string
  email: string
  password: string
  phone?: string
  role: string
  department: string
}

async function nextDefaultUsername(admin: ReturnType<typeof createClient>, role: string): Promise<string> {
  const group = role === 'super_admin' || role === 'admin' ? 'Admin' : 'Tech'
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

  let body: CreateSystemUserBody
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
  if (!SYSTEM_ROLES.includes(body.role as typeof SYSTEM_ROLES[number])) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid role for this endpoint — work roles are created on Staff Management.' }) }
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
    return { statusCode: 403, body: JSON.stringify({ error: 'Only a Super Admin can create system access accounts.' }) }
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
  // super_admin/admin get blanket-access sentinels (matching every other
  // system-tier account); tech_support starts with none, granted explicitly.
  const permissions = body.role === 'super_admin' ? ['all'] : body.role === 'admin' ? ['all_except_super'] : []
  const { error: usernameError } = await admin.from('profiles').update({ username, permissions }).eq('id', created.user.id)
  if (usernameError) {
    return { statusCode: 400, body: JSON.stringify({ error: usernameError.code === '23505' ? 'That username is already taken.' : usernameError.message }) }
  }

  const { data: profile } = await admin.from('profiles').select('*').eq('id', created.user.id).single()

  return { statusCode: 200, body: JSON.stringify({ success: true, profile: { ...profile, email: created.user.email } }) }
}
