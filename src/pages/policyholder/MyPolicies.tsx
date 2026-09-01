import { useState, useEffect } from 'react'
import type { ToastMessage } from '../../types'
import type { ActivePanel } from '../../App'
import { db } from '../../lib/db'
import { formatDate } from '../../lib/dateUtils'
import type { Policy } from '../../types'
import { useAuth } from '../../contexts/AuthContext'
import { premiumPeriodLabel } from '../../lib/productUtils'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

export default function MyPolicies({ setActivePanel }: Props) {
  const { user } = useAuth()
  const [policies, setPolicies] = useState<Policy[]>([])
  const [categoryByProductId, setCategoryByProductId] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    db.policies.list().then(({ data }) => {
      if (data) setPolicies(data)
      setLoading(false)
    })
    // Client-safe read: a full products.list() also carries commissionPct
    // (the broker's margin) and policiesCount, neither of which belongs in a
    // client's browser even though this page only ever reads .category off
    // it. See db.products.listClientSafe().
    db.products.listClientSafe().then(({ data }) => {
      if (data) setCategoryByProductId(Object.fromEntries(data.map(p => [p.id, p.category])))
    })
  }, [])

  const myPolicies = policies.filter(p => p.clientName.toLowerCase() === (user?.name ?? '').toLowerCase())

  return (
    <div className="panel">
      <div className="info-banner info-banner-info" style={{ marginBottom: '1rem' }}>
        ℹ Welcome, {user?.name}! Your active policies and coverage details are shown below.
      </div>
      {loading ? (
        <div className="empty-state">Loading policies…</div>
      ) : myPolicies.length === 0 ? (
        <div className="empty-state">No policies found for your account. <button className="btn btn-primary btn-sm" onClick={() => setActivePanel('profile')}>Contact Us</button></div>
      ) : (
        <div className="products-grid">
          {myPolicies.map(p => (
            <div key={p.id} className="product-card">
              <div className="product-card-header">
                <div>
                  <div className="product-name">{p.productName}</div>
                  <div className="product-code mono">{p.policyNumber}</div>
                </div>
                <span className={`pill pill-${p.status}`}>{p.status}</span>
              </div>
              <div className="product-stats">
                <div className="product-stat">
                  <span className="product-stat-label">Premium</span>
                  <span className="product-stat-value">${p.premium}{premiumPeriodLabel(categoryByProductId[p.productId] ?? '')}</span>
                </div>
                <div className="product-stat">
                  <span className="product-stat-label">Cover Amount</span>
                  <span className="product-stat-value">${p.coverAmount.toLocaleString()}</span>
                </div>
                <div className="product-stat">
                  <span className="product-stat-label">Start Date</span>
                  <span className="product-stat-value">{formatDate(p.startDate)}</span>
                </div>
                <div className="product-stat">
                  <span className="product-stat-label">Next Payment</span>
                  <span className="product-stat-value">{formatDate(p.nextPaymentDate)}</span>
                </div>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 8 }}>
                Payment via: <strong>{p.paymentMethod}</strong>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
