import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

/**
 * Registers a new external API developer/partner. Creates a real (but
 * login-disabled — random password, never issued to anyone) Supabase Auth
 * identity + profiles row with role='api_partner', so policies.agent_id
 * can point at it and the developer's sales flow through the exact same
 * commission/reporting pipeline as a human agent's. The developer never
 * authenticates with this identity directly; they only ever use an API key
 * (issued separately via create-api-key.ts) against /api/v1/*.
 *
 * Authorization: caller must be an authenticated admin/super_admin — same
 * pattern as create-staff.ts.
 */

interface Body {
  companyName: string
  contactEmail: string
  contactPhone?: string
  termsAccepted: boolean
  termsVersion: string
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
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Missing Authorization header.' }) }

  let body: Body
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }
  if (!body.companyName?.trim() || !body.contactEmail?.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'companyName and contactEmail are required.' }) }
  }
  if (!body.termsAccepted || !body.termsVersion) {
    return { statusCode: 400, body: JSON.stringify({ error: 'The Developer API terms must be accepted to register.' }) }
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: { user: caller }, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session.' }) }

  const { data: callerProfile } = await admin.from('profiles').select('role, active').eq('id', caller.id).single()
  if (!callerProfile || !callerProfile.active || !['admin', 'super_admin'].includes(callerProfile.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'You do not have permission to register API developers.' }) }
  }

  const internalEmail = `api-partner-${crypto.randomUUID()}@partners.internal`
  const randomPassword = crypto.randomBytes(24).toString('hex')

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: internalEmail,
    password: randomPassword,
    email_confirm: true,
    user_metadata: { name: body.companyName.trim(), role: 'api_partner', department: 'API Partner' },
  })
  if (createError || !created.user) {
    return { statusCode: 400, body: JSON.stringify({ error: createError?.message ?? 'Failed to create partner identity.' }) }
  }

  const { data: developer, error: devError } = await admin.from('api_developers').insert({
    agent_profile_id: created.user.id,
    company_name: body.companyName.trim(),
    contact_email: body.contactEmail.trim(),
    contact_phone: body.contactPhone?.trim() || null,
    status: 'active',
    terms_accepted_at: new Date().toISOString(),
    terms_version: body.termsVersion,
  }).select('*').single()

  if (devError || !developer) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
    return { statusCode: 400, body: JSON.stringify({ error: devError?.message ?? 'Failed to register developer.' }) }
  }

  return { statusCode: 200, body: JSON.stringify({ success: true, developer }) }
}
