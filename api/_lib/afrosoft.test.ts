import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  sendViaAfrosoft, afrosoftAccepted, afrosoftSenderId, afrosoftDomain,
  normalizeMsisdn, isValidMsisdn, DEFAULT_SENDER_ID,
} from './afrosoft'

/** The env is process-wide, so each test restores what it changed. */
const ENV_KEYS = ['AFROSOFT_SMS_API_KEY', 'AFROSOFT_SMS_SENDER_ID', 'AFROSOFT_SMS_DOMAIN'] as const
let saved: Record<string, string | undefined>

/** Captures the URL sendViaAfrosoft actually requests. */
function mockUpstream(body = '{"status":{"error-code":"000"}}') {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true, status: 200, text: async () => body,
  } as Response)
}

const sentUrl = (m: ReturnType<typeof mockUpstream>) => new URL(String(m.mock.calls[0]?.[0]))

describe('afrosoft gateway', () => {
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
    ENV_KEYS.forEach(k => { delete process.env[k] })
    process.env.AFROSOFT_SMS_API_KEY = 'test-key'
  })
  afterEach(() => {
    vi.restoreAllMocks()
    ENV_KEYS.forEach(k => {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    })
  })

  /** The whole point of the sender ID: recipients must see "Enpasent", not
   *  whatever default sender is assigned to the Afrosoft account. It used to
   *  be sent only when an env var happened to be set, which on a deployment
   *  without one meant every message arrived under someone else's name. */
  it('always sends the sender ID, with no env var set', async () => {
    const mock = mockUpstream()
    await sendViaAfrosoft('263771234567', 'Hello')
    expect(sentUrl(mock).searchParams.get('senderid')).toBe('Enpasent')
    expect(DEFAULT_SENDER_ID).toBe('Enpasent')
  })

  /** Afrosoft refuses a sender ID that isn't registered to the account and
   *  fails the entire batch, so correcting it must not need a code change. */
  it('lets the env var override the sender ID and domain', async () => {
    process.env.AFROSOFT_SMS_SENDER_ID = 'Enpassent'
    process.env.AFROSOFT_SMS_DOMAIN = 'sms.afrosoft.co.zw'
    const mock = mockUpstream()
    await sendViaAfrosoft('263771234567', 'Hello')

    const url = sentUrl(mock)
    expect(url.searchParams.get('senderid')).toBe('Enpassent')
    expect(url.hostname).toBe('sms.afrosoft.co.zw')
    expect(afrosoftSenderId()).toBe('Enpassent')
    expect(afrosoftDomain()).toBe('sms.afrosoft.co.zw')
  })

  it('builds the documented sendmessage request', async () => {
    const mock = mockUpstream()
    await sendViaAfrosoft('263771234567,263772222222', 'Premium due')

    const url = sentUrl(mock)
    expect(url.pathname).toBe('/client/api/sendmessage')
    expect(url.protocol).toBe('https:')
    expect(url.searchParams.get('apikey')).toBe('test-key')
    expect(url.searchParams.get('mobiles')).toBe('263771234567,263772222222')
    expect(url.searchParams.get('sms')).toBe('Premium due')
  })

  it('declares unicode only when the message needs it', async () => {
    const ascii = mockUpstream()
    await sendViaAfrosoft('263771234567', 'Plain text')
    expect(sentUrl(ascii).searchParams.has('unicode')).toBe(false)

    vi.restoreAllMocks()
    const unicode = mockUpstream()
    await sendViaAfrosoft('263771234567', 'Mhoro — tinotenda')
    expect(sentUrl(unicode).searchParams.get('unicode')).toBe('yes')
  })

  /** Failing closed matters more than usual here: the alternative is
   *  reporting messages as sent that never reached the gateway. */
  it('refuses to send when the server has no API key', async () => {
    delete process.env.AFROSOFT_SMS_API_KEY
    const mock = mockUpstream()
    const res = await sendViaAfrosoft('263771234567', 'Hello')

    expect(res.ok).toBe(false)
    expect(res.status).toBe(503)
    expect(res.body).toMatch(/AFROSOFT_SMS_API_KEY/)
    expect(mock).not.toHaveBeenCalled()
  })

  /** Afrosoft answers HTTP 200 even when it refuses the message outright. */
  it('reads the verdict from the body, not the HTTP status', () => {
    expect(afrosoftAccepted('{"status":{"error-code":"000"}}')).toBe(true)
    expect(afrosoftAccepted('{"status":{"error-code":"002","error-description":"sender-id is invalid"}}')).toBe(false)
  })

  it('normalises and validates Zimbabwe numbers', () => {
    expect(normalizeMsisdn('0771234567')).toBe('263771234567')
    expect(normalizeMsisdn('+263 78 008 6176')).toBe('263780086176')
    expect(isValidMsisdn('0771234567')).toBe(true)
    expect(isValidMsisdn('+263780086176')).toBe(true)
    expect(isValidMsisdn('not a number')).toBe(false)
    expect(isValidMsisdn('26377123456')).toBe(false)
  })

  /** Regression: "+2630773909307" -- a country code AND a local leading 0,
   *  both present -- used to pass through unnormalised (it doesn't start
   *  with "0", so the old startsWith('0') check never fired) and fail
   *  validation outright: "Not a valid Zimbabwe mobile number". All four
   *  ways this same number gets typed must resolve identically. */
  it('treats +263, 263, 0, and +2630 prefixes as the same number', () => {
    const same = ['+263773909307', '263773909307', '0773909307', '+2630773909307']
    for (const raw of same) {
      expect(normalizeMsisdn(raw)).toBe('263773909307')
      expect(isValidMsisdn(raw)).toBe(true)
    }
  })
})
