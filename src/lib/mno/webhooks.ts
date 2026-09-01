import type { IntegrationEvent, IntegrationEventType } from '../../types/mno'
import { mnoStore } from './mnoStore'
import { signPayload, logApiRequest } from './gateway'

const RETRY_DELAYS = [30_000, 120_000, 600_000]  // 30s, 2m, 10m

// ── Dispatch a webhook event to the partner ───────────────────────────
export async function dispatchWebhook(
  event: IntegrationEvent,
): Promise<{ delivered: boolean; statusCode?: number; error?: string }> {
  if (!event.webhookUrl) return { delivered: false, error: 'No webhook URL configured' }

  const start = Date.now()
  const payload = JSON.stringify({ event: event.type, data: event.payload, ts: event.ts })
  const secret = `secret_${event.partnerId}`  // in prod: fetch from secure vault
  const timestamp = Date.now()
  const signature = signPayload(payload, secret, timestamp)

  // Simulate HTTP POST to partner webhook URL
  // In production: use fetch(event.webhookUrl, { method:'POST', headers:{...}, body:payload })
  await new Promise(r => setTimeout(r, Math.random() * 200 + 50))
  const simulatedOk = Math.random() > 0.08
  const statusCode = simulatedOk ? 200 : (Math.random() > 0.5 ? 503 : 408)
  const duration = Date.now() - start

  logApiRequest({
    ts: Date.now(),
    method: 'POST',
    endpoint: event.webhookUrl,
    direction: 'outbound',
    partnerId: event.partnerId,
    partnerName: event.partnerName,
    statusCode,
    duration,
    success: simulatedOk,
    requestSize: payload.length,
    responseSize: simulatedOk ? 32 : 0,
    requestId: `whk_${Math.random().toString(36).slice(2, 9)}`,
    apiKeyPrefix: signature.slice(0, 8),
  })

  return {
    delivered: simulatedOk,
    statusCode,
    error: simulatedOk ? undefined : `HTTP ${statusCode}: delivery failed`,
  }
}

// ── Emit a new event and attempt immediate delivery ──────────────────
export async function emitEvent(
  type: IntegrationEventType,
  partnerId: string,
  payload: Record<string, unknown>,
): Promise<IntegrationEvent> {
  const partner = mnoStore.partners.list().find(p => p.id === partnerId)
  if (!partner) throw new Error(`Unknown partner: ${partnerId}`)

  const isOutbound = type.includes('policy') || type.includes('claim.resolved') || type.includes('payment.failed')
  const event: IntegrationEvent = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    type,
    partnerId,
    partnerName: partner.name,
    direction: isOutbound ? 'outbound' : 'inbound',
    payload,
    status: 'pending',
    attempts: 0,
    webhookUrl: isOutbound ? partner.webhookUrl : undefined,
  }

  mnoStore.events.create(event)

  if (isOutbound) {
    const result = await dispatchWebhook(event)
    const updated: Partial<IntegrationEvent> = {
      attempts: 1,
      status: result.delivered ? 'delivered' : 'retrying',
      deliveredAt: result.delivered ? new Date().toISOString() : undefined,
      error: result.error,
      nextRetry: result.delivered ? undefined : new Date(Date.now() + RETRY_DELAYS[0]).toISOString(),
    }
    mnoStore.events.update(event.id, updated)
    return { ...event, ...updated }
  }

  // Inbound events are immediately "delivered" (we received them)
  mnoStore.events.update(event.id, { status: 'delivered', deliveredAt: new Date().toISOString(), attempts: 1 })
  return { ...event, status: 'delivered' }
}

// ── Retry failed events ───────────────────────────────────────────────
export async function retryFailedEvents(): Promise<number> {
  const events = mnoStore.events.list().filter(e =>
    (e.status === 'failed' || e.status === 'retrying') && e.direction === 'outbound'
  )
  let retried = 0
  for (const event of events.slice(0, 10)) {
    const result = await dispatchWebhook(event)
    const attempts = event.attempts + 1
    mnoStore.events.update(event.id, {
      attempts,
      status: result.delivered ? 'delivered' : (attempts >= 3 ? 'failed' : 'retrying'),
      deliveredAt: result.delivered ? new Date().toISOString() : undefined,
      error: result.error,
      nextRetry: result.delivered || attempts >= 3 ? undefined
        : new Date(Date.now() + (RETRY_DELAYS[attempts - 1] ?? RETRY_DELAYS[2])).toISOString(),
    })
    retried++
  }
  return retried
}
