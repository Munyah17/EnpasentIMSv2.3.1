/**
 * MNO API Endpoint Handlers
 *
 * These implement the business logic for each endpoint.
 * In production: deployed as Supabase Edge Functions or an Express server.
 * Here: called directly from the UI simulation layer.
 */
import type {
  CustomerSyncPayload, PaymentNotificationPayload,
  ClaimInitiationPayload, ApiGatewayResponse,
} from '../../types/mno'
import { localStore } from '../localStore'
import { mnoStore } from './mnoStore'
import { runGatewayAuth, okResponse, errResponse, logApiRequest, genRequestId } from './gateway'
import { emitEvent } from './webhooks'

function uid() { return `loc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }
function shortDate(s?: string) { return (s ?? new Date().toISOString()).split('T')[0] }

// ── 📥 INBOUND: POST /api/v1/mno/customers/sync ──────────────────────
export async function handleCustomerSync(
  keyPrefix: string,
  ip: string,
  payload: CustomerSyncPayload,
): Promise<ApiGatewayResponse> {
  const start = Date.now()
  const auth = runGatewayAuth(keyPrefix, ip, 'customers:write')
  if (!auth.ok) return auth.response

  const { ctx } = auth

  if (!payload.msisdn || !payload.fullName || !payload.nationalId) {
    return errResponse('INVALID_DATA', 'msisdn, fullName, nationalId are required', ctx.requestId)
  }

  const clients = localStore.clients.list()
  const existing = clients.find(c => c.nationalId === payload.nationalId || c.phone === payload.msisdn)

  let clientId: string
  if (existing) {
    if (payload.action === 'update') {
      localStore.clients.update(existing.id, {
        name: payload.fullName,
        phone: payload.msisdn,
        email: payload.email ?? existing.email,
        address: payload.address ?? existing.address,
      })
    }
    clientId = existing.id
  } else {
    const newClient = localStore.clients.create({
      id: uid(),
      name: payload.fullName,
      email: payload.email ?? `${payload.msisdn.replace('+', '')}@mno.zw`,
      phone: payload.msisdn,
      nationalId: payload.nationalId,
      dob: payload.dob ?? '',
      address: payload.address ?? 'Zimbabwe',
      occupation: 'Unknown',
      createdAt: shortDate(),
      policyCount: 0,
      status: 'active',
    })
    clientId = newClient.id
    await emitEvent('customer.created', ctx.partnerId, { clientId, msisdn: payload.msisdn, name: payload.fullName })
  }

  logApiRequest({
    ts: Date.now(), method: 'POST', endpoint: '/api/v1/mno/customers/sync',
    direction: 'inbound', partnerId: ctx.partnerId, partnerName: ctx.apiKey.partnerName,
    statusCode: 200, duration: Date.now() - start, success: true,
    requestSize: JSON.stringify(payload).length, responseSize: 128, requestId: ctx.requestId,
    apiKeyPrefix: keyPrefix,
  })

  return okResponse({ clientId, action: existing ? 'updated' : 'created', msisdn: payload.msisdn }, ctx.requestId)
}

// ── 📥 INBOUND: POST /api/v1/mno/payments ───────────────────────────
export async function handlePaymentNotification(
  keyPrefix: string,
  ip: string,
  payload: PaymentNotificationPayload,
): Promise<ApiGatewayResponse> {
  const start = Date.now()
  const auth = runGatewayAuth(keyPrefix, ip, 'payments:write')
  if (!auth.ok) return auth.response
  const { ctx } = auth

  if (!payload.transactionRef || !payload.msisdn || !payload.amount) {
    return errResponse('INVALID_DATA', 'transactionRef, msisdn, amount are required', ctx.requestId)
  }

  // Idempotency: check for duplicate transaction ref
  const existing = mnoStore.extTxns.list().find(t => t.transactionRef === payload.transactionRef)
  if (existing) return okResponse({ idempotent: true, transactionId: existing.id, status: existing.status }, ctx.requestId)

  const policies = localStore.policies.list()
  const policy = payload.policyNumber ? policies.find(p => p.policyNumber === payload.policyNumber) : null

  const txn = mnoStore.extTxns.create({
    id: uid(),
    transactionRef: payload.transactionRef,
    partnerId: ctx.partnerId,
    partnerName: ctx.apiKey.partnerName,
    msisdn: payload.msisdn,
    amount: payload.amount,
    currency: payload.currency ?? 'USD',
    type: 'premium_payment',
    status: 'confirmed',
    policyId: policy?.id,
    policyNumber: policy?.policyNumber,
    ts: payload.timestamp ?? new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    channel: payload.channel ?? 'api',
  })

  if (policy) {
    localStore.payments.create({
      id: uid(), reference: payload.transactionRef,
      policyId: policy.id, policyNumber: policy.policyNumber,
      clientName: policy.clientName,
      amount: payload.amount, method: 'OneMoney',
      status: 'completed', date: shortDate(),
    })
    await emitEvent('payment.received', ctx.partnerId, { transactionRef: payload.transactionRef, amount: payload.amount, policyNumber: policy.policyNumber })
  }

  logApiRequest({
    ts: Date.now(), method: 'POST', endpoint: '/api/v1/mno/payments',
    direction: 'inbound', partnerId: ctx.partnerId, partnerName: ctx.apiKey.partnerName,
    statusCode: 200, duration: Date.now() - start, success: true,
    requestSize: JSON.stringify(payload).length, responseSize: 256, requestId: ctx.requestId,
    apiKeyPrefix: keyPrefix,
  })

  return okResponse({ transactionId: txn.id, status: 'confirmed', policyNumber: policy?.policyNumber ?? null }, ctx.requestId)
}

// ── 📥 INBOUND: POST /api/v1/mno/claims/initiate ────────────────────
export async function handleClaimInitiation(
  keyPrefix: string,
  ip: string,
  payload: ClaimInitiationPayload,
): Promise<ApiGatewayResponse> {
  const start = Date.now()
  const auth = runGatewayAuth(keyPrefix, ip, 'claims:write')
  if (!auth.ok) return auth.response
  const { ctx } = auth

  if (!payload.msisdn || !payload.policyNumber || !payload.claimType) {
    return errResponse('INVALID_DATA', 'msisdn, policyNumber, claimType are required', ctx.requestId)
  }

  const policy = localStore.policies.list().find(p => p.policyNumber === payload.policyNumber)
  if (!policy) return errResponse('POLICY_NOT_FOUND', `Policy ${payload.policyNumber} not found`, ctx.requestId)

  const claimNumber = `CLM${new Date().getFullYear()}${Math.floor(Math.random() * 900000 + 100000)}`
  const claim = localStore.claims.create({
    id: uid(),
    claimNumber,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    clientId: policy.clientId,
    clientName: policy.clientName,
    productName: policy.productName,
    claimType: payload.claimType,
    amount: payload.amount ?? 0,
    status: 'pending',
    stage: 'intake',
    agentId: policy.agentId,
    agentName: policy.agentName,
    dateOfEvent: payload.dateOfEvent,
    dateSubmitted: shortDate(),
    description: payload.description,
    fraudScore: Math.floor(Math.random() * 30),
    documents: [],
    notes: `Initiated via MNO USSD: ${ctx.apiKey.partnerName}`,
  })

  await emitEvent('claim.initiated', ctx.partnerId, { claimNumber, policyNumber: payload.policyNumber, msisdn: payload.msisdn })

  logApiRequest({
    ts: Date.now(), method: 'POST', endpoint: '/api/v1/mno/claims/initiate',
    direction: 'inbound', partnerId: ctx.partnerId, partnerName: ctx.apiKey.partnerName,
    statusCode: 200, duration: Date.now() - start, success: true,
    requestSize: JSON.stringify(payload).length, responseSize: 256, requestId: ctx.requestId,
    apiKeyPrefix: keyPrefix,
  })

  return okResponse({ claimId: claim.id, claimNumber, status: 'submitted', estimatedResolutionDays: 7 }, ctx.requestId)
}

// ── 📤 OUTBOUND: GET /api/v1/products ───────────────────────────────
export async function handleGetProducts(
  keyPrefix: string,
  ip: string,
): Promise<ApiGatewayResponse> {
  const auth = runGatewayAuth(keyPrefix, ip, 'products:read')
  if (!auth.ok) return auth.response
  const { ctx } = auth

  const products = localStore.products.list().filter(p => p.active).map(p => ({
    id: p.id,
    name: p.name,
    code: p.code,
    category: p.category,
    premium: p.premium,
    coverAmount: p.coverAmount,
    description: p.description,
    ussdEnabled: true,
    eligibility: { minAge: 18, maxAge: 65, requiresId: true },
  }))

  logApiRequest({
    ts: Date.now(), method: 'GET', endpoint: '/api/v1/products',
    direction: 'outbound', partnerId: ctx.partnerId, partnerName: ctx.apiKey.partnerName,
    statusCode: 200, duration: 45, success: true,
    requestSize: 0, responseSize: JSON.stringify(products).length, requestId: ctx.requestId,
    apiKeyPrefix: keyPrefix,
  })

  return okResponse({ products, count: products.length }, ctx.requestId)
}

// ── 📤 OUTBOUND: GET /api/v1/products/premiums ──────────────────────
export async function handleGetPremiums(
  keyPrefix: string,
  ip: string,
  msisdn?: string,
): Promise<ApiGatewayResponse> {
  const auth = runGatewayAuth(keyPrefix, ip, 'products:read')
  if (!auth.ok) return auth.response
  const { ctx } = auth

  const products = localStore.products.list().filter(p => p.active)
  const premiums = products.map(p => ({
    productId: p.id, code: p.code, name: p.name,
    monthlyPremium: p.premium,
    annualPremium: p.premium * 11,
    coverAmount: p.coverAmount,
    ussdCode: `*233*${products.indexOf(p) + 1}#`,
  }))

  return okResponse({ premiums, currency: 'USD', msisdn: msisdn ?? null }, ctx.requestId)
}

