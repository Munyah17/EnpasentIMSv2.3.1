import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'

/**
 * Where Paynow sends the payer back to.
 *
 * Deliberately says nothing on its own authority. Landing here means the
 * payer came back from Paynow's page — it does not mean they paid, and a
 * URL anyone can type is not evidence of anything. So this page asserts
 * nothing until the server has re-polled Paynow for the reference and
 * reconciled it (api/paynow.ts 'verify').
 *
 * That check is also why a full-page redirect is safe. The old flow opened
 * Paynow in a second tab and polled from the first, which only worked while
 * that first tab stayed open; closing it lost the payment. Now the payment
 * is settled server-side by whichever of three routes gets there first —
 * webhook, this page, or the sweep — and this page is simply the fastest
 * one when the payer does come back.
 */

type Phase = 'checking' | 'paid' | 'pending' | 'failed' | 'mismatch' | 'unknown' | 'error'

interface VerifyResult {
  outcome?: string
  reference?: string
  expectedAmount?: number
  confirmedAmount?: number
  currency?: string
  error?: string
}

/** Paynow can report a transaction as still 'Sent' for a few seconds after
 *  the payer completes it, so a single check is not enough to call it
 *  pending. Backs off rather than hammering: ~30 seconds in total. */
const RETRY_DELAYS_MS = [2000, 3000, 5000, 8000, 12000]

const CURRENCY_SYMBOL: Record<string, string> = { USD: 'US$', ZWG: 'ZiG ' }

function money(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined || !Number.isFinite(amount)) return '—'
  return `${CURRENCY_SYMBOL[currency ?? 'USD'] ?? '$'}${amount.toFixed(2)}`
}

export default function PaymentReturn() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const reference = params.get('ref') ?? ''

  const [phase, setPhase] = useState<Phase>('checking')
  const [result, setResult] = useState<VerifyResult>({})
  const [attempt, setAttempt] = useState(0)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    return () => { cancelled.current = true }
  }, [])

  useEffect(() => {
    if (!reference) { setPhase('unknown'); return }

    let timer: ReturnType<typeof setTimeout> | null = null

    async function check(round: number) {
      let reply: VerifyResult
      try {
        const res = await fetch('/api/paynow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify', reference }),
        })
        if (res.status === 404) { if (!cancelled.current) setPhase('unknown'); return }
        reply = await res.json()
      } catch {
        if (!cancelled.current) setPhase('error')
        return
      }
      if (cancelled.current) return

      setResult(reply)
      const outcome = reply.outcome

      if (outcome === 'paid' || outcome === 'already') { setPhase('paid'); return }
      if (outcome === 'mismatch') { setPhase('mismatch'); return }
      if (outcome === 'failed') { setPhase('failed'); return }

      // Still no verdict from Paynow. Try again, then stop and hand over to
      // the webhook and the sweep — both of which will settle it without
      // anyone watching this page.
      if (round < RETRY_DELAYS_MS.length) {
        setAttempt(round + 1)
        timer = setTimeout(() => void check(round + 1), RETRY_DELAYS_MS[round])
      } else {
        setPhase('pending')
      }
    }

    void check(0)
    return () => { if (timer) clearTimeout(timer) }
  }, [reference])

  const amountLine = phase === 'mismatch'
    ? `Paynow confirmed ${money(result.confirmedAmount, result.currency)}, but this reference was for ${money(result.expectedAmount, result.currency)}.`
    : money(result.confirmedAmount ?? result.expectedAmount, result.currency)

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg, #f6f7f9)', padding: 20,
    }}>
      <div className="card" style={{ maxWidth: 460, width: '100%', textAlign: 'center', padding: '32px 28px' }}>

        {phase === 'checking' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 14 }}>⏳</div>
            <h3 style={{ marginBottom: 8 }}>Confirming your payment…</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Checking with Paynow{attempt > 0 ? ` (attempt ${attempt + 1})` : ''}. This usually takes a few seconds —
              please don’t close this page.
            </p>
          </>
        )}

        {phase === 'paid' && (
          <>
            <div style={{ fontSize: 46, marginBottom: 14 }}>✅</div>
            <h3 style={{ marginBottom: 8 }}>Payment Confirmed</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              {amountLine} received and recorded against the policy.
            </p>
          </>
        )}

        {/* Not a failure and not a success. The money may well have moved —
            we simply have no verdict yet — and telling someone "failed" when
            they have paid is the worse of the two mistakes. */}
        {phase === 'pending' && (
          <>
            <div style={{ fontSize: 46, marginBottom: 14 }}>⏱️</div>
            <h3 style={{ marginBottom: 8 }}>Payment Not Yet Confirmed</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Paynow hasn’t given a final answer yet. If the payment went through it will be recorded
              automatically — you don’t need to pay again or keep this page open.
            </p>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10 }}>
              Reference <strong className="mono">{reference}</strong>
            </p>
          </>
        )}

        {phase === 'mismatch' && (
          <>
            <div style={{ fontSize: 46, marginBottom: 14 }}>⚠️</div>
            <h3 style={{ marginBottom: 8 }}>Needs Manual Review</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>{amountLine}</p>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
              It has not been recorded automatically. The office has this reference and will reconcile it.
              Please don’t pay again.
            </p>
          </>
        )}

        {phase === 'failed' && (
          <>
            <div style={{ fontSize: 46, marginBottom: 14 }}>❌</div>
            <h3 style={{ marginBottom: 8 }}>Payment Not Completed</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Paynow reported this payment as cancelled. Nothing has been charged.
            </p>
          </>
        )}

        {phase === 'unknown' && (
          <>
            <div style={{ fontSize: 46, marginBottom: 14 }}>🔍</div>
            <h3 style={{ marginBottom: 8 }}>Payment Not Found</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              We have no record of this payment reference. If money left your account, contact the office
              with the reference from your Paynow receipt.
            </p>
          </>
        )}

        {phase === 'error' && (
          <>
            <div style={{ fontSize: 46, marginBottom: 14 }}>⚠️</div>
            <h3 style={{ marginBottom: 8 }}>Couldn’t Reach the Server</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Your payment may still have gone through — it will be confirmed automatically. Reference{' '}
              <strong className="mono">{reference}</strong>.
            </p>
          </>
        )}

        {phase !== 'checking' && (
          <button className="btn btn-primary btn-full" style={{ marginTop: 22 }} onClick={() => navigate('/')}>
            Return to Enpasent Multiple Agent
          </button>
        )}
      </div>
    </div>
  )
}
