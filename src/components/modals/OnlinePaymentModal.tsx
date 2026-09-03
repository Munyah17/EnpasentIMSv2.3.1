import { useState, useEffect, useRef } from 'react'
import type { Policy } from '../../types'
import {
  initiateEcoCash, initiatePaynow, getZipitDetails, pollEcoCash, pollPaynow,
  formatMoney,
} from '../../lib/paymentGateways'
import type { PaymentResponse, Currency } from '../../lib/paymentGateways'
import { db } from '../../lib/db'
import { policyBillablePremium, billableHeadCount } from '../../lib/premium'
import { recordActivity } from '../../lib/activityLog'
import { ADMIN_ALERT_NUMBERS } from '../../lib/signupNotifications'
import { sendSms } from '../../lib/smsService'
import { taggedReference } from '../../lib/originTag'
import { convertUsdToZig, isStale, rateAgeLabel } from '../../lib/exchangeRate'
import type { ExchangeRate } from '../../lib/exchangeRate'
import {
  getCurrencySettings, isActive, canDeactivate, DEFAULT_CURRENCY_SETTINGS,
  CURRENCY_LABELS, CURRENCY_UNAVAILABLE_MESSAGE,
} from '../../lib/currencies'
import type { CurrencySettings } from '../../lib/currencies'
import { useAuth } from '../../contexts/AuthContext'
import PhoneInput from '../ui/PhoneInput'

interface Props {
  policy: Policy
  onClose: () => void
  onSuccess: () => void
  showToast: (type: 'success' | 'error' | 'warning' | 'info', msg: string) => void
}

type PayStep = 'select' | 'confirm' | 'processing' | 'success' | 'failed' | 'mismatch'

/**
 * Three rails, because there are only three.
 *
 * EcoCash Instant is Econet's own direct rail: a prompt goes straight to the
 * payer's handset. Paynow is an aggregator whose hosted page offers its full
 * picker — EcoCash, OneMoney, InnBucks, Omari, ZIPIT, card — so listing
 * those individually here duplicated Paynow's own checkout on our side.
 * Bank transfer is settled off-system and confirmed by staff.
 */
type Method = 'ecocash' | 'paynow' | 'zipit'

const METHODS: { id: Method; label: string; blurb: string; badge: string; alt: string }[] = [
  {
    id: 'paynow',
    label: 'Paynow',
    blurb: 'EcoCash, OneMoney, InnBucks, Omari, ZIPIT or card on Paynow’s secure page.',
    badge: '/badges/paynow.svg',
    alt: 'Paynow',
  },
  {
    id: 'ecocash',
    label: 'EcoCash Instant',
    blurb: 'Sends the payment prompt straight to the client’s phone.',
    badge: '/badges/ecocash.png',
    alt: 'EcoCash',
  },
  {
    id: 'zipit',
    label: 'Bank Transfer',
    blurb: 'Client transfers to our account; staff confirm it once it clears.',
    badge: '/badges/zimswitch.png',
    alt: 'ZimSwitch',
  },
]

const METHOD_LABELS: Record<Method, string> = {
  ecocash: 'EcoCash Instant',
  paynow: 'Paynow',
  zipit: 'Bank Transfer',
}

