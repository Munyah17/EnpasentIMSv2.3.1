import { useState, useEffect } from 'react'
import type { ToastMessage, Payment, PaymentMethod, PaymentStatus } from '../types'
import { PAYMENT_METHODS } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import { formatDate } from '../lib/dateUtils'
import { useAuth } from '../contexts/AuthContext'
import { recordActivity } from '../lib/activityLog'
import RecordPaymentModal from '../components/modals/RecordPaymentModal'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

const STATUS_CLASS: Record<PaymentStatus, string> = {
  completed: 'pill-active',
  pending: 'pill-pending',
  failed: 'pill-lapsed',
  reversed: 'pill-cancelled',
}

export default function Payments({ showToast }: Props) {
  const { hasPermission, user } = useAuth()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | 'all'>('all')
  const [showRecord, setShowRecord] = useState(false)
  const [editPayment, setEditPayment] = useState<Payment | null>(null)

  useEffect(() => {
    db.payments.list().then(({ data, error }) => {
      if (error) showToast('error', 'Failed to load payments.')
      else if (data) setPayments(data)
      setLoading(false)
    })
  }, [showToast])

  const filtered = payments.filter(p => {
    const matchSearch = p.reference.toLowerCase().includes(search.toLowerCase()) ||
      p.clientName.toLowerCase().includes(search.toLowerCase()) ||
      p.policyNumber.toLowerCase().includes(search.toLowerCase())
    const matchMethod = methodFilter === 'all' || p.method === methodFilter
    const matchStatus = statusFilter === 'all' || p.status === statusFilter
    return matchSearch && matchMethod && matchStatus
  })

  const totalCollected = payments.filter(p => p.status === 'completed').reduce((s, p) => s + p.amount, 0)
  const totalPending = payments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0)

  const methodStats: Record<string, number> = {}
  payments.filter(p => p.status === 'completed').forEach(p => {
    methodStats[p.method] = (methodStats[p.method] || 0) + p.amount
  })
  const topMethod = Object.entries(methodStats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

  /** Every write on this page is a manual act — money that arrived by a
   *  route the system never saw (cash, an EcoCash send-money transfer
   *  between two personal wallets, a bank transfer), or a correction after
   *  a client hit trouble paying. None of it is a gateway confirming
   *  anything, so all of it is attributed to whoever did it. */
  const logManual = (payment: Payment, what: string) => {
    if (!user) return
    void recordActivity({
      action: 'payment.validated',
      actor: { id: user.id, name: user.name, role: user.role },
      entityType: 'payment',
      entityId: payment.id,
      entityLabel: payment.reference,
      detail: `${what}: $${payment.amount.toFixed(2)} via ${payment.method} for ${payment.clientName} (${payment.policyNumber}).`,
      severity: 'warning',
    })
  }

  const handleAdd = async (payment: Payment) => {
    const { data, error } = await db.payments.create(payment)
    if (error || !data) { showToast('error', 'Failed to record payment.'); return }
    setPayments(prev => [data, ...prev])
    logManual(data, 'Recorded a payment received off-system')
    showToast('success', `Payment ${data.reference} recorded successfully.`)
    setShowRecord(false)
  }

  const handleValidate = async (payment: Payment) => {
    const { data, error } = await db.payments.update(payment.id, { status: 'completed' })
    if (error || !data) { showToast('error', 'Failed to validate payment.'); return }
    setPayments(prev => prev.map(p => p.id === data.id ? data : p))
    logManual(data, 'Marked a pending payment as received')
    showToast('success', `Payment ${data.reference} validated.`)
  }

  const handleEdit = async (updated: Payment) => {
    const { data, error } = await db.payments.update(updated.id, updated)
    if (error || !data) { showToast('error', 'Failed to update payment.'); return }
    setPayments(prev => prev.map(p => p.id === data.id ? data : p))
    logManual(data, 'Amended a payment record')
    showToast('success', `Payment ${data.reference} updated.`)
    setEditPayment(null)
  }

  return (
    <div className="panel">
      <div className="stats-grid stats-grid-3">
        <div className="stat-card">
          <div className="stat-icon stat-icon-teal">💰</div>
          <div className="stat-body">
            <div className="stat-value">${totalCollected.toFixed(2)}</div>
            <div className="stat-label">Total Collected</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-gold">⏳</div>
          <div className="stat-body">
            <div className="stat-value">${totalPending.toFixed(2)}</div>
            <div className="stat-label">Pending</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-blue">📊</div>
          <div className="stat-body">
            <div className="stat-value">{topMethod}</div>
            <div className="stat-label">Top Payment Method</div>
          </div>
        </div>
      </div>

      <div className="panel-toolbar">
        <div className="filter-row">
          <input
            className="search-input"
            placeholder="Search reference, client, policy…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select title="Filter by method" className="filter-select" value={methodFilter} onChange={e => setMethodFilter(e.target.value as PaymentMethod | 'all')}>
            <option value="all">All Methods</option>
            {PAYMENT_METHODS.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select title="Filter by status" className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value as PaymentStatus | 'all')}>
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="reversed">Reversed</option>
          </select>
        </div>
        {hasPermission('payments.capture') && (
          <button type="button" className="btn btn-primary" onClick={() => setShowRecord(true)}>+ Record Payment</button>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading payments…</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Policy No.</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="td-empty">No payments found.</td></tr>
              ) : filtered.map(p => (
                <tr key={p.id}>
                  <td><span className="mono">{p.reference}</span></td>
                  <td><span className="mono">{p.policyNumber}</span></td>
                  <td>{p.clientName}</td>
                  <td><strong>${p.amount.toFixed(2)}</strong></td>
                  <td>
                    <div className="payment-method-cell">
                      <span className="pill pill-active pill-xs">{p.method}</span>
                      {p.splitPayments && <span className="payment-split-label">+split</span>}
                    </div>
                  </td>
                  <td>{formatDate(p.date)}</td>
                  <td><span className={`pill ${STATUS_CLASS[p.status]}`}>{p.status}</span></td>
                  <td>
                    <div className="action-btns">
                      {hasPermission('payments.capture') && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditPayment(p)}>Edit</button>
                      )}
                      {p.status === 'pending' && hasPermission('payments.validate') && (
                        <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--success)' }} onClick={() => handleValidate(p)}>Validate</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showRecord && (
        <RecordPaymentModal onClose={() => setShowRecord(false)} onSave={handleAdd} />
      )}
      {editPayment && (
        <RecordPaymentModal payment={editPayment} onClose={() => setEditPayment(null)} onSave={handleEdit} />
      )}
    </div>
  )
}
