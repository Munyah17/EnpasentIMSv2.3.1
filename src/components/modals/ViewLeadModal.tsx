import { useState } from 'react'
import type { Lead, LeadStatus } from '../../types'
import { formatDate } from '../../lib/dateUtils'

interface Props {
  lead: Lead
  onClose: () => void
  onSave: (lead: Lead) => void
}

export default function ViewLeadModal({ lead, onClose, onSave }: Props) {
  const [status, setStatus] = useState<LeadStatus>(lead.status)
  const [notes, setNotes] = useState(lead.notes ?? '')

  const handleSave = () => {
    onSave({
      ...lead,
      status,
      notes,
      lastContact: new Date().toISOString().split('T')[0],
    })
  }

  const intentColor = lead.intentScore >= 80 ? 'var(--teal)' : lead.intentScore >= 50 ? 'var(--gold)' : 'var(--danger)'

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h3>Lead: {lead.name}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item"><span className="detail-label">Name</span><span>{lead.name}</span></div>
            <div className="detail-item"><span className="detail-label">Phone</span><span>{lead.phone}</span></div>
            <div className="detail-item"><span className="detail-label">Email</span><span>{lead.email ?? '—'}</span></div>
            <div className="detail-item"><span className="detail-label">Source</span><span>{lead.source}</span></div>
            <div className="detail-item"><span className="detail-label">Interest</span><span>{lead.productInterest}</span></div>
            <div className="detail-item">
              <span className="detail-label">Intent Score</span>
              <span style={{ color: intentColor, fontWeight: 600 }}>{lead.intentScore}%</span>
            </div>
            <div className="detail-item"><span className="detail-label">Created</span><span>{formatDate(lead.createdAt)}</span></div>
            <div className="detail-item"><span className="detail-label">Last Contact</span><span>{lead.lastContact ?? '—'}</span></div>
          </div>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label>Update Status</label>
            <select className="form-control" value={status} onChange={e => setStatus(e.target.value as LeadStatus)}>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="proposal">Proposal Sent</option>
              <option value="converted">Converted</option>
              <option value="lost">Lost</option>
            </select>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea className="form-control" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add contact notes…" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Lead</button>
        </div>
      </div>
    </div>
  )
}
