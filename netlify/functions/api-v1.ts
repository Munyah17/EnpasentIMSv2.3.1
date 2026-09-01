import type { Handler } from '@netlify/functions'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

/**
 * Public Developer API (/api/v1/...). External developers integrate this
 * into their own apps to sell our insurance products, authenticated by an
 * API key issued from Developer API → New Developer in the app.
 *
 * Every key is tied to one api_developers row, which is itself backed by a
 * real (login-disabled) profiles row with role='api_partner'. Every policy
 * created through this API gets agent_id = that profile's id, so it flows
 * through the exact same commission/reporting pipeline as a human agent's
 * sales — no parallel accounting system to keep in sync.
 *
 * Isolation: every read/write is scoped server-side to the caller's own
 * agent_profile_id. A key can never see or touch another developer's
 * clients or policies — creating a client only ever reveals/reuses an
 * existing record if THIS developer already has a policy against it,
 * otherwise the write is rejected outright rather than silently attaching
 * to someone else's client. The product catalog only ever exposes the
 * fields a storefront actually needs (never commission_pct or internal
 * notes/documents).
 *
 * Deliberately create/read-only: there is no update or delete endpoint for
 * clients or policies. Developers have the exact same standing as an
 * on-the-ground agent, not more — a correction to sensitive data (wrong
 * DOB, wrong cover amount, etc.) goes through POST /api/v1/tickets, which
 * files a real support ticket for Super Admin to action, never a direct
 * write from the API caller.
 */

type Json = Record<string, unknown>

