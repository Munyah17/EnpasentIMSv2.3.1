import { useState, useEffect, useCallback } from 'react'
import { db } from '../../lib/db'
import {
  validateRate, isStale, rateAgeLabel, convertUsdToZig, RATE_STALE_AFTER_DAYS,
} from '../../lib/exchangeRate'
import type { ExchangeRate } from '../../lib/exchangeRate'
import {
  getCurrencySettings, saveCurrencySettings, canDeactivate, isActive,
  CURRENCY_CODES, CURRENCY_LABELS, CURRENCY_NAMES, DEFAULT_CURRENCY_SETTINGS,
} from '../../lib/currencies'
import type { CurrencySettings, CurrencyCode } from '../../lib/currencies'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate } from '../../lib/dateUtils'

/**
 * Where the USD/ZiG rate is set.
 *
 * The rate is entered by hand and kept as history rather than overwritten:
 * the newest effective date is what is in force, and older readings stay so
 * a past conversion can still be reconstructed. Nothing here converts money
 * on its own — api/paynow.ts reads the same record when it charges.
 */

interface Props {
  showToast: (type: 'success' | 'error' | 'warning' | 'info', msg: string) => void
}

export default function ExchangeRateSettings({ showToast }: Props) {
  const { user } = useAuth()
  // Mirrors the RLS on exchange_rates, which is public.is_admin() —
  // super_admin or admin. Gating here only avoids presenting a form whose
  // save the database would refuse; the database is the actual control.
  const canEdit = user?.role === 'super_admin' || user?.role === 'admin'

  const [current, setCurrent] = useState<ExchangeRate | null>(null)
  const [history, setHistory] = useState<ExchangeRate[]>([])
  const [rateInput, setRateInput] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().split('T')[0])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [currencies, setCurrencies] = useState<CurrencySettings>(DEFAULT_CURRENCY_SETTINGS)

  const load = useCallback(async () => {
    const [{ data: cur }, { data: hist }] = await Promise.all([
      db.exchangeRates.current(),
      db.exchangeRates.history(),
    ])
    setCurrent(cur)
    setHistory(hist)
    setCurrencies(await getCurrencySettings())
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleSave() {
    const check = validateRate(rateInput)
    if (!check.ok) { showToast('warning', check.error); return }

    setSaving(true)
    try {
      const { error } = await db.exchangeRates.set({
        rate: check.rate,
        effectiveDate,
        source: 'manual',
        note: note.trim() || undefined,
        setBy: user?.name,
      })
      if (error) { showToast('error', `Could not save the rate: ${error}`); return }
      showToast('success', `Rate saved: ZiG ${check.rate} per US$1.`)
      setRateInput('')
      setNote('')
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function toggleCurrency(code: CurrencyCode) {
    if (!canDeactivate(code)) return
    const next: CurrencySettings = {
      active: { ...currencies.active, [code]: !isActive(currencies, code) },
    }
    setCurrencies(next)
    const { error } = await saveCurrencySettings(next)
    if (error) { showToast('error', `Could not save: ${error}`); await load(); return }
    showToast('success', `${CURRENCY_LABELS[code]} payments ${next.active[code] ? 'enabled' : 'disabled'}.`)
  }

  const preview = (() => {
    const check = validateRate(rateInput)
    return check.ok ? convertUsdToZig(100, check.rate) : null
  })()

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><span className="card-title">Exchange Rate (USD → ZiG)</span></div>

        {/* The rate in force, and how old it is. A stale rate is not wrong,
            but on a weekly-published currency it is worth checking before
            money is collected against it. */}
        <div
          className={`info-banner ${!current ? 'info-banner-warning' : isStale(current) ? 'info-banner-warning' : 'info-banner-success'}`}
          style={{ borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13 }}
        >
          {!current ? (
            <>
              <strong>No rate set.</strong> ZiG payments are refused until one is recorded — a payment cannot be
              converted without it, and charging the USD figure through the ZiG account would collect a fraction
              of what is owed.
            </>
          ) : (
            <>
              <strong>ZiG {current.rate.toLocaleString('en-US', { maximumFractionDigits: 4 })}</strong> per US$1
              {' · '}effective {formatDate(current.effectiveDate)}
              {' · '}{rateAgeLabel(current)}
              {current.source === 'estimate' && ' · unconfirmed estimate'}
              {isStale(current) && (
                <div style={{ marginTop: 5 }}>
                  Rates are published weekly; this one is {RATE_STALE_AFTER_DAYS}+ days old. Confirm it before
                  collecting further ZiG payments.
                </div>
              )}
            </>
          )}
        </div>

        {canEdit ? (
          <>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="form-group">
                <label>ZiG per 1 USD</label>
                <input
                  className="form-control"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={rateInput}
                  onChange={e => setRateInput(e.target.value)}
                  placeholder="e.g. 26.75"
                />
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  How many ZiG one US dollar buys — not the other way round.
                </span>
              </div>
              <div className="form-group">
                <label>Effective From</label>
                <input
                  className="form-control"
                  type="date"
                  value={effectiveDate}
                  onChange={e => setEffectiveDate(e.target.value)}
                />
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Re-entering a date corrects that day’s rate.
                </span>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Note (optional)</label>
              <input
                className="form-control"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g. RBZ mid-rate, week of 1 Sep"
              />
            </div>

            {/* A worked example against a round number: a rate entered the
                wrong way round or with a slipped decimal is obvious here in
                a way the raw figure is not. */}
            {preview !== null && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                Check: a US$100.00 premium would be charged as <strong>ZiG {preview.toFixed(2)}</strong>.
              </div>
            )}

            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !rateInput.trim()}>
              {saving ? 'Saving…' : 'Save Rate'}
            </button>
          </>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>
            You don’t have permission to change the exchange rate.
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><span className="card-title">Currencies Accepted</span></div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          Each currency is settled by its own Paynow merchant integration, so this decides which account the
          money lands in — not just what is shown. Turning one off refuses it on the server too.
        </p>
        {CURRENCY_CODES.map(code => (
          <div
            key={code}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)' }}
          >
            <div>
              <strong>{CURRENCY_LABELS[code]}</strong>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}> · {CURRENCY_NAMES[code]}</span>
              {!canDeactivate(code) && (
                <span style={{ color: 'var(--muted)', fontSize: 11 }}> · base currency, always on</span>
              )}
            </div>
            <button
              className={`btn btn-sm ${isActive(currencies, code) ? 'btn-success' : 'btn-secondary'}`}
              disabled={!canEdit || !canDeactivate(code)}
              onClick={() => void toggleCurrency(code)}
            >
              {isActive(currencies, code) ? 'Accepted' : 'Off'}
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Rate History</span></div>
        {history.length === 0 ? (
          <div className="empty-state">No rates recorded yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Effective</th><th>ZiG per US$1</th><th>Set by</th><th>Note</th></tr>
            </thead>
            <tbody>
              {history.map(r => (
                <tr key={r.id}>
                  <td>{formatDate(r.effectiveDate)}</td>
                  <td className="mono">{r.rate.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                  <td>{r.setBy ?? '—'}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {r.note ?? (r.source === 'estimate' ? 'Unconfirmed estimate' : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
