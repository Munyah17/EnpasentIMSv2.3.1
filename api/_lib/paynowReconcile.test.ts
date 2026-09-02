import { describe, it, expect, vi } from 'vitest'
import { reconcilePaynow } from './paynowReconcile'
import { paynowCredentials, configuredCurrencies, isCurrency } from './paynow'

/**
 * A Supabase stand-in that records the writes made against it.
 *
 * Small on purpose: what matters is which rows were written and with what,
 * because that IS the safety property — a payment credited twice, or
 * credited for the wrong amount, is money.
 */
function fakeDb(opts: {
  txn?: Record<string, unknown> | null
  policy?: Record<string, unknown> | null
  product?: Record<string, unknown> | null
  /** Postgres error to return from the payments insert. */
  insertError?: { code: string; message: string } | null
}) {
  const writes: { table: string; op: string; data: Record<string, unknown> }[] = []

  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: self, eq: self, order: self, limit: self, lt: self, gt: self,
      maybeSingle: async () => {
        if (table === 'paynow_transactions') return { data: opts.txn ?? null }
        if (table === 'policies') return { data: opts.policy ?? null }
        if (table === 'products') return { data: opts.product ?? { category: 'funeral' } }
        return { data: null }
      },
      insert: async (data: Record<string, unknown>) => {
        writes.push({ table, op: 'insert', data })
        return { error: table === 'payments' ? (opts.insertError ?? null) : null }
      },
      update: (data: Record<string, unknown>) => {
        writes.push({ table, op: 'update', data })
        return { eq: async () => ({ error: null }) }
      },
    })
    return chain
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: { from } as any, writes }
}

const TXN = {
  reference: 'POL-001ABC', policy_id: 'p1', expected_amount: 45, status: 'pending', currency: 'USD',
}
const POLICY = {
  id: 'p1', product_id: 'prod1', premium: 45, dependants: [], status: 'active', next_payment_date: null,
}

const paid = (amount: number) => ({ status: 'paid', amount, paynowReference: 'PN123' })

describe('paynow reconciliation', () => {
  it('credits a payment whose amount matches what it was initiated for', async () => {
    const { db, writes } = fakeDb({ txn: TXN, policy: POLICY })
    const result = await reconcilePaynow(db, 'POL-001ABC', paid(45))

    expect(result.outcome).toBe('paid')
    const payment = writes.find(w => w.table === 'payments' && w.op === 'insert')
    expect(payment?.data).toMatchObject({ reference: 'POL-001ABC', amount: 45, method: 'Paynow', status: 'completed' })
    // The policy is moved forward exactly once.
    expect(writes.filter(w => w.table === 'policies')).toHaveLength(1)
  })

  /** The case the whole design exists for: Paynow says the reference cleared,
   *  but not for what it was initiated for. Crediting it would activate cover
   *  that has not been paid for. */
  it('parks a paid-but-wrong-amount transaction and credits nothing', async () => {
    const { db, writes } = fakeDb({ txn: TXN, policy: POLICY })
    const result = await reconcilePaynow(db, 'POL-001ABC', paid(5))

    expect(result.outcome).toBe('mismatch')
    expect(result.expectedAmount).toBe(45)
    expect(result.confirmedAmount).toBe(5)
    expect(writes.find(w => w.table === 'payments')).toBeUndefined()
    expect(writes.find(w => w.table === 'policies')).toBeUndefined()
    expect(writes.find(w => w.table === 'paynow_transactions')?.data).toMatchObject({ status: 'mismatch' })
  })

  it('accepts a rounding-level difference but not a real one', async () => {
    const near = await reconcilePaynow(fakeDb({ txn: TXN, policy: POLICY }).db, 'POL-001ABC', paid(45.009))
    expect(near.outcome).toBe('paid')
    const off = await reconcilePaynow(fakeDb({ txn: TXN, policy: POLICY }).db, 'POL-001ABC', paid(44.9))
    expect(off.outcome).toBe('mismatch')
  })

  /** Three routes race to reconcile the same reference (webhook, return page,
   *  sweep). payments.reference is UNIQUE, so the loser must not advance the
   *  policy a second time for one premium. */
  it('does not advance the policy twice when another route inserted first', async () => {
    const { db, writes } = fakeDb({
      txn: TXN, policy: POLICY, insertError: { code: '23505', message: 'duplicate key' },
    })
    const result = await reconcilePaynow(db, 'POL-001ABC', paid(45))

    expect(result.outcome).toBe('already')
    expect(writes.find(w => w.table === 'policies')).toBeUndefined()
  })

  it('treats an already-paid transaction as a no-op', async () => {
    const { db, writes } = fakeDb({ txn: { ...TXN, status: 'paid' }, policy: POLICY })
    const result = await reconcilePaynow(db, 'POL-001ABC', paid(45))

    expect(result.outcome).toBe('already')
    expect(writes).toHaveLength(0)
  })

  it('will not re-credit a transaction already parked as a mismatch', async () => {
    const { db, writes } = fakeDb({ txn: { ...TXN, status: 'mismatch' }, policy: POLICY })
    const result = await reconcilePaynow(db, 'POL-001ABC', paid(45))

    expect(result.outcome).toBe('mismatch')
    expect(writes.find(w => w.table === 'payments')).toBeUndefined()
  })

  it('records cancelled and disputed as failed without crediting', async () => {
    for (const status of ['cancelled', 'disputed']) {
      const { db, writes } = fakeDb({ txn: TXN, policy: POLICY })
      const result = await reconcilePaynow(db, 'POL-001ABC', { status, amount: 45 })
      expect(result.outcome).toBe('failed')
      expect(writes.find(w => w.table === 'payments')).toBeUndefined()
    }
  })

  it('leaves an undecided transaction pending', async () => {
    const { db, writes } = fakeDb({ txn: TXN, policy: POLICY })
    const result = await reconcilePaynow(db, 'POL-001ABC', { status: 'sent', amount: 0 })

    expect(result.outcome).toBe('pending')
    expect(writes.find(w => w.table === 'payments')).toBeUndefined()
    expect(writes.find(w => w.table === 'paynow_transactions')?.data).not.toHaveProperty('status')
  })

  /** A reference nobody recorded at initiate time has no expected amount, so
   *  there is nothing to validate it against. Never credited on trust. */
  it('refuses a reference it has no record of', async () => {
    const { db, writes } = fakeDb({ txn: null })
    const result = await reconcilePaynow(db, 'MADE-UP-REF', paid(999))

    expect(result.outcome).toBe('unknown-reference')
    expect(writes).toHaveLength(0)
  })

  it('reports a write failure so the caller can let Paynow retry', async () => {
    const { db } = fakeDb({
      txn: TXN, policy: POLICY, insertError: { code: '08006', message: 'connection failure' },
    })
    const result = await reconcilePaynow(db, 'POL-001ABC', paid(45))
    expect(result.outcome).toBe('write-failed')
  })

  it('carries the transaction currency through, so ZiG is never read as USD', async () => {
    const { db } = fakeDb({ txn: { ...TXN, currency: 'ZWG', expected_amount: 1250 }, policy: POLICY })
    const result = await reconcilePaynow(db, 'POL-001ABC', paid(1250))
    expect(result.outcome).toBe('paid')
    expect(result.currency).toBe('ZWG')
  })
})