function json(status: number, body: Json) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) }
}

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function refNumber(prefix: string): string {
  return `${prefix}${new Date().getFullYear()}${Date.now().toString().slice(-6)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Postgres rejects a malformed UUID with a raw 22P02 error before RLS/lookup
 *  logic even runs — checking the shape up front turns that into a clean 400
 *  instead of a 500 that leaks the underlying DB error text to the caller. */
function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

async function logRequest(admin: SupabaseClient, keyId: string | null, endpoint: string, statusCode: number) {
  if (!keyId) return
  await admin.from('api_request_log').insert({ key_id: keyId, endpoint, status_code: statusCode })
}

function scopeFor(resource: string, method: string): string | null {
  if (resource === 'products' && method === 'GET') return 'products:read'
  if (resource === 'quotes' && method === 'POST') return 'quotes:read'
  if (resource === 'clients' && method === 'POST') return 'clients:write'
  if (resource === 'policies' && method === 'POST') return 'policies:write'
  if (resource === 'policies' && method === 'GET') return 'policies:read'
  if (resource === 'payments' && method === 'POST') return 'payments:write'
  // Always granted regardless of issued scopes (see create-api-key.ts) — a
  // developer must always be able to flag a problem even with a narrowly
  // scoped key, since this is their only path to a correction at all: the
  // API has no update/delete endpoints on purpose (see module doc comment).
  if (resource === 'tickets' && method === 'POST') return 'support:write'
  return null
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'Server is not configured.' })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  // Netlify may deliver either the rewritten function path
  // (/.netlify/functions/api-v1/products) or the original pretty path
  // (/api/v1/products) as event.path depending on how it was reached —
  // strip whichever prefix is actually present rather than assuming one.
  const path = event.path
    .replace(/^\/\.netlify\/functions\/api-v1\/?/, '')
    .replace(/^\/api\/v1\/?/, '')
    .replace(/^\/+|\/+$/g, '')
  const segments = path.split('/').filter(Boolean)
  const resource = segments[0] ?? ''
  const method = event.httpMethod

  const authHeader = event.headers.authorization ?? event.headers.Authorization
  const rawKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  if (!rawKey) return json(401, { error: 'Missing Authorization: Bearer <api key> header.' })

  const { data: keyRow } = await admin.from('api_keys').select('*').eq('key_hash', hashKey(rawKey)).eq('status', 'active').maybeSingle()
  if (!keyRow) return json(401, { error: 'Invalid or revoked API key.' })

  const { data: dev } = await admin.from('api_developers').select('*').eq('id', keyRow.developer_id).eq('status', 'active').maybeSingle()
  if (!dev) {
    await logRequest(admin, keyRow.id, path, 403)
    return json(403, { error: 'Developer account is suspended.' })
  }

  const since = new Date(Date.now() - 60000).toISOString()
  const { count } = await admin.from('api_request_log').select('*', { count: 'exact', head: true }).eq('key_id', keyRow.id).gte('ts', since)
  if ((count ?? 0) >= keyRow.rate_limit_per_min) {
    await logRequest(admin, keyRow.id, path, 429)
    return json(429, { error: `Rate limit of ${keyRow.rate_limit_per_min} requests/min exceeded.` })
  }

  const scopeNeeded = scopeFor(resource, method)
  if (!scopeNeeded) {
    await logRequest(admin, keyRow.id, path, 404)
    return json(404, { error: 'Unknown endpoint.' })
  }
  if (!(keyRow.scopes as string[]).includes(scopeNeeded)) {
    await logRequest(admin, keyRow.id, path, 403)
    return json(403, { error: `This API key does not have the '${scopeNeeded}' scope.` })
  }

  let body: Json = {}
  if (event.body) {
    try { body = JSON.parse(event.body) } catch {
      await logRequest(admin, keyRow.id, path, 400)
      return json(400, { error: 'Invalid JSON body.' })
    }
  }

  const agentId = dev.agent_profile_id as string
  let result: { status: number; body: Json }

  try {
    if (resource === 'products' && method === 'GET') {
      result = await listProducts(admin)
    } else if (resource === 'quotes' && method === 'POST') {
      result = await getQuote(admin, body)
    } else if (resource === 'clients' && method === 'POST') {
      result = await createClient_(admin, body, agentId)
    } else if (resource === 'policies' && method === 'POST') {
      result = await createPolicy(admin, body, agentId)
    } else if (resource === 'policies' && method === 'GET' && segments[1]) {
      result = await getPolicy(admin, segments[1], agentId)
    } else if (resource === 'payments' && method === 'POST') {
      result = await recordPayment(admin, body, agentId)
    } else if (resource === 'tickets' && method === 'POST') {
      result = await submitApiTicket(admin, body, agentId, dev.company_name as string)
    } else {
      result = { status: 404, body: { error: 'Unknown endpoint or missing path parameter.' } }
    }
  } catch (e) {
    // Never echo the raw exception back to an external caller — it can
    // carry Postgres schema/constraint details. Netlify's own function
    // logs still capture it for us to debug from.
    console.error('api-v1 handler error:', e)
    result = { status: 500, body: { error: 'Internal server error.' } }
  }

  await admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id)
  await logRequest(admin, keyRow.id, path, result.status)
  return json(result.status, result.body)
}

// ── Handlers ─────────────────────────────────────────────────────

async function listProducts(admin: SupabaseClient) {
  const { data, error } = await admin
    .from('products')
    .select('id, name, category, premium, cover_amount, waiting_period_days, min_age, max_age, features, description')
    .eq('active', true)
  if (error) return { status: 500, body: { error: error.message } }
  return {
    status: 200,
    body: {
      data: (data ?? []).map(p => ({
        id: p.id, name: p.name, category: p.category, premium: p.premium, coverAmount: p.cover_amount,
        waitingPeriodDays: p.waiting_period_days, minAge: p.min_age, maxAge: p.max_age,
        features: p.features, description: p.description,
      })),
    },
  }
}

async function getQuote(admin: SupabaseClient, body: Json) {
  const productId = body.productId as string | undefined
  if (!productId) return { status: 400, body: { error: 'productId is required.' } }
  if (!isUuid(productId)) return { status: 400, body: { error: 'productId must be a valid UUID.' } }
  const { data: product, error } = await admin
    .from('products').select('id, name, premium, cover_amount, waiting_period_days, min_age, max_age')
    .eq('id', productId).eq('active', true).maybeSingle()
  if (error) return { status: 500, body: { error: error.message } }
  if (!product) return { status: 404, body: { error: 'Product not found or inactive.' } }

  const age = body.age !== undefined && body.age !== null && Number.isFinite(Number(body.age)) ? Number(body.age) : undefined
  const eligible = age === undefined || (age >= product.min_age && age <= product.max_age)

  return {
    status: 200,
    body: {
      data: {
        productId: product.id, productName: product.name, eligible,
        reason: eligible ? undefined : `Age must be between ${product.min_age} and ${product.max_age}.`,
        premium: product.premium, coverAmount: product.cover_amount, waitingPeriodDays: product.waiting_period_days,
      },
    },
  }
}

async function createClient_(admin: SupabaseClient, body: Json, agentId: string) {
  const name = String(body.name ?? '').trim()
  const phone = String(body.phone ?? '').trim()
  const nationalId = String(body.nationalId ?? '').trim()
  if (!name || !phone || !nationalId) return { status: 400, body: { error: 'name, phone, and nationalId are required.' } }

  const { data, error } = await admin.from('clients').insert({
    name, phone, national_id: nationalId,
    email: body.email ? String(body.email) : null,
    dob: body.dob ? String(body.dob) : null,
    address: body.address ? String(body.address) : null,
    occupation: body.occupation ? String(body.occupation) : null,
    status: 'active',
  }).select('id').single()
  if (!error) return { status: 201, body: { data: { id: data.id, existing: false } } }
  if (error.code !== '23505') return { status: 400, body: { error: error.message } }

  // Already exists — only hand back the id (and let the caller treat it as
  // "their" client) if this developer already has a policy against them.
  // Otherwise this lookup would let any key harvest another developer's
  // client ids just by guessing national ID numbers.
  const { data: existingClient } = await admin.from('clients').select('id').eq('national_id', nationalId).maybeSingle()
  if (existingClient) {
    const { data: ownPolicy } = await admin.from('policies').select('id').eq('client_id', existingClient.id).eq('agent_id', agentId).limit(1).maybeSingle()
    if (ownPolicy) return { status: 200, body: { data: { id: existingClient.id, existing: true } } }
  }
  return {
    status: 409,
    body: { error: 'A client with that national ID already exists under a different agent. Submit a support ticket (POST /api/v1/tickets) if you believe this is an error.' },
  }
}

async function createPolicy(admin: SupabaseClient, body: Json, agentId: string) {
  const clientId = body.clientId as string | undefined
  const productId = body.productId as string | undefined
  const paymentMethod = String(body.paymentMethod ?? 'EcoCash')
  if (!clientId || !productId) return { status: 400, body: { error: 'clientId and productId are required.' } }
  if (!isUuid(clientId) || !isUuid(productId)) return { status: 400, body: { error: 'clientId and productId must be valid UUIDs.' } }

  const { data: client } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle()
  if (!client) return { status: 404, body: { error: 'Client not found.' } }

  // A client with no policies yet is fair game (this developer would be
  // the first); one with existing policies all belonging to other agents
  // is not — never let this key attribute a policy to itself for someone
  // else's client.
  const { data: existingPolicies } = await admin.from('policies').select('agent_id').eq('client_id', clientId)
  if (existingPolicies && existingPolicies.length > 0 && !existingPolicies.some(p => p.agent_id === agentId)) {
    return { status: 403, body: { error: 'This client is already associated with a different agent. Submit a support ticket (POST /api/v1/tickets) to request access.' } }
  }

  const { data: product } = await admin.from('products').select('id, premium, cover_amount').eq('id', productId).eq('active', true).maybeSingle()
  if (!product) return { status: 404, body: { error: 'Product not found or inactive.' } }

  const startDate = body.startDate ? new Date(String(body.startDate)) : new Date()
  if (Number.isNaN(startDate.getTime())) return { status: 400, body: { error: 'startDate is not a valid date.' } }
  const endDate = new Date(startDate)
  endDate.setFullYear(endDate.getFullYear() + 1)

  const dependants = Array.isArray(body.dependants) ? body.dependants : []

  const { data, error } = await admin.from('policies').insert({
    policy_number: refNumber('API'),
    client_id: clientId,
    product_id: productId,
    premium: product.premium,
    cover_amount: product.cover_amount,
    start_date: startDate.toISOString().split('T')[0],
    end_date: endDate.toISOString().split('T')[0],
    status: 'pending',
    dependants,
    payment_method: paymentMethod,
    agent_id: agentId,
  }).select('id, policy_number').single()
  if (error) return { status: 400, body: { error: error.message } }
  return { status: 201, body: { data: { id: data.id, policyNumber: data.policy_number, status: 'pending' } } }
}

async function getPolicy(admin: SupabaseClient, policyNumber: string, agentId: string) {
  const { data, error } = await admin
    .from('policies')
    .select('id, policy_number, premium, cover_amount, status, start_date, end_date')
    .eq('policy_number', policyNumber)
    .eq('agent_id', agentId)
    .maybeSingle()
  if (error) return { status: 500, body: { error: error.message } }
  if (!data) return { status: 404, body: { error: 'Policy not found.' } }
  return {
    status: 200,
    body: {
      data: {
        id: data.id, policyNumber: data.policy_number, premium: data.premium, coverAmount: data.cover_amount,
        status: data.status, startDate: data.start_date, endDate: data.end_date,
      },
    },
  }
}

async function recordPayment(admin: SupabaseClient, body: Json, agentId: string) {
  const policyNumber = String(body.policyNumber ?? '')
  const amount = Number(body.amount)
  if (!policyNumber || !Number.isFinite(amount) || amount <= 0) {
    return { status: 400, body: { error: 'policyNumber is required and amount must be a positive number.' } }
  }

  const { data: policy } = await admin.from('policies')
    .select('id, agent_id, status, product_id, premium, next_payment_date')
    .eq('policy_number', policyNumber).maybeSingle()
  if (!policy || policy.agent_id !== agentId) return { status: 404, body: { error: 'Policy not found.' } }

  // A 'pending' policy is still awaiting Admin approval (the API creates
  // policies as 'pending' specifically so a human reviews external-sourced
  // business before it's live) — a payment must never be the thing that
  // silently pushes it past that gate.
  if (policy.status === 'pending') {
    return { status: 409, body: { error: 'This policy is still pending approval and cannot accept payments yet.' } }
  }
  if (policy.status === 'cancelled' || policy.status === 'expired') {
    return { status: 409, body: { error: `This policy is ${policy.status} and cannot accept payments.` } }
  }

  const { data: paymentRow, error } = await admin.from('payments').insert({
    reference: refNumber('PAY'),
    policy_id: policy.id,
    amount,
    method: String(body.method ?? 'EcoCash'),
    status: 'completed',
  }).select('id, reference').single()
  if (error) return { status: 400, body: { error: error.message } }

  // Mirrors applyCompletedPaymentToPolicy in src/lib/db.ts, the same rule
  // staff-recorded payments follow: agriculture jumps straight to active on
  // its first payment (no waiting period); a lapsed policy reinstates to a
  // fresh waiting_period, not straight back to active; everything else
  // keeps its current status — the 90-day wait is lifted by the hourly
  // reminder-engine check, not by paying.
  const { data: product } = await admin.from('products').select('category').eq('id', policy.product_id).maybeSingle()
  const category = product?.category ?? ''
  let nextStatus = policy.status
  if (policy.status === 'lapsed') nextStatus = 'waiting_period'
  else if (category === 'agriculture' && policy.status === 'waiting_period') nextStatus = 'active'

  const today = new Date()
  const cycleMonths = category === 'agriculture' ? 12 : 1
  const base = policy.next_payment_date && new Date(policy.next_payment_date) > today ? new Date(policy.next_payment_date) : today
  const next = new Date(base)
  next.setMonth(next.getMonth() + cycleMonths)

  await admin.from('policies').update({
    status: nextStatus,
    last_payment_date: today.toISOString().split('T')[0],
    next_payment_date: next.toISOString().split('T')[0],
  }).eq('id', policy.id)

  return { status: 201, body: { data: { id: paymentRow.id, reference: paymentRow.reference, status: 'completed' } } }
}

/**
 * The API's only path for anything that isn't a straightforward create —
 * a wrong DOB, a wrong cover amount, a client who needs re-linking, etc.
 * Files a real ticket for staff to action rather than exposing any kind of
 * update/delete endpoint to external callers. clientId is required and
 * must belong to the calling developer, same as every other endpoint.
 */
async function submitApiTicket(admin: SupabaseClient, body: Json, agentId: string, companyName: string) {
  const subject = String(body.subject ?? '').trim()
  const description = String(body.description ?? '').trim()
  const clientId = body.clientId ? String(body.clientId) : ''
  if (!subject || !description || !clientId) {
    return { status: 400, body: { error: 'subject, description, and clientId are required.' } }
  }
  if (!isUuid(clientId)) return { status: 400, body: { error: 'clientId must be a valid UUID.' } }

  const { data: ownPolicy } = await admin.from('policies').select('id').eq('client_id', clientId).eq('agent_id', agentId).limit(1).maybeSingle()
  if (!ownPolicy) return { status: 403, body: { error: 'clientId is not associated with this API key.' } }

  const { data, error } = await admin.from('tickets').insert({
    ticket_number: refNumber('TKT'),
    client_id: clientId,
    subject: `[API Partner: ${companyName}] ${subject}`.slice(0, 200),
    description,
    status: 'open',
    priority: 'high',
    category: 'API Partner Request',
  }).select('id, ticket_number').single()
  if (error) return { status: 400, body: { error: error.message } }

  return { status: 201, body: { data: { id: data.id, ticketNumber: data.ticket_number, status: 'open' } } }
}
