import type {
  MnoPartner, ApiKey, ApiLog, IntegrationEvent,
  UssdSession, ExternalTransaction, UssdFlowType, ExtTxType,
} from '../types/mno'

// ── Partners ─────────────────────────────────────────────────────────
export const MNO_PARTNERS: MnoPartner[] = [
  {
    id: 'mno-001',
    name: 'NetOne Zimbabwe',
    code: 'NETONE',
    apiBaseUrl: 'https://api.netone.co.zw/insurance/v1',
    webhookUrl: 'https://api.netone.co.zw/webhooks/insurance',
    status: 'active',
    environment: 'production',
    createdAt: '2024-01-15',
    contractStart: '2024-02-01',
    contractEnd: '2026-01-31',
    contactName: 'Tinashe Mutamba',
    contactEmail: 'ipartnerships@netone.co.zw',
    contactPhone: '+263712001234',
    totalCustomers: 12847,
    totalPolicies: 9234,
    totalRevenue: 4521780,
    avgResponseMs: 143,
    successRate: 98.7,
  },
  {
    id: 'mno-002',
    name: 'NetOne Sandbox',
    code: 'NETONE_SB',
    apiBaseUrl: 'https://sandbox.netone.co.zw/insurance/v1',
    webhookUrl: 'https://sandbox.netone.co.zw/webhooks/insurance',
    status: 'testing',
    environment: 'sandbox',
    createdAt: '2024-06-01',
    contractStart: '2024-07-01',
    contractEnd: '2026-06-30',
    contactName: 'Blessing Chiweshe',
    contactEmail: 'bchiweshe@netone.co.zw',
    contactPhone: '+263712987654',
    totalCustomers: 2341,
    totalPolicies: 1876,
    totalRevenue: 392400,
    avgResponseMs: 187,
    successRate: 94.2,
  },
]

// ── API Keys ──────────────────────────────────────────────────────────
export const API_KEYS: ApiKey[] = [
  {
    id: 'key-001',
    partnerId: 'mno-001',
    partnerName: 'NetOne Zimbabwe',
    label: 'NetOne Production Key',
    keyPrefix: 'tqfy_net_',
    environment: 'production',
    permissions: ['customers:read', 'customers:write', 'policies:read', 'policies:write', 'payments:read', 'payments:write', 'products:read', 'ussd:interact', 'webhooks:manage'],
    status: 'active',
    createdAt: '2024-02-01',
    expiresAt: '2026-02-01',
    lastUsed: new Date(Date.now() - 45000).toISOString(),
    requestCount: 84723,
    rateLimit: 500,
  },
  {
    id: 'key-002',
    partnerId: 'mno-001',
    partnerName: 'NetOne Zimbabwe',
    label: 'NetOne Dev Key',
    keyPrefix: 'tqfy_net_d',
    environment: 'sandbox',
    permissions: ['customers:read', 'customers:write', 'policies:read', 'policies:write', 'payments:read', 'products:read', 'ussd:interact'],
    status: 'active',
    createdAt: '2024-01-20',
    lastUsed: new Date(Date.now() - 3600000).toISOString(),
    requestCount: 12340,
    rateLimit: 100,
  },
  {
    id: 'key-003',
    partnerId: 'mno-002',
    partnerName: 'NetOne Sandbox',
    label: 'NetOne Sandbox Key',
    keyPrefix: 'tqfy_net_sb',
    environment: 'sandbox',
    permissions: ['customers:read', 'customers:write', 'policies:read', 'products:read', 'ussd:interact'],
    status: 'active',
    createdAt: '2024-07-01',
    lastUsed: new Date(Date.now() - 7200000).toISOString(),
    requestCount: 3421,
    rateLimit: 100,
  },
  {
    id: 'key-004',
    partnerId: 'mno-001',
    partnerName: 'NetOne Zimbabwe',
    label: 'NetOne Legacy Key (Revoked)',
    keyPrefix: 'tqfy_net_lg',
    environment: 'production',
    permissions: ['customers:read', 'policies:read'],
    status: 'revoked',
    createdAt: '2023-11-01',
    expiresAt: '2024-11-01',
    lastUsed: '2024-01-28T14:23:00Z',
    requestCount: 23100,
    rateLimit: 200,
  },
]

