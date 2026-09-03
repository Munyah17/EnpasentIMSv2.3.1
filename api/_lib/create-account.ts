import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

/**
 * Creates a real Supabase Auth user + profiles row — merges what used to be
 * two separate functions (create-staff.ts for work roles, create-system-user.ts
 * for Super Admin/Admin/Tech Support) into one file so the Vercel Hobby
 * plan's 12-serverless-functions-per-deployment cap isn't exceeded. Which
 * path runs is decided by which role list `body.role` falls into — the two
 * lists are disjoint, so there's no ambiguity.
 *
 * Work roles (claims_officer, policy_admin, finance, client_relations,
 * agent): caller must be admin or super_admin, matching the old
 * create-staff.ts bar.
 *
 * System roles (super_admin, admin, tech_support): caller must be
 * super_admin, matching the old create-system-user.ts bar — only a Super
 * Admin may provision another system-tier account. The DB also enforces
 * this independently via trg_block_non_super_admin_system_role_changes.
 */

const STAFF_ROLES = ['claims_officer', 'policy_admin', 'finance', 'client_relations', 'agent'] as const
const SYSTEM_ROLES = ['super_admin', 'admin', 'tech_support'] as const

interface CreateAccountBody {
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

/** Next free "Agent N" / "Admin N" / "Tech N" default for a role's group, so
 *  a blank username field still gets something usable — matches the
 *  convention used to backfill existing accounts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextDefaultUsername(admin: any, role: string): Promise<string> {
  const group = role === 'super_admin' || role === 'admin' ? 'Admin'
    : role === 'tech_support' ? 'Tech'
    : role === 'policyholder' ? 'User'
    : 'Agent'
  const { data } = await admin
    .from('profiles')
    .select('username')
    .ilike('username', `${group} %`) as { data: { username: string }[] | null }
  const maxN = (data ?? []).reduce((max, row) => {
    const n = parseInt(String(row.username).slice(group.length + 1), 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return `${group} ${maxN + 1}`
}

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

  const body: CreateAccountBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})

  if (!body.name || !body.email || !body.password || !body.role || !body.department) {
    return res.status(400).json({ error: 'name, email, password, role, and department are required.' })
  }
  if (body.password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  }

  const isSystemRole = (SYSTEM_ROLES as readonly string[]).includes(body.role)
  const isStaffRole = (STAFF_ROLES as readonly string[]).includes(body.role)
  if (!isSystemRole && !isStaffRole) {
    return res.status(400).json({ error: 'Invalid role.' })
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
  if (profileError || !callerProfile || !callerProfile.active) {
    return res.status(403).json({ error: 'You do not have permission to create accounts.' })
  }
  if (isSystemRole && callerProfile.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a Super Admin can create system access accounts.' })
  }
  if (isStaffRole && !['admin', 'super_admin'].includes(callerProfile.role)) {
    return res.status(403).json({ error: 'You do not have permission to create staff accounts.' })
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { name: body.name, role: body.role, department: body.department },
  })
  if (createError || !created.user) {
    return res.status(400).json({ error: createError?.message ?? 'Failed to create user.' })
  }

  if (body.phone) {
    await admin.from('profiles').update({ phone: body.phone }).eq('id', created.user.id)
  }

  const username = body.username?.trim() || await nextDefaultUsername(admin, body.role)
  const extra: Record<string, unknown> = { username }
  if (isSystemRole) {
    // super_admin/admin get blanket-access sentinels (matching every other
    // system-tier account); tech_support starts with none, granted explicitly.
    extra.permissions = body.role === 'super_admin' ? ['all'] : body.role === 'admin' ? ['all_except_super'] : []
  } else {
    if (body.customRoleId) extra.custom_role_id = body.customRoleId
    if (body.permissions) extra.permissions = body.permissions
  }
  const { error: usernameError } = await admin.from('profiles').update(extra).eq('id', created.user.id)
  if (usernameError) {
    return res.status(400).json({ error: usernameError.code === '23505' ? 'That username is already taken.' : usernameError.message })
  }

  const { data: profile } = await admin.from('profiles').select('*, custom_roles!profiles_custom_role_id_fkey(name)').eq('id', created.user.id).single()

  return res.status(200).json({ success: true, profile: { ...profile, email: created.user.email } })
}
