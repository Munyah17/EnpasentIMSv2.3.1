import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sendSms, sendBulkSms, getSmsLog, clearSmsLog } from './smsService'

/** Replies exactly as /api/gateway-proxy does when it relays Afrosoft. */
function mockGateway(afrosoftBody: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ status: 200, ok: true, body: JSON.stringify(afrosoftBody) }),
  } as Response)
}

const SUCCESS = (mobile: string, id = 'msg-1') => ({
  status: { 'error-code': '000', 'error-status': 'Success', 'error-description': 'Success' },
  'sms-response-details': [{
    'success-count': '1', 'failed-sms-details': [],
    'sent-sms-details': [{ 'message-id': id, 'mobile-no': mobile }],
  }],
})

describe('smsService', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  /** Regression: Afrosoft is sent "263780086176" and reports it back as
   *  "+263780086176". Matching those as strings marked every delivered
   *  message as failed. */
  it('counts a message as sent when the gateway echoes the number back with a + prefix', async () => {
    mockGateway(SUCCESS('+263780086176', 'msg-1'))
    const result = await sendSms('+263780086176', 'Hello')
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-1')
    expect(getSmsLog()[0].status).toBe('sent')
  })

  it('sends without any gateway credentials in the browser', async () => {
    const fetchMock = mockGateway(SUCCESS('+263771234567'))
    await sendSms('0771234567', 'Hello')

    // The request carries only the recipients and the text; the key lives
    // on the server, so nothing here can leak or disable it.
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as { body?: string })?.body ?? '{}'))
    expect(body.action).toBe('sms')
    expect(body.mobiles).toBe('263771234567')
    expect(body).not.toHaveProperty('apikey')
    expect(body).not.toHaveProperty('url')
  })

  it("records the gateway's own reason against a message it refused", async () => {
    mockGateway({
      status: { 'error-code': '002', 'error-status': 'invalid', 'error-description': 'mobiles is invalid' },
      'sms-response-details': [{
        'success-count': '0',
        'failed-sms-details': [{ count: '1', reasons: [{ 'mobile-no': '+263770000001', 'failed-reason': 'Number is not reachable' }] }],
        'sent-sms-details': [],
      }],
    })
    const result = await sendSms('0770000001', 'Hello')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Number is not reachable')
    expect(getSmsLog()[0].error).toBe('Number is not reachable')
  })

  /** Regression: Afrosoft rejects the whole request if any one recipient is
   *  malformed, so a single bad contact used to fail an entire campaign. */
  it('does not let one malformed number sink the rest of a campaign', async () => {
    const fetchMock = mockGateway(SUCCESS('+263771234567', 'msg-ok'))
    const bulk = await sendBulkSms(['0771234567', '+26378025 096', 'not a number'], 'Hello')

    expect(bulk.sent).toBe(1)
    expect(bulk.failed).toBe(2)
    const body = String((fetchMock.mock.calls[0]?.[1] as { body?: string })?.body ?? '')
    expect(body).toContain('263771234567')
    expect(body).not.toContain('not a number')
    expect(bulk.results.find(r => r.phone === 'not a number')?.result.error).toMatch(/not a valid zimbabwe mobile/i)
  })

  /** Regression: "+2630773909307" -- a country code AND a local leading 0,
   *  both present -- used to be reported as "Not a valid Zimbabwe mobile
   *  number" instead of being treated as the same number as the other three
   *  ways it gets typed. */
  it('treats +263, 263, 0, and +2630 prefixes as the same recipient', async () => {
    const fetchMock = mockGateway(SUCCESS('+263773909307', 'msg-1'))
    const bulk = await sendBulkSms(
      ['+263773909307', '263773909307', '0773909307', '+2630773909307'], 'Hello',
    )
    expect(bulk.failed).toBe(0)
    expect(bulk.sent).toBe(4)
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as { body?: string })?.body ?? '{}'))
    expect(body.mobiles).toBe('263773909307,263773909307,263773909307,263773909307')
  })

  it('reports per-number outcomes across a bulk send', async () => {
    mockGateway({
      status: { 'error-code': '000', 'error-status': 'Success', 'error-description': 'Success' },
      'sms-response-details': [{
        'success-count': '1',
        'failed-sms-details': [{ count: '1', reasons: [{ 'mobile-no': '+263771111111', 'failed-reason': 'Blacklisted' }] }],
        'sent-sms-details': [{ 'message-id': 'msg-2', 'mobile-no': '+263772222222' }],
      }],
    })
    const bulk = await sendBulkSms(['0771111111', '0772222222'], 'Hello')
    expect(bulk.sent).toBe(1)
    expect(bulk.failed).toBe(1)
    expect(bulk.results.find(r => r.phone === '0772222222')?.result.success).toBe(true)
    expect(bulk.results.find(r => r.phone === '0771111111')?.result.error).toBe('Blacklisted')
  })

  it('clearSmsLog() empties the log', async () => {
    mockGateway(SUCCESS('+263771234567'))
    await sendSms('0771234567', 'Hello')
    expect(getSmsLog().length).toBeGreaterThan(0)
    clearSmsLog()
    expect(getSmsLog()).toEqual([])
  })
})
