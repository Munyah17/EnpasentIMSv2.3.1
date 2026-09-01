import { useState, useEffect } from 'react'
import type { Client, Insurer, InsurerRecord } from '../../types'
import { db } from '../../lib/db'
import PhoneInput from '../ui/PhoneInput'

interface Props {
  client: Client
  onClose: () => void
  onSave: (client: Client) => void
  onAssignPolicy: () => void
}

export default function EditClientModal({ client, onClose, onSave, onAssignPolicy }: Props) {
  const [name, setName] = useState(client.name)
  const [email, setEmail] = useState(client.email)
  const [phone, setPhone] = useState(client.phone)
  const [address, setAddress] = useState(client.address)
  const [occupation, setOccupation] = useState(client.occupation ?? '')
  const [insurer, setInsurer] = useState<Insurer | ''>(client.insurer ?? '')
  const [status, setStatus] = useState(client.status)
  const [insurerOptions, setInsurerOptions] = useState<InsurerRecord[]>([])

  useEffect(() => {
    db.insurers.list().then(({ data }) => setInsurerOptions(data.filter(i => i.status === 'active')))
  }, [])

  const handleSave = () => {
    onSave({ ...client, name, email, phone, address, occupation, insurer: insurer || undefined, status })
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>Edit Client</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label>Full Name</label>
              <input className="form-control" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" className="form-control" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Phone</label>
              <PhoneInput value={phone} onChange={setPhone} />
            </div>
            <div className="form-group">
              <label>National ID</label>
              <input className="form-control" value={client.nationalId} disabled style={{ opacity: 0.6 }} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Occupation</label>
              <input className="form-control" value={occupation} onChange={e => setOccupation(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select className="form-control" value={status} onChange={e => setStatus(e.target.value as Client['status'])}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
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
          <div className="form-group">
            <label>Address</label>
            <input className="form-control" value={address} onChange={e => setAddress(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-success" onClick={onAssignPolicy}>+ Assign Policy</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  )
}
