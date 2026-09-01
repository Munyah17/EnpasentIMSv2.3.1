import { useState, useEffect } from 'react'
import type { ToastMessage } from '../../types'
import type { ActivePanel } from '../../App'
import { db } from '../../lib/db'
import { formatDate } from '../../lib/dateUtils'
import type { Payment } from '../../types'
import { useAuth } from '../../contexts/AuthContext'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

export default function MyPayments({ }: Props) {
  const { user } = useAuth()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    db.payments.list().then(({ data }) => {
      if (data) setPayments(data)
      setLoading(false)
    })
  }, [])

  const myPayments = payments.filter(p => p.clientName.toLowerCase() === (user?.name ?? '').toLowerCase())
  const total = myPayments.filter(p => p.status === 'completed').reduce((s, p) => s + p.amount, 0)

  return (
    <div className="panel">
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)', marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--teal)' }}>💰</div>
          <div className="stat-body">
            <div className="stat-value">${total.toFixed(2)}</div>
            <div className="stat-label">Total Paid</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(91,127,232,0.15)', color: 'var(--blue)' }}>🧾</div>
          <div className="stat-body">
            <div className="stat-value">{myPayments.length}</div>
            <div className="stat-label">Transactions</div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Loading payments…</div>
      ) : myPayments.length === 0 ? (
        <div className="empty-state">No payments found for your account.</div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Policy</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {myPayments.map(p => (
                <tr key={p.id}>
                  <td><span className="mono">{p.reference}</span></td>
                  <td><span className="mono">{p.policyNumber}</span></td>
                  <td><strong>${p.amount.toFixed(2)}</strong></td>
                  <td>{p.method}</td>
                  <td>{formatDate(p.date)}</td>
                  <td><span className={`pill ${p.status === 'completed' ? 'pill-active' : 'pill-pending'}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