describe('paynow credentials', () => {
  const ENV = ['PAYNOW_USD_INTEGRATION_ID', 'PAYNOW_USD_INTEGRATION_KEY',
    'PAYNOW_ZIG_INTEGRATION_ID', 'PAYNOW_ZIG_INTEGRATION_KEY',
    'PAYNOW_INTEGRATION_ID', 'PAYNOW_INTEGRATION_KEY'] as const

  function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
    ENV.forEach(k => { delete process.env[k] })
    Object.entries(vars).forEach(([k, v]) => { if (v !== undefined) process.env[k] = v })
    try { fn() } finally {
      ENV.forEach(k => {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      })
    }
  }

  it('keeps the two integrations apart', () => {
    withEnv({
      PAYNOW_USD_INTEGRATION_ID: '16866', PAYNOW_USD_INTEGRATION_KEY: 'usd-key',
      PAYNOW_ZIG_INTEGRATION_ID: '16867', PAYNOW_ZIG_INTEGRATION_KEY: 'zig-key',
    }, () => {
      expect(paynowCredentials('USD')).toMatchObject({ integrationId: '16866', integrationKey: 'usd-key' })
      expect(paynowCredentials('ZWG')).toMatchObject({ integrationId: '16867', integrationKey: 'zig-key' })
      expect(configuredCurrencies()).toEqual(['USD', 'ZWG'])
    })
  })

  /** The pre-split variables were a USD integration. Letting ZiG inherit them
   *  would bill ZiG through the USD merchant — the exact confusion the split
   *  exists to prevent — so only USD falls back. */
  it('inherits the legacy pair for USD only', () => {
    withEnv({ PAYNOW_INTEGRATION_ID: '26481', PAYNOW_INTEGRATION_KEY: 'legacy-key' }, () => {
      expect(paynowCredentials('USD')).toMatchObject({ integrationId: '26481' })
      expect(paynowCredentials('ZWG')).toBeNull()
      expect(configuredCurrencies()).toEqual(['USD'])
    })
  })

  it('reports nothing configured rather than guessing', () => {
    withEnv({}, () => {
      expect(paynowCredentials('USD')).toBeNull()
      expect(paynowCredentials('ZWG')).toBeNull()
      expect(configuredCurrencies()).toEqual([])
    })
  })

  it('only accepts currencies it actually has integrations for', () => {
    expect(isCurrency('USD')).toBe(true)
    expect(isCurrency('ZWG')).toBe(true)
    expect(isCurrency('ZWL')).toBe(false)
    expect(isCurrency('')).toBe(false)
    expect(isCurrency(undefined)).toBe(false)
  })
})
