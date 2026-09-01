import { useState, useEffect } from 'react'
import type { ToastMessage, InsurerRecord } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import { formatDate } from '../lib/dateUtils'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

const CATEGORY_LABELS: Record<string, string> = {
  life: 'Life',
  funeral: 'Funeral',
  health: 'Health',
  accident: 'Personal Accident',
  motor: 'Motor',
  property: 'Property',
  agriculture: 'Agriculture',
}
const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS)

export default function InsurerManagement({ showToast }: Props) {
  const { user } = useAuth()
  const canEdit = user?.role === 'super_admin' || user?.role === 'admin'
  const [insurers, setInsurers] = useState<InsurerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [editInsurer, setEditInsurer] = useState<InsurerRecord | null>(null)

  const load = () => {
    db.insurers.list().then(({ data }) => { setInsurers(data); setLoading(false) })
  }

  useEffect(load, [])

  const filtered = insurers.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))

  const handleCreate = async (input: Omit<InsurerRecord, 'id' | 'status' | 'createdAt'>) => {
    const { data, error } = await db.insurers.create(input)
    if (error || !data) { showToast('error', error ?? 'Failed to add insurer.'); return }
    setInsurers(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setShowNew(false)
    showToast('success', `${data.name} added.`)
  }

  const handleUpdate = async (id: string, updates: Partial<Omit<InsurerRecord, 'id' | 'createdAt'>>) => {
    const { data, error } = await db.insurers.update(id, updates)
    if (error || !data) { showToast('error', error ?? 'Failed to update insurer.'); return }
    setInsurers(prev => prev.map(i => i.id === id ? data : i).sort((a, b) => a.name.localeCompare(b.name)))
    setEditInsurer(null)
    showToast('success', `${data.name} updated.`)
  }

  const toggleStatus = async (insurer: InsurerRecord) => {
    const next = insurer.status === 'active' ? 'inactive' : 'active'
    await handleUpdate(insurer.id, { status: next })
  }

  return (
    <div className="panel">
      {!canEdit && (
        <div className="info-banner info-banner-warning" style={{ marginBottom: 16 }}>
          🔒 Read-only: only Super Admin or Admin accounts can add or edit insurer partners.
        </div>
      )}
      <div className="panel-toolbar">
        <input
          className="search-input"
          placeholder="Search insurer name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)} disabled={!canEdit}>+ Add Insurer</button>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading insurers…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">No insurer partners found.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Cover Types</th>
                <th>Reg. Number</th>
                <th>Commission Override</th>
                <th>Status</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(i => (
                <tr key={i.id}>
                  <td><strong>{i.name}</strong></td>
                  <td>
                    {i.contactEmail || '—'}
                    {i.contactPhone ? ` · ${i.contactPhone}` : ''}
                  </td>
                  <td style={{ fontSize: 11 }}>
                    {i.coverTypes.length > 0 ? i.coverTypes.map(c => CATEGORY_LABELS[c] ?? c).join(', ') : '—'}
                  </td>
                  <td>{i.regNumber || '—'}</td>
                  <td>{i.commissionPercent !== undefined ? `${i.commissionPercent}%` : 'default'}</td>
                  <td><span className={`pill ${i.status === 'active' ? 'pill-active' : 'pill-lapsed'}`}>{i.status}</span></td>
                  <td>{formatDate(i.createdAt)}</td>
                  <td>
                    <div className="action-btns">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditInsurer(i)} disabled={!canEdit}>Edit</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleStatus(i)} disabled={!canEdit}>
                        {i.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <InsurerModal onClose={() => setShowNew(false)} onSave={handleCreate} title="Add Insurer" />
      )}
      {editInsurer && (
        <InsurerModal
          onClose={() => setEditInsurer(null)}
          onSave={updates => handleUpdate(editInsurer.id, updates)}
          title={`Edit ${editInsurer.name}`}
          initial={editInsurer}
        />
      )}
    </div>
  )
}

function InsurerModal({ onClose, onSave, title, initial }: {
  onClose: () => void
  onSave: (input: { name: string; contactEmail?: string; contactPhone?: string; address?: string; regNumber?: string; commissionPercent?: number; notes?: string; coverTypes: string[] }) => Promise<void>
  title: string
  initial?: InsurerRecord
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? '')
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [regNumber, setRegNumber] = useState(initial?.regNumber ?? '')
  const [commissionPercent, setCommissionPercent] = useState(initial?.commissionPercent?.toString() ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [coverTypes, setCoverTypes] = useState<string[]>(initial?.coverTypes ?? [])
  const [saving, setSaving] = useState(false)

  const canSave = name.trim().length > 0 && !saving

  const toggleCoverType = (cat: string) => {
    setCoverTypes(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        address: address.trim() || undefined,
        regNumber: regNumber.trim() || undefined,
        commissionPercent: commissionPercent.trim() === '' ? undefined : Number(commissionPercent),
        notes: notes.trim() || undefined,
        coverTypes,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Insurer Name *</label>
            <input className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Motions" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Contact Email</label>
              <input type="email" className="form-control" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="claims@insurer.co.zw" />
            </div>
            <div className="form-group">
              <label>Contact Phone</label>
              <input className="form-control" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="+263..." />
            </div>
          </div>
          <div className="form-group">
            <label>Address</label>
            <input className="form-control" value={address} onChange={e => setAddress(e.target.value)} placeholder="Street address, city" />
          </div>
          <div className="form-group">
            <label>Types of Cover Offered</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {ALL_CATEGORIES.map(cat => (
                <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6, textTransform: 'none', fontSize: 13, fontWeight: 400 }}>
                  <input type="checkbox" checked={coverTypes.includes(cat)} onChange={() => toggleCoverType(cat)} />
                  {CATEGORY_LABELS[cat]}
                </label>
              ))}
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Registration Number</label>
              <input className="form-control" value={regNumber} onChange={e => setRegNumber(e.target.value)} placeholder="IPEC reg. number" />
            </div>
            <div className="form-group">
              <label>Commission Override (%)</label>
              <input
                type="number" className="form-control" min={0} max={100} step={0.5}
                value={commissionPercent}
                onChange={e => setCommissionPercent(e.target.value)}
                placeholder="Leave blank for default rate"
              />
            </div>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea className="form-control" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything worth recording about this partnership…" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save Insurer'}
          </button>
        </div>
      </div>
    </div>
  )
}
