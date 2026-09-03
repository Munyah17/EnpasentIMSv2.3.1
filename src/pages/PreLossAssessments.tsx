import { useState, useEffect } from 'react'
import type { ToastMessage, PolicyAssessment, Policy, Client } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import { formatDate } from '../lib/dateUtils'
import { exportPolicyAssessmentReport } from '../lib/exportUtils'
import { getDocumentUrl } from '../lib/storage'
import { reverseGeocode } from '../lib/geocode'
import { useAuth } from '../contexts/AuthContext'
import PolicyAssessmentModal from '../components/modals/PolicyAssessmentModal'

const CATEGORY_LABELS: Record<string, string> = {
  agriculture: 'Agriculture', motor: 'Vehicle / Motor',
}

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

export default function PreLossAssessments({ showToast }: Props) {
  const { hasPermission } = useAuth()
  const [assessments, setAssessments] = useState<PolicyAssessment[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<{ id: string; category: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<PolicyAssessment | null>(null)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [photoUrlsLoading, setPhotoUrlsLoading] = useState(false)
  const [placeLabel, setPlaceLabel] = useState<string | null>(null)
  const [pickingPolicy, setPickingPolicy] = useState(false)
  const [policySearch, setPolicySearch] = useState('')
  const [recordFor, setRecordFor] = useState<Policy | null>(null)

  const load = () => {
    Promise.all([db.policyAssessments.listAll(), db.policies.list(), db.products.list(), db.clients.list()]).then(([aRes, pRes, prodRes, cRes]) => {
      setAssessments(aRes.data)
      if (pRes.data) setPolicies(pRes.data)
      if (prodRes.data) setProducts(prodRes.data)
      if (cRes.data) setClients(cRes.data)
      setLoading(false)
    })
  }

  useEffect(load, [])

  useEffect(() => {
    if (!detail || detail.photos.length === 0) { setPhotoUrls({}); return }
    let cancelled = false
    setPhotoUrlsLoading(true)
    Promise.all(detail.photos.map(async p => [p.path, await getDocumentUrl(p.path)] as const)).then(pairs => {
      if (cancelled) return
      const urls: Record<string, string> = {}
      pairs.forEach(([path, url]) => { if (url) urls[path] = url })
      setPhotoUrls(urls)
      setPhotoUrlsLoading(false)
    })
    return () => { cancelled = true }
  }, [detail])

  useEffect(() => {
    if (!detail || detail.gpsLat === undefined || detail.gpsLng === undefined) { setPlaceLabel(null); return }
    let cancelled = false
    setPlaceLabel(null)
    reverseGeocode(detail.gpsLat, detail.gpsLng).then(label => { if (!cancelled) setPlaceLabel(label) })
    return () => { cancelled = true }
  }, [detail])

  const clientById = new Map(clients.map(c => [c.id, c]))

  const policySubjectType = (p: Policy): 'agriculture' | 'vehicle' | null => {
    const category = products.find(pr => pr.id === p.productId)?.category
    if (category === 'agriculture') return 'agriculture'
    if (category === 'motor') return 'vehicle'
    return null
  }
  const eligiblePolicies = policies.filter(p => policySubjectType(p) !== null)

  const filtered = assessments.filter(a =>
    a.policyNumber.toLowerCase().includes(search.toLowerCase()) ||
    (a.clientName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (a.cropType ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (a.registrationNumber ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // Grower Number is the most-preferred lookup for agriculture assessors —
  // an exact/prefix match on it is ranked above every other field so it
  // surfaces first even when the name or policy number also loosely match.
  const q = policySearch.trim().toLowerCase()
  const policyResults = q.length < 2 ? [] : eligiblePolicies
    .map(p => {
      const client = clientById.get(p.clientId)
      const category = products.find(pr => pr.id === p.productId)?.category ?? ''
      const grower = (p.growerNumber ?? '').toLowerCase()
      const fields = [p.policyNumber, p.clientName, client?.phone, client?.nationalId, CATEGORY_LABELS[category]]
        .filter(Boolean).map(v => String(v).toLowerCase())
      let rank = -1
      if (grower.startsWith(q)) rank = 0
      else if (grower.includes(q)) rank = 1
      else if (fields.some(f => f.startsWith(q))) rank = 2
      else if (fields.some(f => f.includes(q))) rank = 3
      return { p, client, category, rank }
    })
    .filter(r => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8)

  const handlePrint = (a: PolicyAssessment) => {
    // So the letterhead only shows the default insurer's logo when this
    // policy is actually placed with it -- see exportPolicyAssessmentReport.
    const insurer = policies.find(p => p.id === a.policyId)?.insurer
    void exportPolicyAssessmentReport(a, a.policyNumber, a.clientName ?? '', insurer)
  }

  const canRecord = hasPermission('claims.physical_assessment')

  const gpsValue = (a: PolicyAssessment) => {
    if (a.gpsLat === undefined || a.gpsLng === undefined) return 'Not captured'
    const coords = `${a.gpsLat.toFixed(6)}, ${a.gpsLng.toFixed(6)}`
    return placeLabel ? `${coords} (${placeLabel})` : coords
  }

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <input
          className="search-input"
          placeholder="Search policy number, client, crop, registration…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {canRecord && (
          <button type="button" className="btn btn-primary" onClick={() => setPickingPolicy(true)}>+ Record Pre-Loss Assessment</button>
        )}
      </div>

      <div className="info-banner info-banner-info" style={{ marginBottom: '1rem' }}>
        📷 Establishes what's actually there before any claim exists (crop planted on a farm, or a vehicle's existing condition) so a later claim can be checked against a real record. Every record here is available to compare against later claims.
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading assessments…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">No pre-loss assessments recorded yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Client</th>
                <th>Type</th>
                <th>Crop / Vehicle</th>
                <th>GPS</th>
                <th>Photos</th>
                <th>Assessor</th>
                <th>Recorded</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id}>
                  <td><span className="mono">{a.policyNumber}</span></td>
                  <td>{a.clientName ?? '—'}</td>
                  <td>{a.subjectType === 'vehicle' ? '🚗 Vehicle' : '🌾 Agriculture'}</td>
                  <td>{a.subjectType === 'vehicle' ? (a.registrationNumber || '—') : (a.cropType || '—')}</td>
                  <td>{a.gpsLat !== undefined ? <span className="pill pill-active">✓ Captured</span> : <span className="pill pill-lapsed">Missing</span>}</td>
                  <td>{a.photos.length}</td>
                  <td>{a.assessorName || '—'}</td>
                  <td>{formatDate(a.createdAt)}</td>
                  <td>
                    <div className="action-btns">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetail(a)}>View</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => handlePrint(a)}>🖨 Print</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pickingPolicy && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3>Select Policy</h3>
              <button className="modal-close" onClick={() => { setPickingPolicy(false); setPolicySearch('') }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Grower Number, Policy Number, Name, Phone, ID or Insurance Type</label>
                <input className="form-control" value={policySearch} onChange={e => setPolicySearch(e.target.value)} placeholder="Start typing… Grower Number is the fastest match" autoFocus />
              </div>
              {policySearch.trim().length >= 2 && (
                policyResults.length === 0 ? (
                  <div className="empty-state" style={{ padding: '12px 0' }}>No matching agriculture or vehicle policy found.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {policyResults.map(({ p, client, category }) => (
                      <button
                        key={p.id}
                        type="button"
                        className="btn btn-ghost"
                        style={{ justifyContent: 'flex-start', textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start', padding: '8px 12px' }}
                        onClick={() => { setPickingPolicy(false); setPolicySearch(''); setRecordFor(p) }}
                      >
                        <span>{category === 'motor' ? '🚗' : '🌾'} <strong style={{ marginLeft: 4 }}>{p.policyNumber}</strong>&nbsp;· {p.clientName}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {p.growerNumber ? `Grower No. ${p.growerNumber} · ` : ''}
                          {client?.phone ?? '—'}{client?.nationalId ? ` · ${client.nationalId}` : ''} · {CATEGORY_LABELS[category] ?? category}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setPickingPolicy(false); setPolicySearch('') }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {recordFor && (
        <PolicyAssessmentModal
          policyId={recordFor.id}
          policyNumber={recordFor.policyNumber}
          subjectType={policySubjectType(recordFor) ?? 'agriculture'}
          onClose={() => setRecordFor(null)}
          onSubmitted={() => { setRecordFor(null); load(); showToast('success', 'Pre-loss assessment recorded.') }}
          showToast={showToast}
        />
      )}

      {detail && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 640 }}>
            <div className="modal-header">
              <h3>Pre-Loss Assessment: {detail.policyNumber}</h3>
              <button className="modal-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Client</label>
                  <input className="form-control" value={detail.clientName ?? '—'} disabled style={{ opacity: 0.6 }} />
                </div>
                <div className="form-group">
                  <label>Assessor</label>
                  <input className="form-control" value={detail.assessorName || '—'} disabled style={{ opacity: 0.6 }} />
                </div>
              </div>
              {detail.subjectType === 'vehicle' ? (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Registration Number</label>
                      <input className="form-control" value={detail.registrationNumber || '—'} disabled style={{ opacity: 0.6 }} />
                    </div>
                    <div className="form-group">
                      <label>Odometer Reading</label>
                      <input className="form-control" value={detail.odometerReading || '—'} disabled style={{ opacity: 0.6 }} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Make / Model</label>
                      <input className="form-control" value={[detail.vehicleMake, detail.vehicleModel].filter(Boolean).join(' ') || '—'} disabled style={{ opacity: 0.6 }} />
                    </div>
                    <div className="form-group">
                      <label>GPS Coordinates</label>
                      <input className="form-control" value={gpsValue(detail)} disabled style={{ opacity: 0.6 }} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Existing Damage</label>
                    <textarea className="form-control" rows={2} value={detail.existingDamage || '—'} disabled style={{ opacity: 0.6 }} />
                  </div>
                </>
              ) : (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Crop Type</label>
                      <input className="form-control" value={detail.cropType || '—'} disabled style={{ opacity: 0.6 }} />
                    </div>
                    <div className="form-group">
                      <label>Crop Population</label>
                      <input className="form-control" value={detail.cropPopulation || '—'} disabled style={{ opacity: 0.6 }} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Plant Date</label>
                      <input className="form-control" value={detail.plantDate ? formatDate(detail.plantDate) : '—'} disabled style={{ opacity: 0.6 }} />
                    </div>
                    <div className="form-group">
                      <label>GPS Coordinates</label>
                      <input className="form-control" value={gpsValue(detail)} disabled style={{ opacity: 0.6 }} />
                    </div>
                  </div>
                </>
              )}
              <div className="form-group">
                <label>Notes</label>
                <textarea className="form-control" rows={3} value={detail.notes || '—'} disabled style={{ opacity: 0.6 }} />
              </div>
              {detail.photos.length > 0 && (
                <div className="form-group">
                  <label>Photos ({detail.photos.length}){photoUrlsLoading ? ' · loading…' : ''}</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {detail.photos.map((p, i) => (
                      <a
                        key={i}
                        href={photoUrls[p.path] ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ width: 120, textDecoration: 'none', color: 'inherit', pointerEvents: photoUrls[p.path] ? 'auto' : 'none' }}
                        title="Open full size"
                      >
                        {photoUrls[p.path] ? (
                          <img
                            src={photoUrls[p.path]}
                            alt={p.label}
                            style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }}
                          />
                        ) : (
                          <div style={{ width: 120, height: 90, borderRadius: 6, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--muted)' }}>
                            {photoUrlsLoading ? 'Loading…' : 'Unavailable'}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                          {p.label}{p.exifDate ? ` · ${formatDate(p.exifDate)}` : ''}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDetail(null)}>Close</button>
              <button className="btn btn-primary" onClick={() => handlePrint(detail)}>🖨 Print Report</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
