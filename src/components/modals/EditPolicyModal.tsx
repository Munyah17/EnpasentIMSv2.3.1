import { useState, useEffect } from 'react'
import type { Policy, PolicyStatus, Insurer, InsurerRecord, AppUser } from '../../types'
import { MANUAL_PAYMENT_METHODS } from '../../types'
import { db } from '../../lib/db'
import DateInput from '../ui/DateInput'

interface Props {
  policy: Policy
  onClose: () => void
  onSave: (policy: Policy) => void
}

export default function EditPolicyModal({ policy, onClose, onSave }: Props) {
  const [status, setStatus] = useState<PolicyStatus>(policy.status)
  const [paymentMethod, setPaymentMethod] = useState(policy.paymentMethod)
  const [insurer, setInsurer] = useState<Insurer | ''>(policy.insurer ?? '')
  const [nextPaymentDate, setNextPaymentDate] = useState(policy.nextPaymentDate ?? '')
  const [agentId, setAgentId] = useState(policy.agentId ?? '')
  const [growerNumber, setGrowerNumber] = useState(policy.growerNumber ?? '')
  const [staff, setStaff] = useState<AppUser[]>([])
  const [isAgriculture, setIsAgriculture] = useState(false)
  const [insurerOptions, setInsurerOptions] = useState<InsurerRecord[]>([])

  useEffect(() => {
    db.staff.list().then(({ data }) => { if (data) setStaff(data.filter(s => s.active)) })
    db.products.list().then(({ data }) => {
      const category = data?.find(p => p.id === policy.productId)?.category
      setIsAgriculture(category === 'agriculture')
    })
    db.insurers.list().then(({ data }) => setInsurerOptions(data.filter(i => i.status === 'active')))
  }, [policy.productId])

  const handleSave = () => {
    const agent = staff.find(s => s.id === agentId)
    onSave({
      ...policy, status, paymentMethod, insurer: insurer || undefined, nextPaymentDate: nextPaymentDate || undefined,
      agentId: agentId || undefined, agentName: agent?.name ?? (agentId ? policy.agentName : undefined),
      growerNumber: isAgriculture ? (growerNumber || undefined) : policy.growerNumber,
    })
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h3>Edit Policy: {policy.policyNumber}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Client</label>
            <input className="form-control" value={policy.clientName} disabled style={{ opacity: 0.6 }} />
          </div>
          <div className="form-group">
            <label>Product</label>
            <input className="form-control" value={policy.productName} disabled style={{ opacity: 0.6 }} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Status</label>
              <select className="form-control" value={status} onChange={e => setStatus(e.target.value as PolicyStatus)}>
                <option value="active">Active</option>
                <option value="waiting_period">Waiting Period</option>
                <option value="lapsed">Lapsed</option>
                <option value="pending">Pending</option>
                <option value="cancelled">Cancelled</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div className="form-group">
              <label>Payment Method</label>
              <select className="form-control" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                {MANUAL_PAYMENT_METHODS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Insurer</label>
            <select className="form-control" value={insurer} onChange={e => setInsurer(e.target.value as Insurer)}>
              <option value="">Select insurer…</option>
              {insurerOptions.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}
            </select>
          </div>
          {isAgriculture && (
            <div className="form-group">
              <label>Grower Number</label>
              <input className="form-control" placeholder="Grower registration number" value={growerNumber} onChange={e => setGrowerNumber(e.target.value)} />
            </div>
          )}
          <div className="form-group">
            <label>Next Payment Date</label>
            <DateInput value={nextPaymentDate} onChange={setNextPaymentDate} />
          </div>
          <div className="form-group">
            <label>Agent</label>
            <select className="form-control" value={agentId} onChange={e => setAgentId(e.target.value)}>
              <option value="">Unassigned</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role.replace(/_/g, ' ')})</option>)}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  )
}
