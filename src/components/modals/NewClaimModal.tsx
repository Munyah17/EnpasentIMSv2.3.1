import { useState, useEffect } from 'react'
import type { Claim, Policy, Client, Product } from '../../types'
import { db } from '../../lib/db'
import { scoreClaimFraud } from '../../lib/aiService'
import { uploadDocument, deleteDocument, ACCEPTED_DOCUMENT_TYPES } from '../../lib/storage'
import DateInput from '../ui/DateInput'
import ValidationSummary, { fieldId, invalidClass, isMissing, scrollToField } from '../ui/ValidationSummary'
import type { MissingField } from '../ui/ValidationSummary'
import FraudNoticeModal from './FraudNoticeModal'

interface Props {
  onClose: () => void
  onSave: (claim: Claim) => void
  showToast?: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
  /** Bubble-toggle at the top switches between this modal and
   *  NewAgricultureClaimModal — same trigger, same accessibility, but
   *  agriculture gets its own dedicated modal given how much more it needs
   *  to capture (6+ damage photos, GPS, farmer + assessor signatures). */
  claimKind?: 'ordinary' | 'agriculture'
  onSwitchKind?: (kind: 'ordinary' | 'agriculture') => void
}

interface DocSlot {
  label: string
  path: string | null
  uploading: boolean
}

