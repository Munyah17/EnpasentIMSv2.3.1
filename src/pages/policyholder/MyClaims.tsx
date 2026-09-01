import { useState, useEffect } from 'react'
import type { ToastMessage } from '../../types'
import type { ActivePanel } from '../../App'
import { db } from '../../lib/db'
import type { Claim } from '../../types'
import { useAuth } from '../../contexts/AuthContext'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

export default function MyClaims({ }: Props) {
  const { user } = useAuth()
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    db.claims.list().then(({ data }) => {
      if (data) setClaims(data)
      setLoading(false)
    })
  }, [])

  const myClaims = claims.filter(c => c.clientName.toLowerCase() === (user?.name ?? '').toLowerCase())

  return (
    <div className="panel">
      {loading ? (
        <div className="empty-state">Loading claims…</div>
      ) : myClaims.length === 0 ? (
        <div className="empty-state">No claims found for your account.</div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Claim No.</th>
                <th>Product</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {myClaims.map(c => (
                <tr key={c.id}>
                  <td><span className="mono">{c.claimNumber}</span></td>
                  <td>{c.productName}</td>
                  <td>{c.claimType}</td>
                  <td>${c.amount.toLocaleString()}</td>
                  <td>{c.dateSubmitted}</td>
                  <td><span className={`pill pill-${c.status.replace('_', '-')}`}>{c.status.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
