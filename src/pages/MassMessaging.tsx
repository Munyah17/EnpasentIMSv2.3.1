import { useState, useEffect } from 'react'
import type { ToastMessage, Client } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import { sendBulkSms, getSmsSettings, saveSmsSettings, getSmsLog, clearSmsLog } from '../lib/smsService'
import type { SmsSettings, SmsLogEntry } from '../lib/smsService'
import { useAuth } from '../contexts/AuthContext'
import { formatDateTime } from '../lib/dateUtils'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

const MAX_SMS_CHARS = 160

export default function MassMessaging({ showToast }: Props) {
  const { hasPermission } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<'compose' | 'settings' | 'log'>('compose')
  const [smsConfig, setSmsConfig] = useState<SmsSettings>(() => getSmsSettings())
  const [log, setLog] = useState<SmsLogEntry[]>([])

  useEffect(() => {
    db.clients.list().then(({ data, error }) => {
      if (error) { showToast('error', 'Failed to load clients.'); return }
      const all = (data ?? []).filter(c => c.status === 'active')
      setClients(all)
      setSelected(new Set(all.map(c => c.id)))
    })
    setLog(getSmsLog())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = clients.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
  )

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      return s
    })
  }

  const selectAll = () => setSelected(new Set(clients.map(c => c.id)))
  const deselectAll = () => setSelected(new Set())
  const selectVisible = () => setSelected(prev => {
    const s = new Set(prev)
    visible.forEach(c => s.add(c.id))
    return s
  })

  const selectedClients = clients.filter(c => selected.has(c.id))
  const chars = message.length
  const segments = Math.ceil(chars / MAX_SMS_CHARS) || 1

  const handleSend = async () => {
    if (!message.trim()) { showToast('warning', 'Please enter a message.'); return }
    if (selectedClients.length === 0) { showToast('warning', 'No recipients selected.'); return }
    if (!window.confirm(`Send SMS to ${selectedClients.length} client(s)?`)) return

    setSending(true)
    try {
      const numbers = selectedClients.map(c => c.phone.replace(/\s/g, ''))
      const result = await sendBulkSms(numbers, message.trim())

      if (result.failed === 0) {
        showToast('success', `Sent: ${result.sent} | Failed: 0`)
      } else {
        // "Failed: 1" on its own is untraceable — the gateway's reason is
        // already captured per recipient, so say it. Distinct reasons only:
        // a whole campaign refused for one cause should read as one cause,
        // not as the same sentence repeated for every number.
        const reasons = [...new Set(
          result.results.filter(r => !r.result.success).map(r => r.result.error).filter(Boolean),
        )] as string[]
        const shown = reasons.slice(0, 2).join(' ')
        const more = reasons.length > 2 ? ` (+${reasons.length - 2} other reasons)` : ''
        showToast('error',
          `Sent: ${result.sent} | Failed: ${result.failed}. ${shown}${more}`)
      }
      setLog(getSmsLog())
    } finally {
      setSending(false)
    }
  }

  const saveSettings = () => {
    saveSmsSettings(smsConfig)
    showToast('success', 'SMS settings saved.')
  }

  return (
    <div className="panel">
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab${tab === 'compose' ? ' active' : ''}`} onClick={() => setTab('compose')}>
          Compose & Send
        </button>
        <button className={`tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>
          Gateway Settings
        </button>
        <button className={`tab${tab === 'log' ? ' active' : ''}`} onClick={() => setTab('log')}>
          SMS Log ({log.length})
        </button>
      </div>

      {/* ── COMPOSE TAB ── */}
      {tab === 'compose' && (
        <div className="mass-sms-layout">
          {/* Left: Client list */}
          <div className="mass-sms-left">
            <div className="card">
              <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span className="card-title">Recipients ({selected.size}/{clients.length})</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={selectAll}>All</button>
                  <button className="btn btn-ghost btn-sm" onClick={deselectAll}>None</button>
                  <button className="btn btn-ghost btn-sm" onClick={selectVisible}>Visible</button>
                </div>
              </div>
              <input
                className="search-input"
                style={{ marginBottom: 10, width: '100%' }}
                placeholder="Search clients…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div className="mass-sms-client-list">
                {visible.map(c => (
                  <label key={c.id} className="mass-sms-client-row">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                    />
                    <div className="mass-sms-client-info">
                      <span className="mass-sms-client-name">{c.name}</span>
                      <span className="mass-sms-client-phone">{c.phone}</span>
                    </div>
                  </label>
                ))}
                {visible.length === 0 && <div className="empty-state" style={{ padding: '20px 0' }}>No clients match.</div>}
              </div>
            </div>
          </div>

          {/* Right: Composer */}
          <div className="mass-sms-right">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Message</span>
                <span style={{ fontSize: 11, color: chars > MAX_SMS_CHARS ? 'var(--danger)' : 'var(--muted)' }}>
                  {chars}/{MAX_SMS_CHARS} chars · {segments} segment{segments !== 1 ? 's' : ''}
                </span>
              </div>

              <textarea
                className="form-control"
                rows={6}
                placeholder="Type your message here…&#10;&#10;Tip: Keep under 160 characters for a single SMS segment."
                value={message}
                onChange={e => setMessage(e.target.value)}
                style={{ marginBottom: 12 }}
              />

              <div className="mass-sms-quick-templates">
                <span style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, display: 'block' }}>Quick templates:</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[
                    'Dear client, your insurance premium is due. Please pay to maintain your cover.',
                    'Important: Our offices will be closed on [DATE]. Normal operations resume [DATE].',
                    'Exciting news! New affordable insurance products now available. Reply YES for details.',
                    'Reminder: Please update your contact details and dependants. Visit our office or app.',
                  ].map((t, i) => (
                    <button key={i} className="btn btn-secondary btn-sm" onClick={() => setMessage(t)}>
                      Template {i + 1}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <div className="mass-sms-summary">
                  <span>{selected.size} recipient{selected.size !== 1 ? 's' : ''}</span>
                  <span>{segments} segment{segments !== 1 ? 's' : ''} × {selected.size} = {segments * selected.size} SMS units</span>
                </div>
                <button
                  className="btn btn-primary btn-full"
                  style={{ marginTop: 10 }}
                  onClick={handleSend}
                  disabled={sending || selected.size === 0 || !message.trim() || !hasPermission('communications.send_sms')}
                >
                  {sending ? '📨 Sending…' : `📱 Send to ${selected.size} client${selected.size !== 1 ? 's' : ''}`}
                </button>
                {!hasPermission('communications.send_sms') && (
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>You don't have permission to send bulk SMS.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === 'settings' && (
        <div style={{ maxWidth: 560 }}>
          <div className="card">
            <div className="card-header"><span className="card-title">Afrosoft SMS Gateway</span></div>
            <div className="info-banner info-banner-info" style={{ borderRadius: 8, padding: '10px 13px', marginBottom: 12, fontSize: 12 }}>
              The gateway credentials now live on the server, so SMS works the same from every device and
              nothing here can switch it off. These fields are kept for reference only.
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
              Live SMS through Afrosoft. The account domain is specific to our Afrosoft account; only change it if
              Afrosoft moves us to a different host (the server must allow-list any new host via the
              <code> AFROSOFT_SMS_DOMAIN</code> env var). Sending no longer falls back to a simulation: if the
              server has no key, a send fails and says so rather than reporting messages that never left.
            </p>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="form-group">
                <label>Account Domain</label>
                <input className="form-control" value={smsConfig.domain} onChange={e => setSmsConfig(p => ({ ...p, domain: e.target.value }))} placeholder="e.g. sms.afrosoft.co.zw" />
              </div>
              <div className="form-group">
                <label>API Key</label>
                <input className="form-control" type="password" value={smsConfig.apiKey} onChange={e => setSmsConfig(p => ({ ...p, apiKey: e.target.value }))} placeholder="Afrosoft API key" />
              </div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="form-group">
                <label>Sender ID (optional)</label>
                <input className="form-control" value={smsConfig.senderId} onChange={e => setSmsConfig(p => ({ ...p, senderId: e.target.value }))} placeholder="Leave blank to use your account's default" />
              </div>
            </div>
            <button className="btn btn-primary" onClick={saveSettings}>Save Gateway Settings</button>
          </div>
        </div>
      )}

      {/* ── LOG TAB ── */}
      {tab === 'log' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">SMS History (last 200)</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { clearSmsLog(); setLog([]) }}>Clear log</button>
          </div>
          {log.length === 0 ? (
            <div className="empty-state">No SMS records yet.</div>
          ) : (
            <table className="table">
              <thead><tr><th>Time</th><th>To</th><th>Message</th><th>Status</th><th>Reason</th></tr></thead>
              <tbody>
                {log.map(entry => (
                  <tr key={entry.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.ts)}</td>
                    <td>{entry.to}</td>
                    <td style={{ maxWidth: 260 }}><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{entry.message}</span></td>
                    <td><span className={`pill pill-${entry.status === 'sent' ? 'active' : entry.status === 'failed' ? 'lapsed' : 'pending'}`}>{entry.status}</span></td>
                    <td style={{ maxWidth: 280, fontSize: 12, color: entry.error ? 'var(--danger)' : 'var(--muted)' }}>
                      {entry.error ?? (entry.status === 'sent' ? 'Delivered to gateway' : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
