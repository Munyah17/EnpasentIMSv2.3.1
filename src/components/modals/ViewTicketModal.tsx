import { useState } from 'react'
import type { Ticket, TicketStatus, TicketPriority, TicketMessage, AppUser } from '../../types'
import { ROLE_RANK } from '../../types'
import { useAuth } from '../../contexts/AuthContext'
import { formatDateTime } from '../../lib/dateUtils'

interface Props {
  ticket: Ticket
  staff: AppUser[]
  onClose: () => void
  onSave: (ticket: Ticket) => void
}

export default function ViewTicketModal({ ticket, staff, onClose, onSave }: Props) {
  const { user } = useAuth()
  const [status, setStatus] = useState<TicketStatus>(ticket.status)
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority)
  const [assignedTo, setAssignedTo] = useState(ticket.assignedTo ?? '')
  const [reply, setReply] = useState('')
  const [messages, setMessages] = useState<TicketMessage[]>(ticket.messages)

  // A staff member can only delegate to their own rank or below — never
  // upward. Peers (the four work roles) all share a rank, so delegating
  // sideways within the team is fine; only genuine seniors can delegate
  // down to a subordinate role.
  const myRank = user ? ROLE_RANK[user.role] : 0
  const delegateTargets = staff.filter(s => ROLE_RANK[s.role] <= myRank)

  const sendReply = () => {
    if (!reply.trim()) return
    const msg: TicketMessage = {
      id: `m${Date.now()}`,
      senderId: 'staff',
      senderName: staff.find(s => s.id === assignedTo)?.name ?? 'Support',
      message: reply,
      timestamp: new Date().toISOString(),
      isStaff: true,
    }
    setMessages(prev => [...prev, msg])
    setReply('')
  }

  const handleSave = () => {
    let finalMessages = messages
    const newAssignee = staff.find(s => s.id === assignedTo)
    if (assignedTo !== (ticket.assignedTo ?? '') && user) {
      const note: TicketMessage = {
        id: `m${Date.now()}`,
        senderId: 'system',
        senderName: 'System',
        message: newAssignee
          ? `${user.name} delegated this ticket to ${newAssignee.name}.`
          : `${user.name} unassigned this ticket.`,
        timestamp: new Date().toISOString(),
        isStaff: true,
      }
      finalMessages = [...finalMessages, note]
    }
    onSave({
      ...ticket,
      status,
      priority,
      assignedTo: assignedTo || undefined,
      assignedName: newAssignee?.name,
      messages: finalMessages,
      updatedAt: new Date().toISOString(),
    })
  }

  const formatTime = (ts: string) => formatDateTime(ts)

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <div>
            <h3>{ticket.subject}</h3>
            <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{ticket.ticketNumber} · {ticket.clientName}</span>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-row" style={{ marginBottom: '1rem' }}>
            <div className="form-group">
              <label>Status</label>
              <select className="form-control" value={status} onChange={e => setStatus(e.target.value as TicketStatus)}>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select className="form-control" value={priority} onChange={e => setPriority(e.target.value as TicketPriority)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label>Delegate To</label>
            <select className="form-control" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
              <option value="">Unassigned</option>
              {delegateTargets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Only staff at your level or below can be delegated to. Delegating logs a note in the thread below.
            </p>
          </div>

          <div className="ticket-thread">
            {messages.map(m => (
              <div key={m.id} className={`thread-message${m.isStaff ? ' staff' : ''}`}>
                <div className="thread-meta">
                  <strong>{m.senderName}</strong>
                  {m.isStaff && <span className="pill pill-active" style={{ fontSize: '0.65rem' }}>Staff</span>}
                  <span className="text-muted" style={{ fontSize: '0.75rem' }}>{formatTime(m.timestamp)}</span>
                </div>
                <div className="thread-body">{m.message}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '1rem' }}>
            <div className="form-group">
              <label>Reply</label>
              <textarea className="form-control" rows={3} value={reply} onChange={e => setReply(e.target.value)} placeholder="Type your reply…" />
            </div>
            <button className="btn btn-ghost btn-sm" onClick={sendReply} disabled={!reply.trim()}>Send Reply</button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save & Update</button>
        </div>
      </div>
    </div>
  )
}
