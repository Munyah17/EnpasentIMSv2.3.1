import { useState, useEffect } from 'react'
import type { ToastMessage, HeroSlide } from '../../types'
import { db } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
}

export default function HeroSliderSettings({ showToast }: Props) {
  const { user } = useAuth()
  const canEdit = user?.role === 'super_admin' || user?.role === 'admin'
  const [slides, setSlides] = useState<HeroSlide[]>([])
  const [loading, setLoading] = useState(true)
  const [newIcon, setNewIcon] = useState('')
  const [newHeadline, setNewHeadline] = useState('')
  const [adding, setAdding] = useState(false)

  const load = () => { db.heroSlides.list().then(({ data }) => { setSlides(data); setLoading(false) }) }
  useEffect(load, [])

  const addSlide = async () => {
    if (!canEdit || !newIcon.trim()) return
    setAdding(true)
    const sortOrder = slides.length > 0 ? Math.max(...slides.map(s => s.sortOrder)) + 1 : 1
    const { data, error } = await db.heroSlides.create({ icon: newIcon.trim(), headline: newHeadline.trim() || undefined, sortOrder })
    setAdding(false)
    if (error || !data) { showToast('error', error ?? 'Failed to add slide.'); return }
    setSlides(prev => [...prev, data])
    setNewIcon('')
    setNewHeadline('')
    showToast('success', 'Slide added — live on the website within a few minutes.')
  }

  const updateHeadline = async (slide: HeroSlide, headline: string) => {
    setSlides(prev => prev.map(s => s.id === slide.id ? { ...s, headline } : s))
  }

  const saveHeadline = async (slide: HeroSlide) => {
    if (!canEdit) return
    const { error } = await db.heroSlides.update(slide.id, { headline: slide.headline ?? null })
    if (error) showToast('error', error)
  }

  const toggleStatus = async (slide: HeroSlide) => {
    if (!canEdit) return
    const status = slide.status === 'active' ? 'inactive' : 'active'
    const { error } = await db.heroSlides.update(slide.id, { status })
    if (error) { showToast('error', error); return }
    setSlides(prev => prev.map(s => s.id === slide.id ? { ...s, status } : s))
  }

  const move = async (slide: HeroSlide, direction: -1 | 1) => {
    if (!canEdit) return
    const sorted = [...slides].sort((a, b) => a.sortOrder - b.sortOrder)
    const idx = sorted.findIndex(s => s.id === slide.id)
    const swapWith = sorted[idx + direction]
    if (!swapWith) return
    const [a, b] = [slide.sortOrder, swapWith.sortOrder]
    await Promise.all([
      db.heroSlides.update(slide.id, { sortOrder: b }),
      db.heroSlides.update(swapWith.id, { sortOrder: a }),
    ])
    setSlides(prev => prev.map(s => {
      if (s.id === slide.id) return { ...s, sortOrder: b }
      if (s.id === swapWith.id) return { ...s, sortOrder: a }
      return s
    }))
  }

  const remove = async (slide: HeroSlide) => {
    if (!canEdit) return
    if (!window.confirm('Remove this slide from the home page?')) return
    const { error } = await db.heroSlides.remove(slide.id)
    if (error) { showToast('error', error); return }
    setSlides(prev => prev.filter(s => s.id !== slide.id))
    showToast('info', 'Slide removed.')
  }

  if (loading) return <div className="empty-state">Loading hero slider…</div>

  const sorted = [...slides].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!canEdit && (
        <div className="info-banner info-banner-warning" style={{ borderRadius: 8, padding: '10px 13px', fontSize: 12 }}>
          🔒 Read-only: only Super Admin or Admin accounts can change the home page hero slider.
        </div>
      )}
      <div className="card">
        <div className="card-header"><span className="card-title">Home Page Hero Slider</span></div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          Slides shown on motions.co.zw's home page, in order. The icon picks which graphic is used (🛡 shield, 🌾 crop, 🏥 health, 👨‍👩‍👧‍👦 family, 🚗 motor — anything else falls back to a generic shield). Changes go live within a few minutes.
        </p>
        {sorted.length === 0 ? (
          <div className="empty-state">No slides yet.</div>
        ) : (
          <table className="table">
            <thead><tr><th style={{ width: 60 }}>Icon</th><th>Headline</th><th style={{ width: 90 }}>Status</th><th style={{ width: 200 }}></th></tr></thead>
            <tbody>
              {sorted.map((slide, i) => (
                <tr key={slide.id}>
                  <td style={{ fontSize: 22, textAlign: 'center' }}>{slide.icon}</td>
                  <td>
                    <input
                      className="form-control"
                      value={slide.headline ?? ''}
                      disabled={!canEdit}
                      onChange={e => updateHeadline(slide, e.target.value)}
                      onBlur={() => saveHeadline(slide)}
                      placeholder="Optional headline shown over this slide"
                    />
                  </td>
                  <td><span className={`pill ${slide.status === 'active' ? 'pill-active' : 'pill-cancelled'}`}>{slide.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!canEdit || i === 0} onClick={() => move(slide, -1)}>▲</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!canEdit || i === sorted.length - 1} onClick={() => move(slide, 1)}>▼</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!canEdit} onClick={() => toggleStatus(slide)}>
                        {slide.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} disabled={!canEdit} onClick={() => remove(slide)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canEdit && (
        <div className="card">
          <div className="card-header"><span className="card-title">Add Slide</span></div>
          <div className="form-row">
            <div className="form-group" style={{ maxWidth: 140 }}>
              <label>Icon (emoji)</label>
              <input className="form-control" value={newIcon} onChange={e => setNewIcon(e.target.value)} placeholder="🛡" />
            </div>
            <div className="form-group">
              <label>Headline (optional)</label>
              <input className="form-control" value={newHeadline} onChange={e => setNewHeadline(e.target.value)} placeholder="e.g. Real Protection for Real Life" />
            </div>
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={adding || !newIcon.trim()} onClick={addSlide}>
            {adding ? 'Adding…' : '+ Add Slide'}
          </button>
        </div>
      )}
    </div>
  )
}
