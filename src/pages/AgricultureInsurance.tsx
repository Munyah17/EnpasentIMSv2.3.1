import { useState, useEffect } from 'react'
import type { ToastMessage, Policy, Claim, Product, CropType, PolicyAssessment } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  /** Accepts an optional product category so the destination page opens
   *  already narrowed to the agriculture book. */
  setActivePanel: (panel: ActivePanel, category?: string) => void
}

export default function AgricultureInsurance({ showToast, setActivePanel }: Props) {
  const { user } = useAuth()
  const canEdit = user?.role === 'super_admin' || user?.role === 'admin'
  const [policies, setPolicies] = useState<Policy[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [assessments, setAssessments] = useState<PolicyAssessment[]>([])
  const [crops, setCrops] = useState<CropType[]>([])
  const [loading, setLoading] = useState(true)
  const [newCrop, setNewCrop] = useState('')
  const [addingCrop, setAddingCrop] = useState(false)

  const load = () => {
    Promise.all([db.policies.list(), db.products.list(), db.claims.list(), db.policyAssessments.listAll(), db.cropTypes.list()])
      .then(([polRes, prodRes, claimRes, assessRes, cropRes]) => {
        if (polRes.data) setPolicies(polRes.data)
        if (prodRes.data) setProducts(prodRes.data)
        if (claimRes.data) setClaims(claimRes.data)
        setAssessments(assessRes.data)
        setCrops(cropRes.data)
        setLoading(false)
      })
  }

  useEffect(load, [])

  const agricultureProductIds = new Set(products.filter(p => p.category === 'agriculture').map(p => p.id))
  const agriculturePolicies = policies.filter(p => agricultureProductIds.has(p.productId))
  const activeAgPolicies = agriculturePolicies.filter(p => p.status === 'active')
  const sumInsured = agriculturePolicies.reduce((s, p) => s + p.coverAmount, 0)
  const agricultureAssessments = assessments.filter(a => a.subjectType === 'agriculture')
  const agricultureClaims = claims.filter(c => c.category === 'agriculture')
  const openAgClaims = agricultureClaims.filter(c => c.stage !== 'closed')
  const totalPaidOut = agricultureClaims.filter(c => c.status === 'paid').reduce((s, c) => s + c.amount, 0)

  const handleAddCrop = async () => {
    if (!newCrop.trim()) return
    setAddingCrop(true)
    const { data, error } = await db.cropTypes.create(newCrop.trim())
    setAddingCrop(false)
    if (error || !data) { showToast('error', error ?? 'Failed to add crop type.'); return }
    setCrops(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewCrop('')
    showToast('success', `${data.name} added.`)
  }

  const toggleCropStatus = async (crop: CropType) => {
    const next = crop.status === 'active' ? 'inactive' : 'active'
    const { error } = await db.cropTypes.setStatus(crop.id, next)
    if (error) { showToast('error', error); return }
    setCrops(prev => prev.map(c => c.id === crop.id ? { ...c, status: next } : c))
  }

  if (loading) return <div className="panel"><div className="empty-state">Loading agriculture insurance data…</div></div>

  return (
    <div className="panel">
      <div className="info-banner info-banner-info" style={{ marginBottom: '1.5rem' }}>
        🌾 Agriculture Insurance: a dedicated view across policies, claims, pre-loss assessments, and crop types. Currently covering tobacco and cotton growers, with room to add more crop types as the book expands.
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(91,127,232,0.15)', color: 'var(--blue)' }}>🌾</div>
          <div className="stat-body">
            <div className="stat-value">{agriculturePolicies.length}</div>
            <div className="stat-label">Agriculture Policies</div>
            <div className="stat-delta positive">{activeAgPolicies.length} active</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--teal)' }}>💰</div>
          <div className="stat-body">
            <div className="stat-value">${sumInsured.toLocaleString()}</div>
            <div className="stat-label">Total Sum Insured</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--gold)' }}>📋</div>
          <div className="stat-body">
            <div className="stat-value">{agricultureClaims.length}</div>
            <div className="stat-label">Agriculture Claims</div>
            <div className="stat-delta">{openAgClaims.length} open</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--danger)' }}>💸</div>
          <div className="stat-body">
            <div className="stat-value">${totalPaidOut.toLocaleString()}</div>
            <div className="stat-label">Total Paid Out</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--purple)' }}>📷</div>
          <div className="stat-body">
            <div className="stat-value">{agricultureAssessments.length}</div>
            <div className="stat-label">Pre-Loss Assessments</div>
          </div>
        </div>
      </div>

      <div className="grid-2col">
        <div className="card">
          <div className="card-header"><span className="card-title">Quick Links</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => setActivePanel('policies', 'agriculture')}>🛡 View Agriculture Policies</button>
            <button type="button" className="btn btn-outline" onClick={() => setActivePanel('claims', 'agriculture')}>📋 View Agriculture Claims</button>
            <button type="button" className="btn btn-outline" onClick={() => setActivePanel('pre_loss_assessments')}>📷 View Pre-Loss Assessments</button>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Crop Types</span></div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            Managed list used across pre-loss assessments and agriculture claims. Add new crop types as coverage expands beyond tobacco and cotton.
          </p>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                className="form-control"
                placeholder="e.g. Maize, Soybeans…"
                value={newCrop}
                onChange={e => setNewCrop(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddCrop()}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={handleAddCrop} disabled={addingCrop || !newCrop.trim()}>
                {addingCrop ? 'Adding…' : '+ Add'}
              </button>
            </div>
          )}
          {crops.length === 0 ? (
            <div className="empty-state" style={{ padding: '12px 0' }}>No crop types configured yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {crops.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13 }}>{c.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`pill ${c.status === 'active' ? 'pill-active' : 'pill-lapsed'}`}>{c.status}</span>
                    {canEdit && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleCropStatus(c)}>
                        {c.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
