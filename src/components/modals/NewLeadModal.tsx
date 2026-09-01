import { useState } from 'react'
import type { Lead } from '../../types'
import { scoreLead } from '../../lib/aiService'
import PhoneInput from '../ui/PhoneInput'

interface Props {
  onClose: () => void
  onSave: (lead: Omit<Lead, 'id'>) => void
}

const SOURCES = ['Referral', 'Walk-in', 'Phone Enquiry', 'WhatsApp', 'Facebook', 'Website', 'USSD *907#', 'Other']

export default function NewLeadModal({ onClose, onSave }: Props) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState(SOURCES[0])
  const [productInterest, setProductInterest] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim() || !phone.trim() || !productInterest.trim()) return
    setSaving(true)
    try {
      const { score } = await scoreLead({ name: name.trim(), source, productInterest: productInterest.trim(), notes: notes.trim() || undefined })
      onSave({
        name: name.trim(), phone: phone.trim(), email: email.trim() || undefined, source,
        productInterest: productInterest.trim(), status: 'new', intentScore: score,
        createdAt: new Date().toISOString(), notes: notes.trim() || undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3>Add Lead</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Full Name *</label>
            <input className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="Prospect's name" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Phone Number *</label>
              <PhoneInput value={phone} onChange={setPhone} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" className="form-control" value={email} onChange={e => setEmail(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Source</label>
              <select className="form-control" value={source} onChange={e => setSource(e.target.value)}>
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Product Interest *</label>
              <input className="form-control" value={productInterest} onChange={e => setProductInterest(e.target.value)} placeholder="e.g. Funeral Cover Basic" />
            </div>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea className="form-control" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything relevant, helps the AI score this lead more accurately." />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !name.trim() || !phone.trim() || !productInterest.trim()}>
            {saving ? 'Scoring with AI…' : 'Add Lead'}
          </button>
        </div>
      </div>
    </div>
  )
}