export default function OnlinePaymentModal({ policy, onClose, onSuccess, showToast }: Props) {
  const { user } = useAuth()
  const [step, setStep] = useState<PayStep>('select')
  const [method, setMethod] = useState<Method>('paynow')
  // Paynow only. EcoCash Instant and bank transfer are USD rails here.
  const [currency, setCurrency] = useState<Currency>('USD')
  const [phone, setPhone] = useState('')
  const [result, setResult] = useState<PaymentResponse | null>(null)
  const [zipitDetails, setZipitDetails] = useState<ReturnType<typeof getZipitDetails> | null>(null)
  const [pollStatus, setPollStatus] = useState<string>('Awaiting payment…')
  const [hadCaution, setHadCaution] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [client, setClient] = useState<{ phone?: string; email?: string } | null>(null)
  const [category, setCategory] = useState('')
  const [periods, setPeriods] = useState(1)
  const [rate, setRate] = useState<ExchangeRate | null>(null)
  const [currencySettings, setCurrencySettings] = useState<CurrencySettings>(DEFAULT_CURRENCY_SETTINGS)
  useEffect(() => {
    db.clients.list().then(({ data }) => {
      setClient(data?.find(c => c.id === policy.clientId) ?? null)
    })
    db.products.list().then(({ data }) => {
      setCategory(data?.find(p => p.id === policy.productId)?.category ?? '')
    })
    // The rate in force, for showing the ZiG price. The server reads it
    // again when it charges — this copy is presentation only.
    db.exchangeRates.current().then(({ data }) => setRate(data))
    void getCurrencySettings().then(setCurrencySettings)
  }, [policy.clientId, policy.productId])
  const isAgriculture = category === 'agriculture'
  // Tagged so a Paynow transaction or a bank statement line says which app
  // took the money -- several collect through the same Paynow account. See
  // src/lib/originTag.ts.
  const ref = taggedReference(`${policy.policyNumber}${Date.now().toString(36).toUpperCase()}`)
  // Premiums are per head: the amount collected covers the policyholder and
  // every dependant on the policy, not the policyholder alone.
  const perPeriod = policyBillablePremium(policy, category)
  const heads = billableHeadCount(policy, category)
  const usdTotal = perPeriod * periods

  /**
   * USD is the base currency: the premium is priced in USD and a ZiG figure
   * is worked out from the rate an admin last recorded.
   *
   * Shown here so the payer sees what they are agreeing to, but never sent
   * as the amount to charge — api/paynow.ts is given the USD price and
   * converts it again from the same rate. The browser stating what to
   * collect in ZiG would be a client able to pay a policy off for pennies.
   */
  const usesZig = method === 'paynow' && currency === 'ZWG'
  const zigTotal = rate ? convertUsdToZig(usdTotal, rate.rate) : null
  const totalAmount = usesZig ? (zigTotal ?? 0) : usdTotal
  const displayCurrency: Currency = usesZig ? 'ZWG' : 'USD'
  // ZiG cannot be charged without a rate: the server refuses it, so the UI
  // says so up front rather than letting someone reach a failed redirect.
  const zigBlocked = usesZig && (!rate || !zigTotal)

  const req = {
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    clientName: policy.clientName,
    clientPhone: phone || client?.phone || '',
    clientEmail: client?.email || '',
    // Always the USD price, never the converted figure. api/paynow.ts
    // converts it from the rate on record; sending the ZiG total here would
    // let the browser name what it wants to be charged. EcoCash Instant and
    // bank transfer are USD rails, so this is right for them too.
    amount: usdTotal,
    reference: ref,
    currency: method === 'paynow' ? currency : undefined,
  }

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  useEffect(() => () => stopPoll(), [])

  function startPoll(res: PaymentResponse) {
    if (!res.pollUrl) return
    const url = res.pollUrl
    const fn = res.gateway === 'ecocash' ? pollEcoCash : pollPaynow
    pollRef.current = setInterval(async () => {
      const { status, message, amount: confirmedAmount } = await fn(url)
      setPollStatus(message)
      if (status === 'success') {
        stopPoll()
        // "Paid" only means the reference cleared, not that it cleared for
        // what this transaction actually asked for. confirmedAmount is
        // undefined when the gateway's reply had nothing recognisable as an
        // amount (see pollEcoCash's comment) -- that is "cannot verify",
        // not "verified", so it still proceeds; a present amount that
        // disagrees is never waved through.
        if (confirmedAmount !== undefined && Math.abs(confirmedAmount - totalAmount) > 0.01) {
          void handleMismatch(res.gateway, confirmedAmount)
        } else {
          handleConfirmed()
        }
      }
      if (status === 'failed') { stopPoll(); setStep('failed') }
    }, 4000)
  }

  /**
   * The gateway says paid, but not for the amount this transaction was for.
   *
   * Never credited automatically in either direction: not as a success (the
   * amount is wrong), and not as a plain failure either (money may well have
   * actually moved, just not the right amount, and telling a client "failed"
   * when their money was taken would be the worse of the two mistakes). It
   * is parked for a human, loudly -- an activity log entry staff review
   * regardless, and an immediate SMS to the office lines, the same ones a
   * new registration alerts, since this is rarer and more urgent than that.
   */
  async function handleMismatch(gateway: Method, confirmedAmount: number) {
    setStep('mismatch')
    const detail = `Reference ${ref}: ${METHOD_LABELS[gateway]} confirmed ${formatMoney(confirmedAmount, displayCurrency)}, expected ${formatMoney(totalAmount, displayCurrency)}, for ${policy.clientName} (${policy.policyNumber}). Not recorded -- needs manual reconciliation.`
    if (user) {
      void recordActivity({
        action: 'payment.validated',
        actor: { id: user.id, name: user.name, role: user.role },
        entityType: 'payment',
        entityId: policy.id,
        entityLabel: policy.policyNumber,
        detail: `AMOUNT MISMATCH — ${detail}`,
        severity: 'warning',
      })
    }
    const alert = `Enpasent: PAYMENT AMOUNT MISMATCH. ${detail}`
    for (const number of ADMIN_ALERT_NUMBERS) {
      void sendSms(number, alert).catch(() => { /**/ })
    }
  }

  /**
   * Writes the payment down.
   *
   * `validatedManually` separates the two very different things that reach
   * this function: a gateway telling us it collected the money, and a staff
   * member asserting the money arrived some other way (a bank transfer that
   * cleared). Both produce a completed payment — the
   * money is equally real — but only the second is a human judgement, so it
   * is attributed to whoever made it.
   */
  async function handleConfirmed(validatedManually = false) {
    await db.payments.create({
      reference: ref,
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      clientName: policy.clientName,
      amount: totalAmount,
      method: method === 'zipit' ? 'Zipit' : method === 'paynow' ? 'Paynow' : 'EcoCash',
      status: 'completed',
      date: new Date().toISOString().split('T')[0],
    })

    // The client's receipt for the rails that settle here: EcoCash Instant
    // (confirmed by the poll above) and a bank transfer a staff member has
    // just validated. Paynow never reaches this function -- it hands the
    // whole page over and is receipted server-side by whichever reconcile
    // route settles it -- so this cannot double up on that one.
    const clientPhone = client?.phone ?? ''
    if (clientPhone) {
      void sendSms(
        clientPhone,
        `Enpasent Multiple Agent: Thank you ${policy.clientName.split(' ')[0]}. We have received ${formatMoney(totalAmount, displayCurrency)} for policy ${policy.policyNumber}. Ref ${ref}.`,
      ).catch(() => { /**/ })
    }

    if (user) {
      void recordActivity({
        action: validatedManually ? 'payment.validated' : 'payment.recorded',
        actor: { id: user.id, name: user.name, role: user.role },
        entityType: 'payment',
        entityId: policy.id,
        entityLabel: policy.policyNumber,
        detail: validatedManually
          ? `Manually validated ${formatMoney(totalAmount, displayCurrency)} via ${METHOD_LABELS[method]} for ${policy.clientName}. Not confirmed by a gateway.`
          : `${formatMoney(totalAmount, displayCurrency)} confirmed by ${METHOD_LABELS[method]} for ${policy.clientName}. Reference ${ref}.`,
        severity: validatedManually ? 'warning' : 'info',
      })
    }

    // Clear any caution flag
    const { data: existing } = await db.cautionFlags.get(policy.id)
    if (existing && !existing.cleared) {
      setHadCaution(true)
      await db.cautionFlags.clear(policy.id)
    }
    setStep('success')
    onSuccess()
  }

  async function handlePay() {
    // Only EcoCash Instant needs a number up front — it pushes the prompt to
    // that handset. Paynow collects whatever it needs on its own page.
    if (!phone && method === 'ecocash') { showToast('warning', "Enter the client's phone number — the EcoCash prompt is sent to it."); return }
    // Blocked rather than defaulted: without a rate, a ZiG payment sent for
    // the USD figure would collect a fraction of the premium and still mark
    // it paid. The server refuses it too — this only saves a round trip.
    if (zigBlocked) {
      showToast('warning', 'No exchange rate is set, so ZiG cannot be charged. Set it in Settings, or take this payment in USD.')
      return
    }
    if (usesZig && !isActive(currencySettings, 'ZWG')) {
      showToast('warning', `ZiG: ${CURRENCY_UNAVAILABLE_MESSAGE}.`)
      return
    }
    setStep('processing')

    let res: PaymentResponse

    if (method === 'ecocash') {
      res = await initiateEcoCash(req)
    } else if (method === 'paynow') {
      // Plain hosted checkout: Paynow's page presents its own rail picker,
      // so we don't pre-select one on its behalf.
      res = await initiatePaynow(req)
    } else {
      const z = getZipitDetails(req)
      setZipitDetails(z)
      setResult(z)
      setStep('confirm')
      return
    }

    setResult(res)

    if (!res.success) { setStep('failed'); return }

    if (res.status === 'redirect' && res.redirectUrl) {
      // A full-page redirect, not a second tab.
      //
      // This used to window.open() Paynow and poll from the tab left
      // behind, which only ever worked while that tab stayed open — close
      // it, or let a phone drop the background tab, and the payment
      // completed at Paynow with nothing here listening. Popup blockers ate
      // the window outright often enough besides.
      //
      // Confirmation no longer depends on this browser at all: the server
      // settles the reference via the webhook, /payment/return, or the
      // reconcile sweep, whichever arrives first. So the simplest, most
      // survivable thing is to hand the whole page over to Paynow and let
      // it bring the payer back to /payment/return.
      window.location.assign(res.redirectUrl)
      return
    }

    if (res.status === 'pending') {
      setStep('confirm')
      if (res.pollUrl) startPoll(res)
      return
    }

  }

  function handleManualConfirm() {
    stopPoll()
    void handleConfirmed(true)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h3>Pay Online: {policy.policyNumber}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* ── SELECT METHOD ── */}
          {step === 'select' && (
            <>
              <div style={{ background: 'var(--surface)', borderRadius: 9, padding: '12px 14px', marginBottom: 16, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>{policy.clientName}</span>
                  <strong>{formatMoney(totalAmount, displayCurrency)}</strong>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{policy.productName} · {policy.policyNumber}</div>
                {heads > 1 && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                    Covers {heads} people (policyholder + {heads - 1} dependant{heads === 2 ? '' : 's'})
                  </div>
                )}
              </div>

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label>Number of {isAgriculture ? 'Years' : 'Months'} to Pay</label>
                <select className="form-control" value={periods} onChange={e => setPeriods(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n} {isAgriculture ? (n === 1 ? 'year' : 'years') : (n === 1 ? 'month' : 'months')} (${(perPeriod * n).toFixed(2)})</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label>Payment Method</label>
                <div className="pay-method-banners">
                  {METHODS.map(m => (
                    <label key={m.id} className={`pay-method-banner${method === m.id ? ' active' : ''}`}>
                      <input type="radio" name="method" checked={method === m.id} onChange={() => setMethod(m.id)} style={{ display: 'none' }} />
                      <img src={m.badge} alt={m.alt} className="pay-method-banner-badge" />
                      <span className="pay-method-banner-text">
                        <span className="pay-method-banner-label">{m.label}</span>
                        <span className="pay-method-banner-blurb">{m.blurb}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {method === 'paynow' && (
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label>Pay In</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['USD', 'ZWG'] as Currency[]).map(c => {
                      const available = isActive(currencySettings, c)
                      return (
                        <button
                          key={c}
                          type="button"
                          disabled={!available}
                          title={available ? undefined : CURRENCY_UNAVAILABLE_MESSAGE}
                          className={`btn ${currency === c ? 'btn-primary' : 'btn-secondary'}`}
                          style={{
                            flex: 1,
                            textDecoration: available ? undefined : 'line-through',
                            opacity: available ? undefined : 0.55,
                            cursor: available ? undefined : 'not-allowed',
                          }}
                          onClick={() => available && setCurrency(c)}
                        >
                          {CURRENCY_LABELS[c]}
                          {c === 'USD' && <span style={{ fontSize: 10, opacity: 0.75 }}> · base</span>}
                        </button>
                      )
                    })}
                  </div>
                  {/* A currency that is off is shown struck through rather than
                      removed, so a client expecting it is told why. */}
                  {canDeactivate('ZWG') && !isActive(currencySettings, 'ZWG') && (
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>ZiG: {CURRENCY_UNAVAILABLE_MESSAGE}.</span>
                  )}
                </div>
              )}

              {usesZig && (
                <div
                  className={`info-banner ${zigBlocked ? 'info-banner-warning' : 'info-banner-info'}`}
                  style={{ borderRadius: 8, padding: '10px 13px', marginBottom: 14, fontSize: 12 }}
                >
                  {!rate ? (
                    <>
                      <strong>No exchange rate on record.</strong> ZiG payments are refused until an admin sets the
                      rate in Settings → Exchange Rate. Take this payment in USD, or set the rate first.
                    </>
                  ) : (
                    <>
                      Charging <strong>ZiG {zigTotal?.toFixed(2)}</strong> — US${usdTotal.toFixed(2)} at ZiG{' '}
                      {rate.rate.toLocaleString('en-US', { maximumFractionDigits: 4 })} per US$1.
                      <div style={{ marginTop: 4, opacity: 0.85 }}>
                        {rateAgeLabel(rate)}
                        {isStale(rate) && ' — this rate is over a week old. Check it before collecting.'}
                      </div>
                    </>
                  )}
                </div>
              )}

              {method === 'ecocash' && (
                <div className="form-group">
                  <label>Client Phone Number</label>
                  <PhoneInput value={phone} onChange={setPhone} placeholder={client?.phone} />
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>The EcoCash prompt is sent to this number.</span>
                </div>
              )}

              {method === 'paynow' && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  You’ll be taken to Paynow’s secure page to pay, then brought back here. No card or wallet
                  details are entered in, or stored by, this system.
                </div>
              )}
            </>
          )}

          {/* ── PROCESSING ── */}
          {step === 'processing' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              <p>Initiating payment via {METHOD_LABELS[method]}…</p>
            </div>
          )}

          {/* ── CONFIRM / POLL ── */}
          {step === 'confirm' && result && (
            <>
              <div className={`info-banner ${result.success ? 'info-banner-success' : 'info-banner-warning'}`} style={{ borderRadius: 8, padding: '10px 13px', marginBottom: 14, fontSize: 12 }}>
                {result.message}
              </div>

              {/* Zipit bank details */}
              {method === 'zipit' && zipitDetails?.bankDetails && (
                <div className="zipit-details">
                  <div className="sh-info-row"><span>Bank</span><strong>{zipitDetails.bankDetails.bankName}</strong></div>
                  <div className="sh-info-row"><span>Account Name</span><strong>{zipitDetails.bankDetails.accountName}</strong></div>
                  <div className="sh-info-row"><span>Account Number</span><strong className="mono">{zipitDetails.bankDetails.accountNumber}</strong></div>
                  <div className="sh-info-row"><span>Branch Code</span><strong>{zipitDetails.bankDetails.branchCode}</strong></div>
                  <div className="sh-info-row"><span>Reference</span><strong className="mono">{zipitDetails.bankDetails.reference}</strong></div>
                  <div className="sh-info-row"><span>Amount</span><strong>${zipitDetails.bankDetails.amount.toFixed(2)}</strong></div>
                </div>
              )}

              {method === 'zipit' && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                  Validating manually records this as received on your authority — use it once the money is actually
                  in hand (transfer cleared, cash counted, or an EcoCash send-money transfer verified). It is logged
                  against your name.
                </div>
              )}

              {/* Poll status */}
              {result.pollUrl && (
                <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 12, color: 'var(--muted)' }}>
                  <div style={{ marginBottom: 4 }}>🔄 {pollStatus}</div>
                  <div>Checking every 4 seconds…</div>
                </div>
              )}
            </>
          )}

          {/* ── SUCCESS ── */}
          {step === 'success' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 42, marginBottom: 12 }}>✅</div>
              <h4 style={{ marginBottom: 8 }}>Payment Confirmed</h4>
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>{formatMoney(totalAmount, displayCurrency)} received for {policy.policyNumber}.</p>
              {hadCaution && <p style={{ color: 'var(--success)', marginTop: 8, fontSize: 12 }}>✓ Caution flag cleared.</p>}
            </div>
          )}

          {/* ── FAILED ── */}
          {step === 'failed' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 42, marginBottom: 12 }}>❌</div>
              <h4 style={{ marginBottom: 8 }}>Payment Failed</h4>
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>{result?.message ?? 'Payment could not be processed.'}</p>
            </div>
          )}

          {/* ── AMOUNT MISMATCH ── */}
          {/* Deliberately not styled or worded as a failure: the gateway did
              report the reference as paid, just not for what was expected,
              so telling anyone "this failed" could be actively wrong. */}
          {step === 'mismatch' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 42, marginBottom: 12 }}>⚠️</div>
              <h4 style={{ marginBottom: 8 }}>Needs Manual Review</h4>
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                The gateway confirmed a different amount than expected for {policy.policyNumber}. It has not been
                recorded automatically. The office has been alerted and will reconcile this by hand.
              </p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 'select' && (
            <>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handlePay}>Continue →</button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <button className="btn btn-ghost" onClick={() => { stopPoll(); onClose() }}>Close</button>
              {/* Only offered for a bank transfer, which settles off-system
                  and which no gateway will ever report on. A live EcoCash
                  Instant or Paynow transaction is confirmed by the gateway
                  or not at all — staff cannot declare it paid from here. */}
              {method === 'zipit' && (
                <button className="btn btn-success" onClick={handleManualConfirm}>
                  ✓ Validate Payment Manually
                </button>
              )}
            </>
          )}
          {step === 'success' && (
            <button className="btn btn-primary btn-full" onClick={onClose}>Done</button>
          )}
          {step === 'failed' && (
            <>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={() => setStep('select')}>Try Again</button>
            </>
          )}
          {step === 'mismatch' && (
            // No "Try Again" here on purpose: the gateway said this
            // reference WAS paid, just not for the right amount, so
            // starting a fresh transaction risks collecting a second time
            // before the first is even reconciled. This one needs a human
            // to look at it, not another attempt.
            <button className="btn btn-primary btn-full" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  )
}
