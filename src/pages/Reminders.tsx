import { useState, useEffect } from 'react'
import type { ToastMessage, Reminder, Policy } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import { formatDate } from '../lib/dateUtils'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

const TYPE_ICON: Record<string, string> = {
  payment_due: '💳',
  policy_renewal: '🔄',
  claim_followup: '📋',
  birthday: '🎂',
  document_expiry: '📄',
}

export default function Reminders({ showToast }: Props) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overdue' | 'renewals' | 'log' | 'settings'>('overdue')

  useEffect(() => {
    Promise.all([db.reminders.list(), db.policies.list()]).then(([remRes, polRes]) => {
      if (remRes.error) showToast('error', 'Failed to load reminders.')
      else if (remRes.data) setReminders(remRes.data)
      if (polRes.data) setPolicies(polRes.data)
      setLoading(false)
    })
  }, [showToast])

  const overdue = reminders.filter(r => !r.sent && new Date(r.dueDate) <= new Date())
  const upcoming = reminders.filter(r => !r.sent && new Date(r.dueDate) > new Date())
  const sent = reminders.filter(r => r.sent)

  const lapsingPolicies = policies.filter(p => p.status === 'lapsed')
  const upcomingRenewals = policies.filter(p => {
    const diff = (new Date(p.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    return diff <= 30 && diff > 0 && p.status === 'active'
  })

  const sendReminder = async (id: string) => {
    await db.reminders.markSent(id)
    setReminders(prev => prev.map(r => r.id === id ? { ...r, sent: true } : r))
    showToast('success', 'Reminder sent successfully.')
  }

  const sendAll = async () => {
    const unsent = [...overdue, ...upcoming]
    await db.reminders.markAllSent(unsent.map(r => r.id))
    setReminders(prev => prev.map(r => unsent.find(u => u.id === r.id) ? { ...r, sent: true } : r))
    showToast('success', `${unsent.length} reminders sent.`)
  }

  const channelPill = (ch: string) => (
    <span className="pill pill-active pill-xs">{ch}</span>
  )

  const tabs: [typeof activeTab, string][] = [
    ['overdue', `Overdue (${overdue.length})`],
    ['renewals', `Renewals (${upcomingRenewals.length})`],
    ['log', `Sent Log (${sent.length})`],
    ['settings', 'Settings'],
  ]

  return (
    <div className="panel">
      <div className="tabs">
        {tabs.map(([t, label]) => (
          <button type="button" key={t} className={`tab${activeTab === t ? ' active' : ''}`} onClick={() => setActiveTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state">Loading reminders…</div>
      ) : activeTab === 'overdue' ? (
        <div>
          {overdue.length === 0 && upcoming.length === 0 ? (
            <div className="empty-state">No pending reminders.</div>
          ) : (
            <>
              <div className="panel-toolbar">
                <span className="text-muted">{overdue.length + upcoming.length} pending reminders</span>
                <button type="button" className="btn btn-primary btn-sm" onClick={sendAll}>Send All</button>
              </div>
              {[...overdue, ...upcoming].map(r => (
                <div key={r.id} className="reminder-card">
                  <div className="reminder-icon">{TYPE_ICON[r.type]}</div>
                  <div className="reminder-body">
                    <div className="reminder-title">{r.clientName} ({r.type.replace(/_/g, ' ')})</div>
                    <div className="reminder-msg">{r.message}</div>
                    <div className="reminder-meta">
                      Due: {formatDate(r.dueDate)} · {channelPill(r.channel)}
                      {r.policyNumber && <span className="mono reminder-policy">{r.policyNumber}</span>}
                    </div>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => sendReminder(r.id)}>Send</button>
                </div>
              ))}
            </>
          )}
        </div>
      ) : activeTab === 'renewals' ? (
        <div>
          <div className="info-banner info-banner-warning">
            {lapsingPolicies.length > 0
              ? `⚠ ${lapsingPolicies.length} policies have lapsed. Send reinstatement offers.`
              : 'No lapsed policies.'
            }
          </div>
          <div className="card">
            <table className="table">
              <thead>
                <tr><th>Policy No.</th><th>Client</th><th>Product</th><th>End Date</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {[...lapsingPolicies, ...upcomingRenewals].map(p => (
                  <tr key={p.id}>
                    <td><span className="mono">{p.policyNumber}</span></td>
                    <td>{p.clientName}</td>
                    <td>{p.productName}</td>
                    <td>{formatDate(p.endDate)}</td>
                    <td><span className={`pill pill-${p.status}`}>{p.status}</span></td>
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => showToast('success', `Renewal reminder sent to ${p.clientName}.`)}>
                        Send Reminder
                      </button>
                    </td>
                  </tr>
                ))}
                {lapsingPolicies.length === 0 && upcomingRenewals.length === 0 && (
                  <tr><td colSpan={6} className="td-empty">No renewals in next 30 days.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'log' ? (
        <div className="card">
          <table className="table">
            <thead>
              <tr><th>Client</th><th>Type</th><th>Message</th><th>Channel</th><th>Status</th></tr>
            </thead>
            <tbody>
              {sent.length === 0 ? (
                <tr><td colSpan={5} className="td-empty">No sent reminders yet.</td></tr>
              ) : sent.map(r => (
                <tr key={r.id}>
                  <td>{r.clientName}</td>
                  <td>{TYPE_ICON[r.type]} {r.type.replace(/_/g, ' ')}</td>
                  <td className="td-truncate">{r.message}</td>
                  <td>{channelPill(r.channel)}</td>
                  <td><span className="pill pill-active">Sent</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card settings-card">
          <h3 className="settings-title">Reminder Settings</h3>
          <div className="form-group">
            <label htmlFor="remind-payment">Payment Due Reminder (days before)</label>
            <input id="remind-payment" type="number" defaultValue={3} min={1} max={14} className="form-control" />
          </div>
          <div className="form-group">
            <label htmlFor="remind-renewal">Policy Renewal Reminder (days before)</label>
            <input id="remind-renewal" type="number" defaultValue={30} min={7} max={60} className="form-control" />
          </div>
          <div className="form-group">
            <label htmlFor="remind-channel">Default Reminder Channel</label>
            <select id="remind-channel" className="form-control">
              <option>WhatsApp</option>
              <option>SMS</option>
              <option>Email</option>
              <option>USSD</option>
            </select>
          </div>
          <div className="form-group">
            <label className="checkbox-label">
              <input type="checkbox" defaultChecked />
              Send birthday greetings to clients
            </label>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => showToast('success', 'Reminder settings saved.')}>
            Save Settings
          </button>
        </div>
      )}
    </div>
  )
}