// ── API Logs ──────────────────────────────────────────────────────────
function ago(ms: number) { return Date.now() - ms }
const endpoints = [
  'POST /api/v1/mno/customers/sync',
  'POST /api/v1/mno/payments',
  'POST /api/v1/mno/ussd/action',
  'GET /api/v1/products',
  'POST /api/v1/mno/claims/initiate',
  'GET /api/v1/policies/status',
  'POST /api/v1/webhooks/deliver',
  'GET /api/v1/products/premiums',
]

export const API_LOGS: ApiLog[] = Array.from({ length: 40 }, (_, i) => {
  const partner = i % 5 === 0 ? MNO_PARTNERS[1] : MNO_PARTNERS[0]
  const endpoint = endpoints[i % endpoints.length]
  const isInbound = !endpoint.includes('GET /api/v1/products') && !endpoint.includes('webhooks/deliver')
  const success = Math.random() > 0.04
  const duration = Math.floor(Math.random() * 280) + 60
  return {
    id: `log-${i.toString().padStart(3, '0')}`,
    ts: ago(i * 18000 + Math.floor(Math.random() * 5000)),
    method: endpoint.startsWith('POST') ? 'POST' : 'GET',
    endpoint: endpoint.replace('POST ', '').replace('GET ', ''),
    direction: isInbound ? 'inbound' : 'outbound',
    partnerId: partner.id,
    partnerName: partner.name,
    statusCode: success ? 200 : (Math.random() > 0.5 ? 400 : 503),
    duration,
    success,
    requestSize: Math.floor(Math.random() * 2048) + 128,
    responseSize: Math.floor(Math.random() * 1024) + 64,
    ip: partner.id === 'mno-001' ? '196.43.113.10' : '196.43.112.44',
    error: success ? undefined : (Math.random() > 0.5 ? 'INVALID_SIGNATURE' : 'SERVICE_UNAVAILABLE'),
    requestId: `req_${Math.random().toString(36).slice(2, 9)}`,
    apiKeyPrefix: partner.id === 'mno-001' ? 'tqfy_net_' : 'tqfy_net_sb',
  }
})

// ── Integration Events ────────────────────────────────────────────────
const EVT_TYPES: IntegrationEvent['type'][] = [
  'customer.created', 'policy.created', 'payment.received',
  'claim.initiated', 'ussd.session.completed', 'policy.updated',
  'payment.failed', 'claim.resolved',
]

export const INTEGRATION_EVENTS: IntegrationEvent[] = Array.from({ length: 30 }, (_, i) => {
  const partner = i % 4 === 0 ? MNO_PARTNERS[1] : MNO_PARTNERS[0]
  const type = EVT_TYPES[i % EVT_TYPES.length]
  const isOutbound = type.includes('policy') || type.includes('claim.resolved') || type.includes('payment.failed')
  const delivered = Math.random() > 0.08
  return {
    id: `evt-${i.toString().padStart(3, '0')}`,
    ts: ago(i * 25000 + Math.floor(Math.random() * 8000)),
    type,
    partnerId: partner.id,
    partnerName: partner.name,
    direction: isOutbound ? 'outbound' : 'inbound',
    payload: {
      msisdn: `+26377${Math.floor(Math.random() * 9000000 + 1000000)}`,
      event: type,
      timestamp: new Date(ago(i * 25000)).toISOString(),
    },
    status: delivered ? 'delivered' : (Math.random() > 0.5 ? 'retrying' : 'failed'),
    attempts: delivered ? 1 : Math.floor(Math.random() * 3) + 1,
    deliveredAt: delivered ? new Date(ago(i * 25000 - 500)).toISOString() : undefined,
    error: delivered ? undefined : 'Connection timeout',
    webhookUrl: isOutbound ? partner.webhookUrl : undefined,
  }
})

