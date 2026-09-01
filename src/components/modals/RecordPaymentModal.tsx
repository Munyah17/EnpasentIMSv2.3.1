import { useState, useEffect } from 'react'
import type { Payment, PaymentMethod, PaymentStatus, SplitPayment, Policy } from '../../types'
import { MANUAL_PAYMENT_METHODS } from '../../types'
import { db } from '../../lib/db'
import { premiumPeriodLabel } from '../../lib/productUtils'
import { policyBillablePremium, billableHeadCount } from '../../lib/premium'
import DateInput from '../ui/DateInput'

interface Props {
  /** When omitted, the modal lets the user pick a policy from a dropdown. */
  policyId?: string
  /** When set, edits this existing payment instead of recording a new one —
   *  the policy it's tied to is locked (a payment doesn't get reassigned to
   *  a different policy after the fact). */
  payment?: Payment
  onClose: () => void
  onSave: (payment: Payment) => void
}

const METHODS = MANUAL_PAYMENT_METHODS
const STATUSES: PaymentStatus[] = ['completed', 'pending', 'failed', 'reversed']

export default function RecordPaymentModal({ policyId: initialPolicyId, payment: editing, onClose, onSave }: Props) {
  const [allPolicies, setAllPolicies] = useState<Policy[] | null>(null)
  const [policyId, setPolicyId] = useState(editing?.policyId ?? initialPolicyId ?? '')
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [policyCategory, setPolicyCategory] = useState('')
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '')
  const [method, setMethod] = useState<PaymentMethod>(editing?.method ?? 'OneMoney')
  const [status, setStatus] = useState<PaymentStatus>(editing?.status ?? 'completed')
  const [date, setDate] = useState(editing?.date ?? new Date().toISOString().split('T')[0])
  const [useSplit, setUseSplit] = useState(!!editing?.splitPayments?.length)
  const [splits, setSplits] = useState<SplitPayment[]>(
    editing?.splitPayments?.length ? editing.splitPayments : [{ method: 'EcoCash', amount: 0 }, { method: 'OneMoney', amount: 0 }]
  )

  useEffect(() => {
    if (!initialPolicyId && !editing) {
      db.policies.list().then(({ data }) => setAllPolicies(data ?? []))
    }
  }, [initialPolicyId, editing])

  useEffect(() => {
    if (policyId) {
      db.policies.get(policyId).then(({ data }) => {
        if (!data) return
        setPolicy(data)
        db.products.list().then(({ data: products }) => {
          setPolicyCategory(products?.find(pr => pr.id === data.productId)?.category ?? '')
        })
      })
    } else {
      setPolicy(null)
      setPolicyCategory('')
    }
  }, [policyId])

  const updateSplit = (i: number, field: keyof SplitPayment, value: string) => {
    setSplits(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: field === 'amount' ? Number(value) : value } : s))
  }

  const addSplit = () => setSplits(prev => [...prev, { method: 'Cash', amount: 0 }])
  const removeSplit = (i: number) => setSplits(prev => prev.filter((_, idx) => idx !== i))

  const splitTotal = splits.reduce((sum, s) => sum + (s.amount || 0), 0)
  const splitMismatch = useSplit && Math.abs(splitTotal - Number(amount || 0)) > 0.01

  /**
   * A recorded payment is money asserted to have been received, so the
   * figure has to be a real one.
   *
   * `!amount` alone let "0" through — a non-empty string is truthy — and
   * the min={0} on the input is only a browser hint, so a negative could be
   * typed or pasted straight past it. Both then reached the policy update
   * and moved the next payment date.
   */
  const amountValue = Number(amount)
  const amountInvalid = !amount.trim() || !Number.isFinite(amountValue) || amountValue <= 0
  const negativeSplit = useSplit && splits.some(s => s.amount < 0)

  const blockedReason = !policyId ? 'Select the policy this payment is for.'
    : amountInvalid ? 'Enter an amount greater than zero.'
      : negativeSplit ? 'A split line cannot be a negative amount.'
        : splitMismatch ? 'The split lines must add up to the amount.'
          : !policy ? 'Still loading the policy — try again in a moment.'
            : null

  const handleSave = () => {
    // Never a silent return: the button stays live and says what is wrong,
    // including the policy-still-loading case, which used to make the
    // button do nothing at all with no explanation.
    if (blockedReason) return
    const reference = editing?.reference ?? `PAY${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(Date.now()).slice(-3)}`
    const paymentRecord: Payment = {
      id: editing?.id ?? `pay${Date.now()}`,
      reference,
      policyId,
      policyNumber: policy!.policyNumber,
      clientName: policy!.clientName,
      amount: amountValue,
      method,
      status,
      date,
      splitPayments: useSplit ? splits.filter(s => s.amount > 0) : undefined,
    }
    onSave(paymentRecord)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h3>{editing ? `Edit Payment: ${editing.reference}` : 'Record Payment'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {!initialPolicyId && !editing && (
            <div className="form-group">
              <label>Policy *</label>
              <select className="form-control" value={policyId} onChange={e => setPolicyId(e.target.value)} disabled={!allPolicies}>
                <option value="">{allPolicies ? 'Select policy…' : 'Loading policies…'}</option>
                {allPolicies?.map(p => (
                  <option key={p.id} value={p.id}>{p.policyNumber} ({p.clientName})</option>
                ))}
              </select>
            </div>
          )}
          {policy && (
            <div className="info-banner info-banner-info" style={{ marginBottom: '1rem' }}>
              Policy: {policy.policyNumber} ({policy.clientName})<br />
              {/* Per head: the policyholder plus every dependant. */}
              Expected premium: ${policyBillablePremium(policy, policyCategory).toFixed(2)}{premiumPeriodLabel(policyCategory)}
              {billableHeadCount(policy, policyCategory) > 1 && (
                <> &nbsp;<span style={{ fontSize: 11 }}>({billableHeadCount(policy, policyCategory)} people on this policy)</span></>
              )}
            </div>
          )}
          {!policy && policyId && (
            <div className="info-banner info-banner-warning" style={{ marginBottom: '1rem' }}>
              Loading policy information…
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>Amount ($) *</label>
              <input type="number" className="form-control" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Payment Method *</label>
              <select className="form-control" value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} disabled={useSplit}>
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          {editing && (
            <div className="form-row">
              <div className="form-group">
                <label>Status</label>
                <select className="form-control" value={status} onChange={e => setStatus(e.target.value as PaymentStatus)}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Date</label>
                <DateInput value={date} onChange={setDate} />
              </div>
            </div>
          )}
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="split" checked={useSplit} onChange={e => setUseSplit(e.target.checked)} />
            <label htmlFor="split" style={{ marginBottom: 0, cursor: 'pointer' }}>Split payment across multiple methods</label>
          </div>
          {useSplit && (
            <div style={{ marginTop: '0.75rem' }}>
              {splits.map((s, i) => (
                <div key={i} className="form-row" style={{ marginBottom: 8, alignItems: 'center' }}>
                  <select className="form-control" value={s.method} onChange={e => updateSplit(i, 'method', e.target.value)}>
                    {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input type="number" className="form-control" placeholder="Amount" value={s.amount || ''} onChange={e => updateSplit(i, 'amount', e.target.value)} />
                  {splits.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeSplit(i)} title="Remove method">✕</button>
                  )}
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={addSplit}>+ Add Method</button>
              <p style={{ fontSize: 12, marginTop: 6, color: splitMismatch ? 'var(--danger)' : 'var(--muted)' }}>
                Split total: ${splitTotal.toFixed(2)} {splitMismatch && `(must equal the amount $${Number(amount || 0).toFixed(2)})`}
              </p>
            </div>
          )}
          {blockedReason && (amount.trim() || policyId) && (
            <p style={{ fontSize: 12, color: 'var(--danger)', margin: '10px 0 0' }}>{blockedReason}</p>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!!blockedReason}>
            {editing ? 'Save Changes' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}
