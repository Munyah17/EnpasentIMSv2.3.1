import { useState, useEffect } from 'react'
import type { ToastMessage, Product } from '../../types'
import { db } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
}

export interface CommissionRates {
  defaultRatePercent: number
  perProductOverrides: Record<string, number>
}

export const DEFAULT_COMMISSION_RATES: CommissionRates = {
  defaultRatePercent: 10,
  perProductOverrides: {},
}

export async function getCommissionRates(): Promise<CommissionRates> {
  const remote = await db.settings.get<CommissionRates>('commission_rates')
  return remote ? { ...DEFAULT_COMMISSION_RATES, ...remote } : DEFAULT_COMMISSION_RATES
}

export default function CommissionSettings({ showToast }: Props) {
  const { user } = useAuth()
  const canEdit = user?.role === 'super_admin' || user?.role === 'admin'
  const [rates, setRates] = useState<CommissionRates>(DEFAULT_COMMISSION_RATES)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([getCommissionRates(), db.products.list()]).then(([r, prodRes]) => {
      setRates(r)
      if (prodRes.data) setProducts(prodRes.data)
      setLoading(false)
    })
  }, [])

  const setOverride = (productId: string, value: string) => {
    if (!canEdit) return
    setRates(prev => {
      const next = { ...prev.perProductOverrides }
      if (value.trim() === '') delete next[productId]
      else next[productId] = Number(value)
      return { ...prev, perProductOverrides: next }
    })
  }

  const handleSave = async () => {
    if (!canEdit) return
    setSaving(true)
    const { error } = await db.settings.set('commission_rates', rates)
    setSaving(false)
    if (error) { showToast('error', `Failed to save: ${error}`); return }
    showToast('success', 'Commission rates saved, applies to all agents and API developer partners.')
  }

  if (loading) return <div className="empty-state">Loading commission rates…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!canEdit && (
        <div className="info-banner info-banner-warning" style={{ borderRadius: 8, padding: '10px 13px', fontSize: 12 }}>
          🔒 Read-only: only Super Admin or Admin accounts can change commission rates.
        </div>
      )}
      <div className="card">
        <div className="card-header"><span className="card-title">Default Agent Commission Rate</span></div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          Applied to every policy's premium for the staff member or API developer partner recorded as its agent, unless a product-specific rate below overrides it. Directors set this rate; it's the same figure used for commission owed to external developers selling your products through the API.
        </p>
        <div className="form-group" style={{ maxWidth: 220 }}>
          <label>Default Rate (%)</label>
          <input
            className="form-control"
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={rates.defaultRatePercent === 0 ? '' : rates.defaultRatePercent}
            disabled={!canEdit}
            onChange={e => setRates(prev => ({ ...prev, defaultRatePercent: e.target.value === '' ? 0 : Number(e.target.value) }))}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">Per-Product Overrides</span></div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          Leave blank to use the default rate above.
        </p>
        {products.length === 0 ? (
          <div className="empty-state">No products yet; add products first to set per-product rates.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Product</th><th>Category</th><th style={{ width: 140 }}>Rate (%)</th></tr></thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{p.category}</td>
                  <td>
                    <input
                      className="form-control"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      placeholder={`${rates.defaultRatePercent}`}
                      disabled={!canEdit}
                      value={rates.perProductOverrides[p.id] ?? ''}
                      onChange={e => setOverride(p.id, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !canEdit}>
          {saving ? 'Saving…' : 'Save Commission Rates'}
        </button>
      </div>
    </div>
  )
}
