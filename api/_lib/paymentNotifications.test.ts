import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { notifyPaymentOutcome } from './paymentNotifications'
import type { ReconcileResult } from './paynowReconcile'

/**
 * Captures what actually left the building: Afrosoft sendmessage URLs and
 * POSTs to /api/send-email.
 */
function captureSends() {
  const sms: string[] = []
  const emails: { to: string; subject: string; text: string }[] = []

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/client/api/sendmessage')) {
      sms.push(String(new URL(url).searchParams.get('sms')))
      return { ok: true, status: 200, text: async () => '{"status":{"error-code":"000"}}' } as Response
    }
    if (url.includes('/api/send-email')) {
      emails.push(JSON.parse(String((init as RequestInit)?.body ?? '{}')))
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response
    }
    return { ok: true, status: 200, text: async () => '' } as Response
  })

  return { sms, emails }
}

/** Returns the policy/client a receipt is written from. */
function fakeDb() {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: self, eq: self,
      maybeSingle: async () => {
        if (table === 'paynow_transactions') return { data: { policy_id: 'p1' } }
        if (table === 'policies') {
          return {
            data: {
              policy_number: 'EMA2024001',
              clients: { name: 'Simba Dube', email: 'simba@example.com', phone: '0771234567' },
              products: { name: 'Family Funeral Plan' },
            },
          }
        }
        return { data: null }
      },
    })
    return chain
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from } as any
}

const PAID: ReconcileResult = {
  outcome: 'paid', reference: 'ENPA-EMA2024001LK3J9X',
  expectedAmount: 45, confirmedAmount: 45, currency: 'USD',
}
const MISMATCH: ReconcileResult = {
  outcome: 'mismatch', reference: 'ENPA-EMA2024001LK3J9X',
  expectedAmount: 45, confirmedAmount: 5, currency: 'USD',
}

describe('payment notifications', () => {
  beforeEach(() => { process.env.AFROSOFT_SMS_API_KEY = 'test-key' })
  afterEach(() => { vi.restoreAllMocks(); delete process.env.AFROSOFT_SMS_API_KEY })

  it('sends the client a receipt by SMS and email when a payment is credited', async () => {
    const { sms, emails } = captureSends()
    await notifyPaymentOutcome(fakeDb(), PAID, 'https://example.test')

    expect(sms).toHaveLength(1)
    expect(sms[0]).toContain('Enpasent Multiple Agent:')
    expect(sms[0]).toContain('US$45.00')
    expect(sms[0]).toContain('EMA2024001')

    expect(emails).toHaveLength(1)
    expect(emails[0].to).toBe('simba@example.com')
    expect(emails[0].subject).toContain('EMA2024001')
    expect(emails[0].text).toContain('US$45.00')
  })

  /**
   * Three routes reconcile the same reference. Without the alreadyHandled
   * guard a client gets the same receipt up to three times, and the office
   * gets the same mismatch alert three times.
   */
  it('stays silent for the routes that arrive second', async () => {
    const { sms, emails } = captureSends()
    await notifyPaymentOutcome(fakeDb(), { ...PAID, outcome: 'already', alreadyHandled: true }, 'https://example.test')
    await notifyPaymentOutcome(fakeDb(), { ...MISMATCH, alreadyHandled: true }, 'https://example.test')

    expect(sms).toHaveLength(0)
    expect(emails).toHaveLength(0)
  })

  /** This alert used to be raised in the browser, which after the full-page
   *  redirect almost never runs. A mismatch reaching nobody but a server log
   *  is the worst state this system can be in. */
  it('alerts every office line on a newly parked mismatch', async () => {
    const { sms, emails } = captureSends()
    await notifyPaymentOutcome(fakeDb(), MISMATCH, 'https://example.test')

    expect(sms).toHaveLength(4)
    expect(sms.every(m => m.includes('PAYMENT AMOUNT MISMATCH'))).toBe(true)
    expect(sms[0]).toContain('US$5.00')
    expect(sms[0]).toContain('US$45.00')
    expect(sms[0]).toContain('ENPA-EMA2024001LK3J9X')
  })

  /** Their money may well have moved. "Received" would be false, and
   *  "failed" could be worse — it invites a second payment. */
  it('never tells the client anything about a mismatch', async () => {
    const { sms, emails } = captureSends()
    await notifyPaymentOutcome(fakeDb(), MISMATCH, 'https://example.test')

    expect(emails).toHaveLength(0)
    expect(sms.some(m => m.includes('263771234567'))).toBe(false)
  })

  it('says nothing for outcomes that are not an answer', async () => {
    const { sms, emails } = captureSends()
    for (const outcome of ['pending', 'failed', 'unknown-reference', 'write-failed'] as const) {
      await notifyPaymentOutcome(fakeDb(), { ...PAID, outcome }, 'https://example.test')
    }
    expect(sms).toHaveLength(0)
    expect(emails).toHaveLength(0)
  })

  it('reports ZiG amounts in ZiG', async () => {
    const { sms } = captureSends()
    await notifyPaymentOutcome(
      fakeDb(), { ...PAID, expectedAmount: 1250, confirmedAmount: 1250, currency: 'ZWG' }, 'https://example.test',
    )
    expect(sms[0]).toContain('ZiG 1250.00')
    expect(sms[0]).not.toContain('US$')
  })

  /** A failed receipt must never roll back a payment that genuinely settled. */
  it('swallows a gateway failure rather than surfacing it', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    await expect(notifyPaymentOutcome(fakeDb(), PAID, 'https://example.test')).resolves.toBeUndefined()
  })
})
