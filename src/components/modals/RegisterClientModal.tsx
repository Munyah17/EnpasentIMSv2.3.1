import { useState, useEffect } from 'react'
import type { Client, Insurer, InsurerRecord } from '../../types'
import { db } from '../../lib/db'
import PhoneInput from '../ui/PhoneInput'
import DateInput from '../ui/DateInput'
import InsurerSelect from '../ui/InsurerSelect'
import { resolveClientInsurer } from '../../lib/insurerAssignment'

interface Props {
  onClose: () => void
  onSave: (client: Client) => void
}

export default function RegisterClientModal({ onClose, onSave }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [dob, setDob] = useState('')
  const [address, setAddress] = useState('')
  const [occupation, setOccupation] = useState('')
  const [insurer, setInsurer] = useState<Insurer | ''>('')
  const [insurerOptions, setInsurerOptions] = useState<InsurerRecord[]>([])

  useEffect(() => {
    db.insurers.list().then(({ data }) => setInsurerOptions(data.filter(i => i.status === 'active')))
  }, [])

  const handleSave = () => {
    if (!name || !phone || !nationalId) return
    // Insurer is optional. Left blank, the client is provisionally placed
    // with the house insurer and flagged so staff know to ask -- registering
    // a client puts no cover in place, so nothing has been decided for them
    // yet. See src/lib/insurerAssignment.ts.
    const { insurer: assignedInsurer, insurerProvisional } = resolveClientInsurer(insurer, insurerOptions)
    const client: Client = {
      id: `c${Date.now()}`,
      name, email, phone, nationalId, dob, address, occupation,
      insurer: assignedInsurer, insurerProvisional,
      createdAt: new Date().toISOString().split('T')[0],
      policyCount: 0,
      status: 'active',
    }
    onSave(client)
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Register New Client</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label>Full Name *</label>
              <input className="form-control" placeholder="e.g. John Doe" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input type="email" className="form-control" placeholder="john@email.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Phone Number *</label>
              <PhoneInput value={phone} onChange={setPhone} />
            </div>
            <div className="form-group">
              <label>National ID *</label>
              <input className="form-control" placeholder="e.g. 632118532K12" value={nationalId} onChange={e => setNationalId(e.target.value.replace(/-/g, ''))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Date of Birth</label>
              <DateInput value={dob} onChange={setDob} />
            </div>
            <div className="form-group">
              <label>Occupation</label>
              <input className="form-control" placeholder="e.g. Teacher" value={occupation} onChange={e => setOccupation(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Insurer <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
            <InsurerSelect value={insurer} onChange={v => setInsurer(v as Insurer)} options={insurerOptions} />
          </div>
          <div className="form-group">
            <label>Address</label>
            <input className="form-control" placeholder="Street address, city" value={address} onChange={e => setAddress(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!name || !phone || !nationalId}>
            Register Client
          </button>
        </div>
      </div>
    </div>
  )
}
