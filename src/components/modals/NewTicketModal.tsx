import { useState, useEffect } from 'react'
import type { Ticket, Client, TicketPriority } from '../../types'
import { db } from '../../lib/db'

interface Props {
  onClose: () => void
  onSave: (ticket: Ticket) => void
}

const PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent']
const CATEGORIES = ['Technical', 'Claims', 'Policy', 'Billing', 'Other']

export default function NewTicketModal({ onClose, onSave }: Props) {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [clientId, setClientId] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TicketPriority>('medium')
  const [category, setCategory] = useState('Policy')

  useEffect(() => {
    db.clients.list().then(({ data }) => {
      if (data) setClients(data)
      setLoading(false)
    })
  }, [])

  const client = clients.find(c => c.id === clientId)

  const handleSave = () => {
    if (!clientId || !subject || !description) return
    const ticketNumber = `TKT${new Date().getFullYear()}${String(Date.now()).slice(-3)}`
    const ticket: Ticket = {
      id: `t${Date.now()}`,
      ticketNumber,
      clientId,
      clientName: client!.name,
      subject,
      description,
      status: 'open',
      priority,
      category,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [{ id: `m${Date.now()}`, senderId: clientId, senderName: client!.name, message: description, timestamp: new Date().toISOString(), isStaff: false }],
    }
    onSave(ticket)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>New Support Ticket</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Client</label>
            {loading ? (
              <select className="form-control" disabled>
                <option>Loading clients…</option>
              </select>
            ) : (
              <select className="form-control" value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">Select client…</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                ))}
              </select>
            )}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Category</label>
              <select className="form-control" value={category} onChange={e => setCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select className="form-control" value={priority} onChange={e => setPriority(e.target.value as TicketPriority)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Subject *</label>
            <input className="form-control" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Brief description of the issue" />
          </div>
          <div className="form-group">
            <label>Description *</label>
            <textarea className="form-control" rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the issue in detail…" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!clientId || !subject || !description}>
            Create Ticket
          </button>
        </div>
      </div>
    </div>
  )
}
