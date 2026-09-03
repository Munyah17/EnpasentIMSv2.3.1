import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

/**
 * Issues a new API key PAIR for an existing developer — a publishable key
 * (returned every time it's listed, safe to display/copy at any point) and
 * a secret key (returned exactly once in this response and never stored —
 * only its SHA-256 hash is kept, matched against on every /api/v1/*
 * request). Mirrors the pk_/sk_ pattern developers already expect.
 *
 * `environment` tags the key as sandbox or live for display/audit purposes.
 * Note: this is a first version — sandbox keys authenticate against the
 * same live database as live keys (there's no isolated test dataset yet),
 * so treat the sandbox/live split as a labelling and audit-trail feature
 * for now, not a guarantee that sandbox activity can't touch real records.
 *
 * Authorization: caller must be an authenticated admin/super_admin.
 */

const DEFAULT_SCOPES = ['products:read', 'quotes:read', 'clients:write', 'policies:write', 'policies:read', 'payments:write']

interface Body {
  developerId: string
  scopes?: string[]
  rateLimitPerMin?: number
  environment?: 'sandbox' | 'live'
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
  if (!token) return res.status(401).json({ error: 'Missing Authorization header.' })

  const body: Body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  if (!body.developerId) return res.status(400).json({ error: 'developerId is required.' })

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: { user: caller }, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller) return res.status(401).json({ error: 'Invalid or expired session.' })

  const { data: callerProfile } = await admin.from('profiles').select('role, active').eq('id', caller.id).single()
  if (!callerProfile || !callerProfile.active || !['admin', 'super_admin'].includes(callerProfile.role)) {
    return res.status(403).json({ error: 'You do not have permission to issue API keys.' })
  }

  const { data: developer } = await admin.from('api_developers').select('id').eq('id', body.developerId).maybeSingle()
  if (!developer) return res.status(404).json({ error: 'Developer not found.' })

  const environment: 'sandbox' | 'live' = body.environment === 'sandbox' ? 'sandbox' : 'live'
  const rawKey = `tqfy_sk_${environment}_${crypto.randomBytes(24).toString('hex')}`
  const publishableKey = `tqfy_pk_${environment}_${crypto.randomBytes(12).toString('hex')}`
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')
  const keyPrefix = rawKey.slice(0, 22)

  // support:write (submit a ticket, see api/v1/[...path].ts) is always
  // granted regardless of what's chosen — it's a developer's only path to
  // flag a problem at all, since the API has no update/delete endpoints.
  const chosenScopes = body.scopes?.length ? body.scopes : DEFAULT_SCOPES
  const scopes = chosenScopes.includes('support:write') ? chosenScopes : [...chosenScopes, 'support:write']

  const { data: keyRow, error } = await admin.from('api_keys').insert({
    developer_id: body.developerId,
    key_prefix: keyPrefix,
    key_hash: keyHash,
    publishable_key: publishableKey,
    environment,
    scopes,
    rate_limit_per_min: body.rateLimitPerMin && body.rateLimitPerMin > 0 ? body.rateLimitPerMin : 60,
    status: 'active',
  }).select('id, key_prefix, publishable_key, environment, scopes, rate_limit_per_min, status, created_at').single()

  if (error || !keyRow) return res.status(400).json({ error: error?.message ?? 'Failed to create key.' })

  return res.status(200).json({ success: true, key: { ...keyRow, rawKey } })
}