// ── USSD Sessions ─────────────────────────────────────────────────────
const FLOW_TYPES: UssdFlowType[] = ['register', 'check_policy', 'pay_premium', 'claim', 'enquiry']
const MSISDNS = [
  '+263771234567', '+263772345678', '+263773456789', '+263774567890',
  '+263775678901', '+263776789012', '+263777890123', '+263778901234',
]

export const USSD_SESSIONS: UssdSession[] = Array.from({ length: 20 }, (_, i) => {
  const flow = FLOW_TYPES[i % FLOW_TYPES.length]
  const partner = i % 4 === 0 ? MNO_PARTNERS[1] : MNO_PARTNERS[0]
  const done = i > 5
  const start = new Date(ago(i * 120000 + 30000)).toISOString()
  return {
    id: `ussd-${i.toString().padStart(3, '0')}`,
    sessionId: `SES${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    msisdn: MSISDNS[i % MSISDNS.length],
    partnerId: partner.id,
    partnerName: partner.name,
    currentStep: done ? 4 : 2,
    currentMenu: done ? 'END' : (flow === 'register' ? 'REGISTER_ID' : 'MAIN'),
    flowType: flow,
    steps: [
      { step: 0, input: '', menuShown: 'MAIN_MENU', ts: start },
      { step: 1, input: String((i % 5) + 1), menuShown: 'PRODUCT_SELECT', ts: new Date(ago(i * 120000 + 20000)).toISOString() },
      ...(done ? [
        { step: 2, input: '12345678A90', menuShown: 'ENTER_ID', ts: new Date(ago(i * 120000 + 12000)).toISOString() },
        { step: 3, input: '1', menuShown: 'CONFIRM', ts: new Date(ago(i * 120000 + 5000)).toISOString() },
      ] : []),
    ],
    status: done ? (Math.random() > 0.1 ? 'completed' : 'timeout') : 'active',
    startedAt: start,
    updatedAt: new Date(ago(i * 120000 + (done ? 3000 : 15000))).toISOString(),
    completedAt: done ? new Date(ago(i * 120000 + 2000)).toISOString() : undefined,
    outcome: done ? (flow === 'register' ? 'Policy POL2024' + (9000 + i) + ' created' : 'Enquiry completed') : undefined,
  }
})

// ── External Transactions ─────────────────────────────────────────────
export const EXTERNAL_TRANSACTIONS: ExternalTransaction[] = Array.from({ length: 35 }, (_, i) => {
  const partner = i % 4 === 0 ? MNO_PARTNERS[1] : MNO_PARTNERS[0]
  const types: ExtTxType[] = ['premium_payment', 'premium_payment', 'premium_payment', 'claim_payout', 'refund']
  const type = types[i % types.length]
  const confirmed = Math.random() > 0.06
  return {
    id: `etx-${i.toString().padStart(3, '0')}`,
    transactionRef: `TXN${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    partnerId: partner.id,
    partnerName: partner.name,
    msisdn: MSISDNS[i % MSISDNS.length],
    amount: type === 'premium_payment' ? [3, 5, 8, 15][i % 4] : type === 'claim_payout' ? Math.floor(Math.random() * 500) + 100 : 5,
    currency: 'USD',
    type,
    status: confirmed ? 'confirmed' : (Math.random() > 0.5 ? 'pending' : 'failed'),
    policyId: `POL2024${9000 + i}`,
    policyNumber: `POL2024${String(9000 + i).padStart(6, '0')}`,
    ts: new Date(ago(i * 3600000 + Math.floor(Math.random() * 1800000))).toISOString(),
    confirmedAt: confirmed ? new Date(ago(i * 3600000)).toISOString() : undefined,
    failureReason: confirmed ? undefined : 'Insufficient wallet balance',
    channel: i % 3 === 0 ? 'api' : 'ussd',
  }
})
