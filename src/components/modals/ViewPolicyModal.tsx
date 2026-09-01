import { useState, useEffect } from 'react'
import type { Policy } from '../../types'
import { formatDate } from '../../lib/dateUtils'
import { premiumPeriodLabel } from '../../lib/productUtils'
import { policyBillablePremium, billableHeadCount } from '../../lib/premium'
import { holderMemberNumber, dependantMemberNumber } from '../../lib/memberNumbers'
import { paymentCurrencyStatus, PAYMENT_CURRENCY_LABEL, PAYMENT_CURRENCY_CLASS } from '../../lib/policyLifecycle'
import { db } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'
import PolicyAssessmentModal from './PolicyAssessmentModal'

interface Props {
  policy: Policy
  onClose: () => void
  onEdit: () => void
  /** Omitted when the policy's product isn't loaded yet or is a funeral
   *  package — printed reports aren't offered for those. */
  onPrint?: () => void
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

export default function ViewPolicyModal({ policy, onClose, onEdit, onPrint, showToast }: Props) {
  const { hasPermission } = useAuth()
  const [category, setCategory] = useState('')
  const [showAssessment, setShowAssessment] = useState(false)

  useEffect(() => {
    db.products.list().then(({ data }) => {
      setCategory(data?.find(p => p.id === policy.productId)?.category ?? '')
    })
  }, [policy.productId])

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Policy: {policy.policyNumber}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item"><span className="detail-label">Policy Number</span><span className="mono">{policy.policyNumber}</span></div>
            <div className="detail-item">
              <span className="detail-label">Status</span>
              <span>
                <span className={`pill pill-${policy.status}`}>{policy.status.replace('_', ' ')}</span>
                <span className={`pill pill-inline ${PAYMENT_CURRENCY_CLASS[paymentCurrencyStatus(policy)]}`}>{PAYMENT_CURRENCY_LABEL[paymentCurrencyStatus(policy)]}</span>
              </span>
            </div>
            <div className="detail-item"><span className="detail-label">Client</span><span>{policy.clientName} <span className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{holderMemberNumber(policy.policyNumber)}</span></span></div>
            <div className="detail-item"><span className="detail-label">Product</span><span>{policy.productName}</span></div>
            {/* Premiums are per head, so the amount billed is the holder's
                own premium plus one for each dependant. Both are shown:
                the total is what is collected, the per-person figure is
                what a client queries. */}
            <div className="detail-item">
              <span className="detail-label">Premium Billed</span>
              <span>
                ${policyBillablePremium(policy, category).toFixed(2)}{premiumPeriodLabel(category)}
                {billableHeadCount(policy, category) > 1 && (
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}> · {billableHeadCount(policy, category)} people (${policy.premium.toFixed(2)} policyholder)</span>
                )}
              </span>
            </div>
            <div className="detail-item"><span className="detail-label">Cover Amount</span><span>${policy.coverAmount.toLocaleString()}</span></div>
            <div className="detail-item"><span className="detail-label">Start Date</span><span>{formatDate(policy.startDate)}</span></div>
            <div className="detail-item"><span className="detail-label">End Date</span><span>{formatDate(policy.endDate)}</span></div>
            <div className="detail-item"><span className="detail-label">Payment Method</span><span>{policy.paymentMethod}</span></div>
            {policy.growerNumber && (
              <div className="detail-item"><span className="detail-label">Grower Number</span><span>{policy.growerNumber}</span></div>
            )}
            <div className="detail-item"><span className="detail-label">Next Payment</span><span>{formatDate(policy.nextPaymentDate)}</span></div>
            <div className="detail-item"><span className="detail-label">Last Payment</span><span>{formatDate(policy.lastPaymentDate)}</span></div>
            <div className="detail-item"><span className="detail-label">Agent</span><span>{policy.agentName ?? '—'}</span></div>
          </div>

          {policy.dependants.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <h4 style={{ marginBottom: '0.75rem' }}>Dependants</h4>
              <table className="table">
                <thead><tr><th>Member No.</th><th>Name</th><th>Relationship</th><th>Date of Birth</th><th>ID Number</th><th>Plan</th><th>Premium</th></tr></thead>
                <tbody>
                  {policy.dependants.map((d, i) => (
                    <tr key={i}>
                      <td className="mono">{dependantMemberNumber(policy.policyNumber, i)}</td>
                      <td>{d.name}</td>
                      <td>{d.relationship}</td>
                      <td>{formatDate(d.dob)}</td>
                      <td>{d.nationalId}</td>
                      <td>{d.productName ?? policy.productName}</td>
                      <td>${(d.premium ?? policy.premium).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(category === 'agriculture' || category === 'motor') && hasPermission('claims.physical_assessment') && (
            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAssessment(true)}>
                {category === 'motor' ? '🚗 Record Pre-Loss Assessment' : '🌾 Record Pre-Loss Assessment'}
              </button>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {category === 'motor'
                  ? "Establishes the vehicle's condition baseline for later fraud checks against any claim."
                  : 'Establishes the crop/farm baseline for later fraud checks against any claim.'}
              </p>
            </div>
          )}
        </div>
        <div className="modal-footer view-policy-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {onPrint && <button className="btn btn-success view-policy-print-btn" onClick={onPrint}>🖨 Print Policy Doc</button>}
          <button className="btn btn-primary" onClick={onEdit}>Edit Policy</button>
        </div>
      </div>
      {showAssessment && (
        <PolicyAssessmentModal
          policyId={policy.id}
          policyNumber={policy.policyNumber}
          subjectType={category === 'motor' ? 'vehicle' : 'agriculture'}
          onClose={() => setShowAssessment(false)}
          onSubmitted={() => setShowAssessment(false)}
          showToast={showToast}
        />
      )}
    </div>
  )
}
