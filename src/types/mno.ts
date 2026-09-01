// ── Partner ─────────────────────────────────────────────────────────
export type MnoPartnerStatus = 'active' | 'suspended' | 'testing'
export type ApiKeyEnv = 'production' | 'sandbox'
export type ApiKeyStatus = 'active' | 'revoked' | 'expired'
export type ApiDirection = 'inbound' | 'outbound'
export type EventDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying'
export type UssdSessionStatus = 'active' | 'completed' | 'timeout' | 'cancelled'
export type ExtTxType = 'premium_payment' | 'claim_payout' | 'refund'
export type ExtTxStatus = 'pending' | 'confirmed' | 'failed' | 'reversed'
export type UssdFlowType = 'register' | 'check_policy' | 'pay_premium' | 'claim' | 'enquiry'

export type ApiPermission =
  | 'customers:read' | 'customers:write'
  | 'policies:read' | 'policies:write'
  | 'claims:read' | 'claims:write'
  | 'payments:read' | 'payments:write'
  | 'products:read'
  | 'ussd:interact'
  | 'webhooks:manage'

export type IntegrationEventType =
  | 'customer.created' | 'customer.updated'
  | 'policy.created' | 'policy.updated' | 'policy.cancelled'
  | 'payment.received' | 'payment.failed'
  | 'claim.initiated' | 'claim.updated' | 'claim.resolved'
  | 'ussd.session.started' | 'ussd.session.completed'

export interface MnoPartner {
  id: string
  name: string
  code: string
  apiBaseUrl: string
  webhookUrl: string
  status: MnoPartnerStatus
  environment: ApiKeyEnv
  createdAt: string
  contractStart: string
  contractEnd?: string
  contactName: string
  contactEmail: string
  contactPhone: string
  totalCustomers: number
  totalPolicies: number
  totalRevenue: number
  avgResponseMs: number
  successRate: number
}

export interface ApiKey {
  id: string
  partnerId: string
  partnerName: string
  label: string
  keyPrefix: string
  environment: ApiKeyEnv
  permissions: ApiPermission[]
  status: ApiKeyStatus
  createdAt: string
  expiresAt?: string
  lastUsed?: string
  requestCount: number
  rateLimit: number
}

export interface ApiLog {
  id: string
  ts: number
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  endpoint: string
  direction: ApiDirection
  partnerId: string
  partnerName: string
  statusCode: number
  duration: number
  success: boolean
  requestSize: number
  responseSize: number
  ip?: string
  error?: string
  requestId: string
  apiKeyPrefix?: string
}

export interface IntegrationEvent {
  id: string
  ts: number
  type: IntegrationEventType
  partnerId: string
  partnerName: string
  direction: ApiDirection
  payload: Record<string, unknown>
  status: EventDeliveryStatus
  attempts: number
  nextRetry?: string
  deliveredAt?: string
  error?: string
  webhookUrl?: string
}

export interface UssdStep {
  step: number
  input: string
  menuShown: string
  ts: string
}

export interface UssdSession {
  id: string
  sessionId: string
  msisdn: string
  partnerId: string
  partnerName: string
  currentStep: number
  currentMenu: string
  flowType?: UssdFlowType
  steps: UssdStep[]
  status: UssdSessionStatus
  startedAt: string
  updatedAt: string
  completedAt?: string
  customerId?: string
  policyId?: string
  outcome?: string
}

export interface ExternalTransaction {
  id: string
  transactionRef: string
  partnerId: string
  partnerName: string
  msisdn: string
  amount: number
  currency: string
  type: ExtTxType
  status: ExtTxStatus
  policyId?: string
  policyNumber?: string
  claimId?: string
  paymentId?: string
  ts: string
  confirmedAt?: string
  failureReason?: string
  channel: 'ussd' | 'api' | 'webhook'
}

// ── API Payload shapes (inbound from MNO) ───────────────────────────
export interface CustomerSyncPayload {
  msisdn: string
  fullName: string
  nationalId: string
  dob: string
  address?: string
  email?: string
  action: 'create' | 'update'
}

export interface PaymentNotificationPayload {
  transactionRef: string
  msisdn: string
  amount: number
  currency: string
  policyNumber?: string
  timestamp: string
  channel: 'ussd' | 'api'
}

export interface ClaimInitiationPayload {
  msisdn: string
  policyNumber: string
  claimType: string
  description: string
  dateOfEvent: string
  amount?: number
}

export interface UssdActionPayload {
  sessionId: string
  msisdn: string
  input: string
  serviceCode: string
  networkCode: string
  partnerCode: string
}

// ── Standardised API response ────────────────────────────────────────
export interface ApiGatewayResponse<T = unknown> {
  status: 'success' | 'error'
  code?: string
  message?: string
  data?: T
  requestId: string
  timestamp: string
}
