import { useState, useEffect } from 'react'
import { db } from '../../lib/db'
import { useAuth } from '../../contexts/AuthContext'

/**
 * The banner images shown on the two payment-method buttons on
 * enpassentims-website's Apply page (EcoCash / Paynow) — set here, read
 * there. The two systems are deliberately separate deployments with no
 * shared database; this is the one settled channel between them for
 * anything the website needs from the IMS at read time: a public,
 * read-only value in app_settings, exposed over the same Developer API the
 * website already authenticates against for everything else (GET
 * /api/v1/config), rather than a new integration of its own.
 *
 * A blank field removes that banner — the website falls back to a plain
 * text label, never a broken image.
 */

const SETTINGS_KEY = 'payment_gateway_banners'

interface BannerSettings {
  ecocash: string
  paynow: string
}

const DEFAULTS: BannerSettings = { ecocash: '', paynow: '' }

export default function PaymentBannerSettings({ showToast }: { showToast: (type: 'success' | 'error' | 'warning' | 'info', msg: string) => void }) {
  const { user } = useAuth()
  const canEdit = user?.role === 'super_admin' || user?.role === 'admin'

  const [banners, setBanners] = useState<BannerSettings>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    db.settings.get<Partial<BannerSettings>>(SETTINGS_KEY).then(stored => {
      setBanners({ ...DEFAULTS, ...(stored ?? {}) })
      setLoaded(true)
    })
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const { error } = await db.settings.set(SETTINGS_KEY, banners)
      if (error) { showToast('error', `Could not save: ${error}`); return }
      showToast('success', 'Payment banners saved. enpassentims-website picks these up on its next visit — no deploy needed.')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <div className="card"><p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</p></div>

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="card">
        <div className="card-header"><span className="card-title">Payment Method Banners</span></div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Shown on the two payment buttons on enpassentims-website's Apply page. Paste a URL to an already-hosted
          image (any image host, or a link to a file uploaded elsewhere) — this field does not upload a file itself.
          Leave blank to show a plain text label instead of a banner.
        </p>

        <div className="form-group" style={{ marginBottom: 14 }}>
          <label>EcoCash Banner URL</label>
          <input
            className="form-control"
            value={banners.ecocash}
            onChange={e => setBanners(b => ({ ...b, ecocash: e.target.value }))}
            placeholder="https://…/ecocash-banner.png"
            disabled={!canEdit}
          />
        </div>

        <div className="form-group" style={{ marginBottom: 16 }}>
          <label>Paynow Banner URL</label>
          <input
            className="form-control"
            value={banners.paynow}
            onChange={e => setBanners(b => ({ ...b, paynow: e.target.value }))}
            placeholder="https://…/paynow-banner.png"
            disabled={!canEdit}
          />
        </div>

        {canEdit ? (
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Banners'}
          </button>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>You don't have permission to change payment banners.</p>
        )}
      </div>
    </div>
  )
}