// ── 📥 INBOUND: GET /api/v1/policies/status?policyNumber=X ──────────
export async function handlePolicyStatus(
  keyPrefix: string,
  ip: string,
  policyNumber: string,
): Promise<ApiGatewayResponse> {
  const auth = runGatewayAuth(keyPrefix, ip, 'policies:read')
  if (!auth.ok) return auth.response
  const { ctx } = auth

  const policy = localStore.policies.list().find(p => p.policyNumber === policyNumber)
  if (!policy) return errResponse('NOT_FOUND', `Policy ${policyNumber} not found`, ctx.requestId)

  return okResponse({
    policyNumber: policy.policyNumber,
    status: policy.status,
    product: policy.productName,
    premium: policy.premium,
    nextPaymentDate: policy.nextPaymentDate,
    coverAmount: policy.coverAmount,
    endDate: policy.endDate,
  }, ctx.requestId)
}

// ── Simulate a random inbound MNO request (for demo/testing) ─────────
export async function simulateInboundRequest(partnerId: string): Promise<{
  endpoint: string
  response: ApiGatewayResponse
  duration: number
}> {
  const partners = mnoStore.partners.list()
  const partner = partners.find(p => p.id === partnerId) ?? partners[0]
  const keys = mnoStore.apiKeys.list().filter(k => k.partnerId === partner.id && k.status === 'active')
  if (!keys.length) return { endpoint: 'none', response: errResponse('NO_KEY', 'No active API key', genRequestId()), duration: 0 }

  const key = keys[0]
  const ip = partner.id === 'mno-001' ? '196.43.113.10' : '196.43.112.44'
  const start = Date.now()

  const roll = Math.random()
  if (roll < 0.35) {
    const payload: CustomerSyncPayload = {
      msisdn: `+26377${Math.floor(Math.random() * 9000000 + 1000000)}`,
      fullName: ['Tendai Moyo', 'Chipo Dube', 'Farai Mlambo', 'Rudo Chigumira'][Math.floor(Math.random() * 4)],
      nationalId: `${Math.floor(Math.random() * 90000000 + 10000000)}A${Math.floor(Math.random() * 90 + 10)}`,
      dob: '1990-05-15', action: 'create',
    }
    const res = await handleCustomerSync(key.keyPrefix, ip, payload)
    return { endpoint: 'POST /api/v1/mno/customers/sync', response: res, duration: Date.now() - start }
  } else if (roll < 0.65) {
    const policies = localStore.policies.list()
    const policy = policies[Math.floor(Math.random() * policies.length)]
    const payload: PaymentNotificationPayload = {
      transactionRef: `TXN${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      msisdn: `+26377${Math.floor(Math.random() * 9000000 + 1000000)}`,
      amount: policy?.premium ?? 5,
      currency: 'USD',
      policyNumber: policy?.policyNumber,
      timestamp: new Date().toISOString(),
      channel: 'ussd',
    }
    const res = await handlePaymentNotification(key.keyPrefix, ip, payload)
    return { endpoint: 'POST /api/v1/mno/payments', response: res, duration: Date.now() - start }
  } else {
    const res = await handleGetProducts(key.keyPrefix, ip)
    return { endpoint: 'GET /api/v1/products', response: res, duration: Date.now() - start }
  }
}