export default function NewClaimModal({ onClose, onSave, showToast, claimKind, onSwitchKind }: Props) {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [allClaims, setAllClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [policyNumberInput, setPolicyNumberInput] = useState('')
  const [claimType, setClaimType] = useState('Death Benefit')
  const [amount, setAmount] = useState('')
  const [dateOfEvent, setDateOfEvent] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  // National ID and one supporting document (burial order / doctor's note /
  // police report — whichever applies) are compulsory; "+ Upload More" adds
  // one additional slot at a time, same pattern throughout.
  const [docSlots, setDocSlots] = useState<DocSlot[]>([
    { label: 'National ID', path: null, uploading: false },
    { label: 'Claim Document 1', path: null, uploading: false },
  ])
  // Stable for the life of this form so uploaded files land in one folder,
  // even though it isn't the real claim id the DB will assign on insert —
  // staff Storage access isn't scoped by it (see add_document_storage.sql).
  const [draftId] = useState(() => `cl${Date.now()}`)

  useEffect(() => {
    Promise.all([db.policies.list(), db.claims.list(), db.products.list()]).then(([polRes, claimRes, prodRes]) => {
      if (polRes.data) setPolicies(polRes.data)
      if (claimRes.data) setAllClaims(claimRes.data)
      if (prodRes.data) setProducts(prodRes.data)
      setLoading(false)
    })
  }, [])

  const categoryOf = (p: Policy) => products.find(pr => pr.id === p.productId)?.category ?? ''
  // Agriculture is deliberately absent here. Its claim is a physical loss
  // assessment — leaf counts, photos, GPS, both signatures — and the payable
  // amount is derived from them, so a crop loss filed on this form would
  // skip all of it and go in for the full sum insured.
  const ordinaryPolicies = policies.filter(p => categoryOf(p) !== 'agriculture')
  const typedNumber = policyNumberInput.trim().toLowerCase()
  const policy = ordinaryPolicies.find(p => p.policyNumber.toLowerCase() === typedNumber)
  const agriculturePolicyTyped = !policy && !!typedNumber
    ? policies.find(p => p.policyNumber.toLowerCase() === typedNumber && categoryOf(p) === 'agriculture')
    : undefined
  const policyId = policy?.id ?? ''
  const category = policy ? categoryOf(policy) : ''
  const [client, setClient] = useState<Client | null>(null)

  // Auto-fill amount and client details when a policy is matched
  useEffect(() => {
    if (policy) {
      setAmount(policy.coverAmount.toString())
      db.clients.get(policy.clientId).then(({ data }) => setClient(data))
    } else {
      setAmount('')
      setClient(null)
    }
  }, [policy])

  const CLAIM_TYPES = ['Death Benefit', 'Hospitalisation', 'Accidental Injury', 'Disability Benefit', 'Repatriation', 'Other']

  const addDocSlot = () => {
    const claimDocCount = docSlots.filter(s => s.label.startsWith('Claim Document')).length
    setDocSlots(prev => [...prev, { label: `Claim Document ${claimDocCount + 1}`, path: null, uploading: false }])
  }

  const handleSlotFile = async (index: number, file: File | null) => {
    if (!file) return
    const label = docSlots[index].label
    setDocSlots(prev => prev.map((s, i) => i === index ? { ...s, uploading: true } : s))
    // Bake the slot's label into the stored filename — documents is a flat
    // TEXT[] of paths, this is how "which document is this" survives without
    // a schema change.
    const renamed = new File([file], `${label.replace(/\s+/g, '-')}_${file.name}`, { type: file.type })
    const { data, error } = await uploadDocument('claims', draftId, renamed)
    if (error) {
      if (showToast) showToast('error', error)
      setDocSlots(prev => prev.map((s, i) => i === index ? { ...s, uploading: false } : s))
      return
    }
    setDocSlots(prev => prev.map((s, i) => i === index ? { ...s, path: data!.path, uploading: false } : s))
  }

  const removeSlotFile = async (index: number) => {
    const slot = docSlots[index]
    if (slot.path) await deleteDocument(slot.path)
    setDocSlots(prev => prev.map((s, i) => i === index ? { ...s, path: null } : s))
  }

  /** Removes an extra "+ Upload More" slot entirely (not just its file) —
   *  the 2 compulsory slots can't be removed this way. */
  const removeSlot = async (index: number) => {
    const slot = docSlots[index]
    if (slot.path) await deleteDocument(slot.path)
    setDocSlots(prev => prev.filter((_, i) => i !== index))
  }

  const [showFraudNotice, setShowFraudNotice] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const missing: MissingField[] = []
  if (!policyId) {
    missing.push({
      key: 'policyNumber',
      label: 'Policy Number',
      hint: agriculturePolicyTyped ? 'that is an agriculture policy; use the Agriculture Claims form.' : 'must match an existing policy.',
    })
  }
  if (!(Number(amount) > 0)) missing.push({ key: 'amount', label: 'Claim Amount', hint: amount ? 'must be greater than zero.' : undefined })
  if (!dateOfEvent) missing.push({ key: 'dateOfEvent', label: 'Date of Event' })
  if (!description.trim()) missing.push({ key: 'description', label: 'Description' })
  if (!docSlots[0]?.path) missing.push({ key: 'documents', label: 'National ID document' })
  if (!docSlots[1]?.path) missing.push({ key: 'documents', label: 'Claim Document 1' })

  /** Checked before the fraud declaration, so nobody is asked to sign off a
   *  submission that was going to be refused anyway. */
  const handleAttemptSubmit = () => {
    setAttempted(true)
    if (missing.length > 0) {
      showToast?.('error', `Not submitted: ${missing.length} required ${missing.length === 1 ? 'field is' : 'fields are'} missing — ${missing.map(m => m.label).join(', ')}.`)
      scrollToField(missing[0].key)
      return
    }
    setShowFraudNotice(true)
  }

  const handleSave = async () => {
    if (missing.length > 0 || !policy || saving) return
    setSaving(true)
    const dateSubmitted = new Date().toISOString().split('T')[0]
    const priorClaimsOnPolicy = allClaims.filter(c => c.policyId === policyId).length
    let fraudScore = 20
    let signals: string[] = []
    try {
      const result = await scoreClaimFraud({
        claimType, amount: Number(amount), coverAmount: policy.coverAmount,
        dateOfEvent, policyStartDate: policy.startDate, dateSubmitted, description, priorClaimsOnPolicy,
      })
      if (result.unavailable) {
        // fraud_score is NOT NULL, so the claim keeps the neutral baseline
        // above — but it is recorded as unscored rather than passed off as
        // a low-risk assessment nobody actually made.
        signals = ['Not risk-assessed: AI fraud scoring was unavailable when this claim was submitted.']
      } else {
        fraudScore = result.score
        signals = result.signals
      }
    } finally {
      const claimNumber = `CLM${new Date().getFullYear()}${String(Date.now()).slice(-3)}`
      const claim: Claim & { fraudSignals?: string[] } = {
        id: draftId,
        claimNumber,
        policyId,
        policyNumber: policy.policyNumber,
        clientId: policy.clientId,
        clientName: policy.clientName,
        productName: policy.productName,
        claimType,
        amount: Number(amount),
        status: 'pending',
        stage: 'intake',
        category: category || undefined,
        agentId: policy.agentId,
        agentName: policy.agentName,
        dateOfEvent,
        dateSubmitted,
        description,
        fraudScore,
        documents: docSlots.filter(s => s.path).map(s => s.path as string),
        fraudSignals: signals,
      }
      setSaving(false)
      onSave(claim)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>New Claim</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {onSwitchKind && (
            <div className="form-group">
              <div className="bubble-toggle">
                <button type="button" className={`bubble-toggle-btn${claimKind === 'ordinary' ? ' active' : ''}`} onClick={() => onSwitchKind('ordinary')}>Ordinary Claims</button>
                <button type="button" className={`bubble-toggle-btn${claimKind === 'agriculture' ? ' active' : ''}`} onClick={() => onSwitchKind('agriculture')}>Agriculture Claims</button>
              </div>
            </div>
          )}
          <ValidationSummary missing={missing} attempted={attempted} />

          <div className="form-group" id={fieldId('policyNumber')}>
            <label>Policy Number *</label>
            <input
              className={invalidClass(missing, attempted, 'policyNumber')}
              list="claim-policy-numbers"
              placeholder={loading ? 'Loading policies…' : 'Enter or select a policy number'}
              value={policyNumberInput}
              onChange={e => setPolicyNumberInput(e.target.value)}
              disabled={loading}
            />
            <datalist id="claim-policy-numbers">
              {ordinaryPolicies.map(p => <option key={p.id} value={p.policyNumber} />)}
            </datalist>
          </div>
          {agriculturePolicyTyped && !loading && (
            <div className="info-banner info-banner-warning" style={{ marginBottom: '1rem' }}>
              <strong>{agriculturePolicyTyped.policyNumber} is an agriculture policy.</strong> Crop and barn losses are
              claimed through the agriculture form, which captures the site assessment the payout is calculated from.
              {onSwitchKind && (
                <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 8, display: 'block' }} onClick={() => onSwitchKind('agriculture')}>
                  Switch to Agriculture Claims
                </button>
              )}
            </div>
          )}
          {policyNumberInput.trim() && !policy && !agriculturePolicyTyped && !loading && (
            <div className="info-banner info-banner-warning" style={{ marginBottom: '1rem' }}>
              No policy found with that number.
            </div>
          )}
          {policy && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Client Name</label>
                  <input className="form-control" value={policy.clientName} disabled style={{ opacity: 0.6 }} />
                </div>
                <div className="form-group">
                  <label>National ID</label>
                  <input className="form-control" value={client?.nationalId ?? '—'} disabled style={{ opacity: 0.6 }} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Phone Number</label>
                  <input className="form-control" value={client?.phone ?? '—'} disabled style={{ opacity: 0.6 }} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input className="form-control" value={client?.email || '—'} disabled style={{ opacity: 0.6 }} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Product / Package</label>
                  <input className="form-control" value={policy.productName} disabled style={{ opacity: 0.6 }} />
                </div>
                <div className="form-group">
                  <label>Policy Status</label>
                  <input className="form-control" value={policy.status} disabled style={{ opacity: 0.6, textTransform: 'capitalize' }} />
                </div>
              </div>
              <div className="form-group">
                <label>Max Cover</label>
                <input className="form-control" value={`$${policy.coverAmount.toLocaleString()}`} disabled style={{ opacity: 0.6 }} />
              </div>
            </>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>Claim Type *</label>
              <select className="form-control" value={claimType} onChange={e => setClaimType(e.target.value)}>
                {CLAIM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group" id={fieldId('amount')}>
              <label>Claim Amount ($) *</label>
              <input
                type="number" className={invalidClass(missing, attempted, 'amount')} min={0} value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="Auto-filled from policy"
                disabled={!!policy}
                style={policy ? { opacity: 0.6 } : undefined}
              />
            </div>
          </div>
          <div className="form-group" id={fieldId('dateOfEvent')}>
            <label>Date of Event *</label>
            <div className={isMissing(missing, attempted, 'dateOfEvent') ? 'field-invalid-block' : undefined}>
              <DateInput value={dateOfEvent} onChange={setDateOfEvent} />
            </div>
          </div>
          <div className="form-group" id={fieldId('description')}>
            <label>Description *</label>
            <textarea className={invalidClass(missing, attempted, 'description')} rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the incident…" />
          </div>
          <div className={`form-group${isMissing(missing, attempted, 'documents') ? ' field-invalid-block' : ''}`} id={fieldId('documents')}>
            <label>Supporting Documents</label>
            {docSlots.map((slot, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, width: 130, flexShrink: 0 }}>{slot.label} *</span>
                {slot.path ? (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--success)', flex: 1 }}>✓ Uploaded</span>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeSlotFile(i)}>Remove</button>
                  </>
                ) : (
                  <input
                    type="file"
                    accept={ACCEPTED_DOCUMENT_TYPES}
                    disabled={slot.uploading}
                    onChange={e => handleSlotFile(i, e.target.files?.[0] ?? null)}
                    style={{ fontSize: 11, flex: 1 }}
                  />
                )}
                {slot.uploading && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Uploading…</span>}
                {i >= 2 && !slot.path && (
                  <button type="button" onClick={() => removeSlot(i)} title="Remove this slot" style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 }}>✕</button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={addDocSlot} style={{ marginTop: 4 }}>+ Upload More</button>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>PDF, Word, CSV, Excel, RTF, PNG, JPEG, JPG, or WEBP (up to 10MB each).</p>
          </div>

          <ValidationSummary missing={missing} attempted={attempted} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAttemptSubmit} disabled={saving}>
            {saving ? 'Analysing & Submitting…' : 'Submit Claim'}
          </button>
        </div>
      </div>
      {showFraudNotice && (
        <FraudNoticeModal
          confirming={saving}
          onCancel={() => setShowFraudNotice(false)}
          onConfirm={() => { setShowFraudNotice(false); void handleSave() }}
        />
      )}
    </div>
  )
}
