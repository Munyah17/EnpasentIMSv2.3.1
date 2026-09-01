import { useState, useEffect } from 'react'
import type { ToastMessage, Ticket, TicketStatus, AppUser } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import { formatDate } from '../lib/dateUtils'
import NewTicketModal from '../components/modals/NewTicketModal'
import ViewTicketModal from '../components/modals/ViewTicketModal'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

const PRIORITY_CLASS: Record<string, string> = {
  low: 'priority-low',
  medium: 'priority-medium',
  high: 'priority-high',
  urgent: 'priority-urgent',
}

export default function Tickets({ showToast }: Props) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [staff, setStaff] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [viewTicket, setViewTicket] = useState<Ticket | null>(null)

  useEffect(() => {
    Promise.all([db.tickets.list(), db.staff.list()]).then(([ticketsRes, staffRes]) => {
      if (ticketsRes.error) showToast('error', 'Failed to load tickets.')
      else if (ticketsRes.data) setTickets(ticketsRes.data)
      if (staffRes.data) setStaff(staffRes.data)
      setLoading(false)
    })
  }, [showToast])

  const filtered = tickets.filter(t => {
    const matchStatus = statusFilter === 'all' || t.status === statusFilter
    const matchAssignee = !assigneeFilter || (assigneeFilter === 'unassigned' ? !t.assignedTo : t.assignedTo === assigneeFilter)
    const q = search.toLowerCase()
    const matchSearch = !q || t.ticketNumber.toLowerCase().includes(q) || t.clientName.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q)
    return matchStatus && matchAssignee && matchSearch
  })

  const counts = {
    all: tickets.length,
    open: tickets.filter(t => t.status === 'open').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
    closed: tickets.filter(t => t.status === 'closed').length,
  }

  const handleAdd = async (ticket: Ticket) => {
    const { data, error } = await db.tickets.create(ticket)
    if (error || !data) { showToast('error', 'Failed to create ticket.'); return }
    setTickets(prev => [data, ...prev])
    showToast('success', `Ticket ${data.ticketNumber} created.`)
    setShowNew(false)
  }

  const handleUpdate = async (updated: Ticket) => {
    const { data, error } = await db.tickets.update(updated.id, updated)
    if (error || !data) { showToast('error', 'Failed to update ticket.'); return }
    setTickets(prev => prev.map(t => t.id === data.id ? data : t))
    showToast('success', `Ticket ${data.ticketNumber} updated.`)
    setViewTicket(null)
  }

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="filter-row">
          <input
            className="search-input"
            placeholder="Search ticket number, client, subject…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select title="Filter by status" className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value as TicketStatus | 'all')}>
            <option value="all">All ({counts.all})</option>
            <option value="open">Open ({counts.open})</option>
            <option value="in_progress">In Progress ({counts.in_progress})</option>
            <option value="resolved">Resolved ({counts.resolved})</option>
            <option value="closed">Closed ({counts.closed})</option>
          </select>
          <select title="Filter by assignee" className="filter-select" value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}>
            <option value="">All Staff</option>
            <option value="unassigned">Unassigned</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>+ New Ticket</button>
      </div>

      {loading ? (
        <div className="empty-state">Loading tickets…</div>
      ) : (
        <div className="tickets-list">
          {filtered.length === 0 ? (
            <div className="empty-state">No tickets found.</div>
          ) : filtered.map(t => (
            <div
              key={t.id}
              className="ticket-card"
              onClick={() => setViewTicket(t)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setViewTicket(t)}
            >
              <div className="ticket-card-header">
                <div>
                  <span className="ticket-number mono">{t.ticketNumber}</span>
                  <span className="ticket-subject">{t.subject}</span>
                </div>
                <div className="ticket-meta-right">
                  <span className={`pill ${PRIORITY_CLASS[t.priority]}`}>{t.priority}</span>
                  <span className={`pill pill-${t.status.replace('_', '-')}`}>{t.status.replace('_', ' ')}</span>
                </div>
              </div>
              <div className="ticket-card-body">
                <span className="ticket-client">👤 {t.clientName}</span>
                <span className="ticket-category">🏷 {t.category}</span>
                {t.assignedName && <span className="ticket-assigned">→ {t.assignedName}</span>}
                <span className="ticket-date">{formatDate(t.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <NewTicketModal onClose={() => setShowNew(false)} onSave={handleAdd} />
      )}
      {viewTicket && (
        <ViewTicketModal
          ticket={viewTicket}
          staff={staff}
          onClose={() => setViewTicket(null)}
          onSave={handleUpdate}
        />
      )}
    </div>
  )
}
