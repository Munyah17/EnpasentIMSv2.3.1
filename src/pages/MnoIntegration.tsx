import { useState, useEffect, useRef, useCallback } from 'react'
import type { ToastMessage } from '../types'
import type {
  MnoPartner, ApiKey, ApiLog, IntegrationEvent,
  UssdSession, ExternalTransaction, ApiPermission,
} from '../types/mno'
import { mnoStore } from '../lib/mno/mnoStore'
import { simulateInboundRequest } from '../lib/mno/handlers'
import { handleUssdAction } from '../lib/mno/ussd'
import { retryFailedEvents } from '../lib/mno/webhooks'
import { formatDate } from '../lib/dateUtils'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
}

type Tab = 'overview' | 'partners' | 'keys' | 'monitor' | 'ussd' | 'webhooks' | 'audit'

// ── Utility ───────────────────────────────────────────────────────────
function fmtMs(ms: number) { return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s` }
function fmtNum(n: number) { return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }
function fmtTime(ts: number | string) {
  const d = new Date(typeof ts === 'number' ? ts : ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
// [] means "whatever locale this device is set to", which is how a date
// ends up month-first on some machines and not others. Pinned to the house
// format instead.
function fmtDate(s: string) { return formatDate(s) }
function ago(ts: number | string) {
  const ms = Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime())
  if (ms < 5000) return 'just now'
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`
  return `${Math.floor(ms / 3600000)}h ago`
}

const STATUS_DOT: Record<string, string> = { active: '#10B981', testing: '#F59E0B', suspended: '#EF4444' }
const KEY_STATUS: Record<string, string> = { active: 'badge-active', revoked: 'badge-cancelled', expired: 'badge-lapsed' }
const EVT_STATUS: Record<string, string> = { delivered: '#10B981', pending: '#F59E0B', retrying: '#5B7FE8', failed: '#EF4444' }
const DIR_COLOR: Record<string, string> = { inbound: '#5B7FE8', outbound: '#10B981' }

const ALL_PERMISSIONS: ApiPermission[] = [
  'customers:read', 'customers:write',
  'policies:read', 'policies:write',
  'claims:read', 'claims:write',
  'payments:read', 'payments:write',
  'products:read', 'ussd:interact', 'webhooks:manage',
]

// ══════════════════════════════════════════════════════════════════════
export default function MnoIntegration({ showToast }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [partners, setPartners] = useState<MnoPartner[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [apiLogs, setApiLogs] = useState<ApiLog[]>([])
  const [events, setEvents] = useState<IntegrationEvent[]>([])
  const [sessions, setSessions] = useState<UssdSession[]>([])
  const [txns, setTxns] = useState<ExternalTransaction[]>([])
  const [simulating, setSimulating] = useState(false)

  const reload = useCallback(() => {
    setPartners(mnoStore.partners.list())
    setApiKeys(mnoStore.apiKeys.list())
    setApiLogs(mnoStore.apiLogs.list().slice(0, 80))
    setEvents(mnoStore.events.list().slice(0, 60))
    setSessions(mnoStore.ussdSessions.list())
    setTxns(mnoStore.extTxns.list())
  }, [])

  useEffect(() => { reload() }, [reload])

  const activePartners = partners.filter(p => p.status === 'active').length
  const activeKeys = apiKeys.filter(k => k.status === 'active').length
  const todayReqs = apiLogs.filter(l => Date.now() - l.ts < 86_400_000).length
  const successRate = apiLogs.length
    ? Math.round(apiLogs.filter(l => l.success).length / apiLogs.length * 100)
    : 100
  const avgMs = apiLogs.length
    ? Math.round(apiLogs.reduce((s, l) => s + l.duration, 0) / apiLogs.length)
    : 0

  async function handleSimulate(partnerId: string) {
    setSimulating(true)
    try {
      const { endpoint, response, duration } = await simulateInboundRequest(partnerId)
      reload()
      showToast(response.status === 'success' ? 'success' : 'error',
        `${endpoint} → ${response.status === 'success' ? '200 OK' : `Error: ${response.code}`} (${duration}ms)`)
    } finally { setSimulating(false) }
  }

  async function handleRetryWebhooks() {
    const count = await retryFailedEvents()
    reload()
    showToast('success', `Retried ${count} failed webhook(s)`)
  }

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'partners', label: 'Partners', badge: partners.length },
    { id: 'keys', label: 'API Keys', badge: activeKeys },
    { id: 'monitor', label: 'API Monitor', badge: todayReqs },
    { id: 'ussd', label: 'USSD Sessions', badge: sessions.filter(s => s.status === 'active').length },
    { id: 'webhooks', label: 'Webhooks', badge: events.filter(e => e.status === 'failed' || e.status === 'retrying').length },
    { id: 'audit', label: 'Audit Log' },
  ]

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="mno-hero">
        <div className="mno-hero-left">
          <div className="mno-hero-logo">
            <span style={{ fontSize: 26 }}>📡</span>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--text)' }}>NetOne Integration</h1>
              <span style={{ background: '#EDE9FE', color: '#6D28D9', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 10, letterSpacing: '0.07em' }}>DUAL API v1</span>
              <span style={{ background: '#FEE2E2', color: '#991B1B', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 10, letterSpacing: '0.05em' }}>⏸ SUSPENDED</span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              This partnership is suspended for now; no claim/billing notifications are sent to NetOne while suspended. Everything below is kept for reference and reactivation.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {partners.filter(p => p.status === 'active').map(p => (
            <button key={p.id} className="btn btn-primary" disabled={simulating}
              onClick={() => handleSimulate(p.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {simulating ? '⏳ Simulating…' : `▶ Simulate Netone`}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-row">
        {TABS.map(t => (
          <button key={t.id} className={`tab-btn${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.badge !== undefined && t.badge > 0
              ? <span className="nav-badge" style={{ marginLeft: 5 }}>{t.badge}</span>
              : null}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && <OverviewTab partners={partners} apiLogs={apiLogs} events={events} txns={txns}
        activePartners={activePartners} activeKeys={activeKeys} todayReqs={todayReqs}
        successRate={successRate} avgMs={avgMs} onSimulate={handleSimulate} simulating={simulating} reload={reload} />}
      {tab === 'partners' && <PartnersTab partners={partners} reload={reload} showToast={showToast} />}
      {tab === 'keys' && <ApiKeysTab apiKeys={apiKeys} partners={partners} reload={reload} showToast={showToast} />}
      {tab === 'monitor' && <MonitorTab apiLogs={apiLogs} reload={reload} />}
      {tab === 'ussd' && <UssdTab sessions={sessions} partners={partners} reload={reload} showToast={showToast} />}
      {tab === 'webhooks' && <WebhooksTab events={events} onRetry={handleRetryWebhooks} reload={reload} />}
      {tab === 'audit' && <AuditTab apiLogs={apiLogs} />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ══════════════════════════════════════════════════════════════════════
function OverviewTab({ partners, apiLogs, events, txns, activePartners, activeKeys,
  todayReqs, successRate, avgMs, onSimulate, simulating, reload }: {
  partners: MnoPartner[]; apiLogs: ApiLog[]; events: IntegrationEvent[]
  txns: ExternalTransaction[]; activePartners: number; activeKeys: number
  todayReqs: number; successRate: number; avgMs: number
  onSimulate: (id: string) => void; simulating: boolean; reload: () => void
}) {
  const totalRevenue = partners.reduce((s, p) => s + p.totalRevenue, 0)
  const totalCustomers = partners.reduce((s, p) => s + p.totalCustomers, 0)

  return (
    <div>
      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Active Partners" value={String(activePartners)} sub="of 3 configured" color="blue" icon="🤝" />
        <StatCard label="Active API Keys" value={String(activeKeys)} sub="across all partners" color="teal" icon="🔑" />
        <StatCard label="Requests Today" value={fmtNum(todayReqs)} sub={`${successRate}% success rate`} color="purple" icon="📡" />
        <StatCard label="Avg Latency" value={`${avgMs}ms`} sub="last 80 requests" color="gold" icon="⚡" />
        <StatCard label="MNO Customers" value={fmtNum(totalCustomers)} sub="across all partners" color="blue" icon="👥" />
        <StatCard label="Total Revenue" value={`$${(totalRevenue / 1000).toFixed(0)}k`} sub="from MNO channel" color="teal" icon="💰" />
      </div>

      {/* Partner Health Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14, marginBottom: 20 }}>
        {partners.map(p => (
          <div key={p.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_DOT[p.status], flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{p.name}</span>
              <span className={`status-badge status-${p.status === 'active' ? 'active' : p.status === 'testing' ? 'pending' : 'cancelled'}`}>
                {p.status}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <MiniStat label="Customers" value={fmtNum(p.totalCustomers)} />
              <MiniStat label="Policies" value={fmtNum(p.totalPolicies)} />
              <MiniStat label="Success Rate" value={`${p.successRate}%`} />
              <MiniStat label="Avg Latency" value={p.avgResponseMs > 0 ? `${p.avgResponseMs}ms` : '—'} />
            </div>
            <div style={{ display: 'flex', gap: 6, fontSize: 10 }}>
              <span style={{ flex: 1, color: 'var(--muted)' }}>{p.environment === 'production' ? '🟢 Production' : '🔵 Sandbox'}</span>
              {p.status === 'active' && (
                <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 8px' }}
                  onClick={() => onSimulate(p.id)} disabled={simulating}>
                  ▶ Test
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Live Feed + Events */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">Live API Feed</span>
            <button className="btn-ghost" style={{ fontSize: 11 }} onClick={reload}>↺ Refresh</button>
          </div>
          <div style={{ padding: '0 16px 16px' }}>
            {apiLogs.slice(0, 12).map(log => (
              <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
                <span style={{ color: DIR_COLOR[log.direction], fontWeight: 700, fontSize: 9, minWidth: 22 }}>
                  {log.direction === 'inbound' ? '↙' : '↗'}
                </span>
                <span style={{ color: log.success ? '#10B981' : '#EF4444', fontWeight: 600, minWidth: 26 }}>{log.statusCode}</span>
                <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log.endpoint}
                </span>
                <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{log.duration}ms</span>
                <span style={{ color: 'var(--muted)', flexShrink: 0, fontSize: 9 }}>{ago(log.ts)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Integration Events</span></div>
          <div style={{ padding: '0 16px 16px' }}>
            {events.slice(0, 12).map(evt => (
              <div key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: EVT_STATUS[evt.status], flexShrink: 0 }} />
                <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {evt.type}
                </span>
                <span style={{ color: 'var(--muted)', flexShrink: 0, fontSize: 10 }}>{evt.partnerName.split(' ')[0]}</span>
                <span style={{ color: 'var(--muted)', flexShrink: 0, fontSize: 9 }}>{ago(evt.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header"><span className="card-title">External Transactions</span></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>
              <th>Ref</th><th>Partner</th><th>MSISDN</th><th>Type</th>
              <th>Amount</th><th>Status</th><th>Channel</th><th>Time</th>
            </tr></thead>
            <tbody>
              {txns.slice(0, 10).map(t => (
                <tr key={t.id}>
                  <td><code style={{ fontSize: 10 }}>{t.transactionRef}</code></td>
                  <td>{t.partnerName.split(' ')[0]}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{t.msisdn}</td>
                  <td><span className="method-ecocash" style={{ fontSize: 10 }}>{t.type.replace('_', ' ')}</span></td>
                  <td style={{ fontWeight: 600 }}>${t.amount}</td>
                  <td><span className={`status-badge status-${t.status === 'confirmed' ? 'active' : t.status === 'pending' ? 'pending' : 'cancelled'}`}>{t.status}</span></td>
                  <td><span style={{ fontSize: 10, background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>{t.channel}</span></td>
                  <td style={{ color: 'var(--muted)', fontSize: 11 }}>{ago(t.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// PARTNERS TAB
// ══════════════════════════════════════════════════════════════════════
function PartnersTab({ partners, reload, showToast }: { partners: MnoPartner[]; reload: () => void; showToast: (t: ToastMessage['type'], m: string) => void }) {
  const [selected, setSelected] = useState<MnoPartner | null>(null)

  function handleStatus(p: MnoPartner, status: MnoPartner['status']) {
    mnoStore.partners.update(p.id, { status })
    reload()
    showToast('success', `${p.name} status → ${status}`)
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
        {partners.map(p => (
          <div key={p.id} className="card" style={{ cursor: 'pointer', border: selected?.id === p.id ? '2px solid var(--blue)' : undefined }}
            onClick={() => setSelected(p === selected ? null : p)}>
            <div style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: p.status === 'active' ? 'var(--success-bg)' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                  📡
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.code} · {p.environment}</div>
                </div>
                <span className={`status-badge status-${p.status === 'active' ? 'active' : p.status === 'testing' ? 'pending' : 'cancelled'}`}>
                  {p.status}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                <MiniStat label="Customers" value={fmtNum(p.totalCustomers)} />
                <MiniStat label="Policies" value={fmtNum(p.totalPolicies)} />
                <MiniStat label="Revenue" value={`$${(p.totalRevenue / 1000).toFixed(0)}k`} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                <div>📧 {p.contactEmail}</div>
                <div>📞 {p.contactPhone}</div>
                <div>📅 Contract: {fmtDate(p.contractStart)}{p.contractEnd ? ` → ${fmtDate(p.contractEnd)}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {p.status !== 'active' && <button className="btn-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={e => { e.stopPropagation(); handleStatus(p, 'active') }}>Activate</button>}
                {p.status === 'active' && <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={e => { e.stopPropagation(); handleStatus(p, 'suspended') }}>Suspend</button>}
                {p.status !== 'testing' && p.status !== 'active' && <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={e => { e.stopPropagation(); handleStatus(p, 'testing') }}>Set Testing</button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="card" style={{ marginTop: 20, padding: 20 }}>
          <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>{selected.name}: API Configuration</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label className="form-label">API Base URL</label>
              <div style={{ fontFamily: 'monospace', fontSize: 11, background: 'var(--surface2)', padding: '6px 10px', borderRadius: 6 }}>{selected.apiBaseUrl}</div>
            </div>
            <div>
              <label className="form-label">Webhook URL</label>
              <div style={{ fontFamily: 'monospace', fontSize: 11, background: 'var(--surface2)', padding: '6px 10px', borderRadius: 6 }}>{selected.webhookUrl}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)' }}>
            <strong>Security:</strong> HMAC-SHA256 request signing · Timestamp validation (5min window) · IP whitelisting · Rate limiting ({selected.status === 'active' ? '500' : '100'} req/min)
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// API KEYS TAB
// ══════════════════════════════════════════════════════════════════════
function ApiKeysTab({ apiKeys, partners, reload, showToast }: {
  apiKeys: ApiKey[]; partners: MnoPartner[]
  reload: () => void; showToast: (t: ToastMessage['type'], m: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<{ partnerId: string; label: string; environment: 'production' | 'sandbox'; rateLimit: number; permissions: ApiPermission[] }>({ partnerId: '', label: '', environment: 'sandbox', rateLimit: 100, permissions: [] })

  function handleRevoke(key: ApiKey) {
    mnoStore.apiKeys.update(key.id, { status: 'revoked' })
    reload()
    showToast('info', `API key "${key.label}" revoked`)
  }

  function handleCreate() {
    if (!newKey.partnerId || !newKey.label) { showToast('error', 'Partner and label are required'); return }
    const partner = partners.find(p => p.id === newKey.partnerId)
    const prefix = `tqfy_${partner?.code.slice(0, 3).toLowerCase() ?? 'unk'}_${Math.random().toString(36).slice(2, 6)}`
    mnoStore.apiKeys.create({
      id: `key-${Date.now()}`, partnerId: newKey.partnerId, partnerName: partner?.name ?? '',
      label: newKey.label, keyPrefix: prefix, environment: newKey.environment,
      permissions: newKey.permissions.length ? newKey.permissions : ['products:read'],
      status: 'active', createdAt: new Date().toISOString().split('T')[0],
      requestCount: 0, rateLimit: newKey.rateLimit,
    })
    reload()
    showToast('success', `API key "${newKey.label}" created, prefix: ${prefix}`)
    setCreating(false)
    setNewKey({ partnerId: '', label: '', environment: 'sandbox', rateLimit: 100, permissions: [] })
  }

  function togglePermission(perm: ApiPermission) {
    setNewKey(prev => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter(p => p !== perm)
        : [...prev.permissions, perm],
    }))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn-primary" onClick={() => setCreating(true)}>+ New API Key</button>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Create API Key</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="form-label">Partner *</label>
              <select className="form-input" value={newKey.partnerId} onChange={e => setNewKey(p => ({ ...p, partnerId: e.target.value }))}>
                <option value="">Select partner…</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Label *</label>
              <input className="form-input" placeholder="e.g. NetOne Production" value={newKey.label}
                onChange={e => setNewKey(p => ({ ...p, label: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Environment</label>
              <select className="form-input" value={newKey.environment} onChange={e => setNewKey(p => ({ ...p, environment: e.target.value as 'production' | 'sandbox' }))}>
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="form-label">Rate Limit (req/min)</label>
            <input type="number" className="form-input" style={{ width: 120 }} value={newKey.rateLimit === 0 ? '' : newKey.rateLimit}
              onChange={e => setNewKey(p => ({ ...p, rateLimit: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 }))} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label className="form-label">Permissions</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {ALL_PERMISSIONS.map(perm => (
                <button key={perm} onClick={() => togglePermission(perm)}
                  style={{ fontSize: 10, padding: '3px 9px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: newKey.permissions.includes(perm) ? 'var(--blue)' : 'var(--surface2)',
                    color: newKey.permissions.includes(perm) ? 'white' : 'var(--muted)' }}>
                  {perm}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={handleCreate}>Create Key</button>
            <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>
              <th>Label</th><th>Partner</th><th>Key Prefix</th><th>Env</th>
              <th>Permissions</th><th>Status</th><th>Requests</th><th>Rate Limit</th><th>Last Used</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {apiKeys.map(key => (
                <tr key={key.id}>
                  <td style={{ fontWeight: 500 }}>{key.label}</td>
                  <td>{key.partnerName.split(' ')[0]}</td>
                  <td><code style={{ fontSize: 10, background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>{key.keyPrefix}…</code></td>
                  <td><span style={{ fontSize: 10, background: key.environment === 'production' ? '#FEF3C7' : '#DCE4FB', color: key.environment === 'production' ? '#92400E' : '#1E40AF', padding: '2px 6px', borderRadius: 8, fontWeight: 600 }}>{key.environment}</span></td>
                  <td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxWidth: 200 }}>
                    {key.permissions.slice(0, 3).map(p => <span key={p} style={{ fontSize: 9, background: 'var(--blue-soft)', color: 'var(--blue)', padding: '1px 5px', borderRadius: 8 }}>{p}</span>)}
                    {key.permissions.length > 3 && <span style={{ fontSize: 9, color: 'var(--muted)' }}>+{key.permissions.length - 3}</span>}
                  </div></td>
                  <td><span className={KEY_STATUS[key.status] || 'nav-badge'}>{key.status}</span></td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{key.requestCount.toLocaleString()}</td>
                  <td>{key.rateLimit}/min</td>
                  <td style={{ color: 'var(--muted)', fontSize: 11 }}>{key.lastUsed ? ago(key.lastUsed) : '—'}</td>
                  <td>
                    {key.status === 'active' && (
                      <button className="btn-ghost" style={{ fontSize: 11, color: '#EF4444', padding: '2px 8px' }}
                        onClick={() => handleRevoke(key)}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// MONITOR TAB
// ══════════════════════════════════════════════════════════════════════
function MonitorTab({ apiLogs, reload }: { apiLogs: ApiLog[]; reload: () => void }) {
  const [filter, setFilter] = useState<'all' | 'inbound' | 'outbound' | 'errors'>('all')
  const [partner, setPartner] = useState('all')

  const partners = [...new Set(apiLogs.map(l => l.partnerName))]
  const filtered = apiLogs.filter(l => {
    if (filter === 'inbound' && l.direction !== 'inbound') return false
    if (filter === 'outbound' && l.direction !== 'outbound') return false
    if (filter === 'errors' && l.success) return false
    if (partner !== 'all' && l.partnerName !== partner) return false
    return true
  })

  const inbound = apiLogs.filter(l => l.direction === 'inbound').length
  const outbound = apiLogs.filter(l => l.direction === 'outbound').length
  const errors = apiLogs.filter(l => !l.success).length

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'inbound', 'outbound', 'errors'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)',
              background: filter === f ? 'var(--blue)' : 'white', color: filter === f ? 'white' : 'var(--text)',
              fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}>{f === 'all' ? `All (${apiLogs.length})` : f === 'inbound' ? `↙ In (${inbound})` : f === 'outbound' ? `↗ Out (${outbound})` : `✗ Errors (${errors})`}</button>
          ))}
        </div>
        <select style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'inherit' }}
          value={partner} onChange={e => setPartner(e.target.value)}>
          <option value="all">All Partners</option>
          {partners.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn-ghost" style={{ fontSize: 12, marginLeft: 'auto' }} onClick={reload}>↺ Refresh</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>
              <th>Time</th><th>Dir</th><th>Method</th><th>Endpoint</th><th>Partner</th>
              <th>Status</th><th>Duration</th><th>Size</th><th>Request ID</th>
            </tr></thead>
            <tbody>
              {filtered.slice(0, 60).map(log => (
                <tr key={log.id} style={{ background: !log.success ? 'rgba(239,68,68,0.03)' : undefined }}>
                  <td style={{ color: 'var(--muted)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(log.ts)}</td>
                  <td><span style={{ color: DIR_COLOR[log.direction], fontWeight: 700, fontSize: 11 }}>
                    {log.direction === 'inbound' ? '↙ IN' : '↗ OUT'}
                  </span></td>
                  <td><span style={{ fontSize: 10, fontWeight: 700, color: log.method === 'GET' ? '#5B7FE8' : log.method === 'POST' ? '#10B981' : '#F59E0B' }}>{log.method}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{log.endpoint}</td>
                  <td style={{ fontSize: 11 }}>{log.partnerName.split(' ')[0]}</td>
                  <td><span style={{ color: log.success ? '#10B981' : '#EF4444', fontWeight: 700, fontSize: 12 }}>{log.statusCode}</span>
                    {log.error && <span style={{ fontSize: 9, color: '#EF4444', marginLeft: 4 }}>{log.error}</span>}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, color: log.duration > 300 ? '#F59E0B' : 'inherit' }}>{fmtMs(log.duration)}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 10 }}>{log.requestSize}B / {log.responseSize}B</td>
                  <td><code style={{ fontSize: 9 }}>{log.requestId}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// USSD TAB
// ══════════════════════════════════════════════════════════════════════
function UssdTab({ sessions, partners, reload, showToast }: {
  sessions: UssdSession[]; partners: MnoPartner[]
  reload: () => void; showToast: (t: ToastMessage['type'], m: string) => void
}) {
  const [simMsisdn, setSimMsisdn] = useState('+263771234567')
  const [simPartner, setSimPartner] = useState('mno-001')
  const [running, setRunning] = useState(false)
  const [simLog, setSimLog] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<'idle' | 'active' | 'done'>('idle')
  const [sessionId] = useState(`SIM${Date.now().toString(36).toUpperCase()}`)
  const termRef = useRef<HTMLDivElement>(null)

  async function startSim() {
    setRunning(true)
    setSimLog([])
    setPhase('active')
    setInput('')
    const keys = mnoStore.apiKeys.list().filter(k => k.partnerId === simPartner && k.status === 'active')
    if (!keys.length) { showToast('error', 'No active API key for this partner'); setRunning(false); setPhase('idle'); return }
    const ip = simPartner === 'mno-001' ? '196.43.113.10' : '196.43.112.44'
    const payload = { sessionId, msisdn: simMsisdn, input: '', serviceCode: '*233#', networkCode: simPartner, partnerCode: simPartner }
    const res = await handleUssdAction(keys[0].keyPrefix, ip, payload)
    const text = (res.data as { text: string })?.text ?? 'END Error'
    setSimLog([text])
    setRunning(false)
    reload()
    if (text.startsWith('END')) setPhase('done')
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }

  async function sendInput() {
    if (!input.trim()) return
    const keys = mnoStore.apiKeys.list().filter(k => k.partnerId === simPartner && k.status === 'active')
    if (!keys.length) return
    const ip = simPartner === 'mno-001' ? '196.43.113.10' : '196.43.112.44'
    setRunning(true)
    const payload = { sessionId, msisdn: simMsisdn, input: input.trim(), serviceCode: '*233#', networkCode: simPartner, partnerCode: simPartner }
    const res = await handleUssdAction(keys[0].keyPrefix, ip, payload)
    const text = (res.data as { text: string })?.text ?? 'END Error'
    setSimLog(prev => [...prev, `> ${input.trim()}`, text])
    setInput('')
    setRunning(false)
    reload()
    if (text.startsWith('END')) setPhase('done')
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }

  const STATUS_COLORS: Record<string, string> = { active: '#10B981', completed: '#5B7FE8', timeout: '#F59E0B', cancelled: '#6B7E99' }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16 }}>
      {/* Session List */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">USSD Sessions</span>
          <button className="btn-ghost" style={{ fontSize: 11 }} onClick={reload}>↺</button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>
              <th>Session ID</th><th>MSISDN</th><th>Partner</th><th>Flow</th>
              <th>Steps</th><th>Status</th><th>Outcome</th><th>Started</th>
            </tr></thead>
            <tbody>
              {sessions.slice(0, 30).map(s => (
                <tr key={s.id}>
                  <td><code style={{ fontSize: 9 }}>{s.sessionId.slice(0, 12)}</code></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.msisdn}</td>
                  <td style={{ fontSize: 11 }}>{s.partnerName.split(' ')[0]}</td>
                  <td>{s.flowType
                    ? <span style={{ fontSize: 10, background: 'var(--blue-soft)', color: 'var(--blue)', padding: '1px 6px', borderRadius: 8 }}>{s.flowType}</span>
                    : '—'}</td>
                  <td style={{ textAlign: 'center' }}>{s.steps.length}</td>
                  <td><span style={{ fontSize: 10, fontWeight: 600, color: STATUS_COLORS[s.status] }}>{s.status.toUpperCase()}</span></td>
                  <td style={{ fontSize: 10, color: 'var(--muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.outcome ?? '—'}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 11 }}>{ago(s.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* USSD Simulator */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="card-header"><span className="card-title">📱 USSD Simulator</span></div>
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <label className="form-label">MSISDN</label>
              <input className="form-input" value={simMsisdn} onChange={e => setSimMsisdn(e.target.value)} placeholder="+263771234567" disabled={phase === 'active'} />
            </div>
            <div>
              <label className="form-label">Partner</label>
              <select className="form-input" value={simPartner} onChange={e => setSimPartner(e.target.value)} disabled={phase === 'active'}>
                {partners.filter(p => p.status !== 'suspended').map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Phone screen */}
        <div style={{ margin: '0 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: '#0F1C2E', borderRadius: 10, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 260 }}>
            <div style={{ background: '#4169E1', padding: '6px 12px', fontSize: 10, color: 'rgba(255,255,255,0.7)', display: 'flex', justifyContent: 'space-between' }}>
              <span>*233# · Enpasent Multiple Agent</span>
              <span>{simMsisdn}</span>
            </div>
            <div ref={termRef} style={{ flex: 1, padding: 12, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, color: '#E2E8F0', lineHeight: 1.6, minHeight: 200, maxHeight: 280 }}>
              {simLog.length === 0 && phase === 'idle' && (
                <div style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 40 }}>
                  Press Dial *233# to start
                </div>
              )}
              {simLog.map((line, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  {line.split('\n').map((l, j) => (
                    <div key={j} style={{ color: l.startsWith('>') ? '#34D399' : l.startsWith('END') ? '#F87171' : l.startsWith('CON') ? '#93C5FD' : '#E2E8F0' }}>
                      {l}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {phase === 'active' && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '8px 12px', display: 'flex', gap: 6 }}>
                <input
                  style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '5px 8px', color: 'white', fontSize: 12, fontFamily: 'monospace', outline: 'none' }}
                  value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !running && sendInput()}
                  placeholder="Enter option number…" disabled={running}
                  autoFocus
                />
                <button onClick={sendInput} disabled={running || !input.trim()}
                  style={{ background: '#4169E1', border: 'none', borderRadius: 6, padding: '5px 12px', color: 'white', cursor: 'pointer', fontSize: 12 }}>
                  {running ? '…' : 'Send'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: 16, display: 'flex', gap: 8 }}>
          {phase === 'idle' && (
            <button className="btn-primary" style={{ flex: 1 }} onClick={startSim} disabled={running}>
              📞 Dial *233#
            </button>
          )}
          {phase === 'active' && (
            <button className="btn-ghost" style={{ flex: 1, color: '#EF4444' }}
              onClick={() => { setPhase('done'); setSimLog(prev => [...prev, 'END Session ended by user.']) }}>
              End Session
            </button>
          )}
          {phase === 'done' && (
            <button className="btn-ghost" style={{ flex: 1 }} onClick={() => { setPhase('idle'); setSimLog([]) }}>
              New Session
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// WEBHOOKS TAB
// ══════════════════════════════════════════════════════════════════════
function WebhooksTab({ events, onRetry, reload }: {
  events: IntegrationEvent[]; onRetry: () => void; reload: () => void
}) {
  const failed = events.filter(e => e.status === 'failed' || e.status === 'retrying').length
  const delivered = events.filter(e => e.status === 'delivered').length

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Total Events" value={String(events.length)} sub="last 60 events" color="blue" icon="📨" />
        <StatCard label="Delivered" value={String(delivered)} sub={`${events.length ? Math.round(delivered / events.length * 100) : 100}% delivery rate`} color="teal" icon="✓" />
        <StatCard label="Failed / Retrying" value={String(failed)} sub="need attention" color={failed > 0 ? 'gold' : 'teal'} icon="⚠" />
      </div>

      {failed > 0 && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#92400E', fontSize: 12, flex: 1 }}>⚠ {failed} webhook(s) failed or pending retry</span>
          <button className="btn-primary" style={{ fontSize: 12 }} onClick={onRetry}>↺ Retry All</button>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <span className="card-title">Event Delivery Log</span>
          <button className="btn-ghost" style={{ fontSize: 11 }} onClick={reload}>↺</button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>
              <th>Time</th><th>Event</th><th>Partner</th><th>Direction</th>
              <th>Status</th><th>Attempts</th><th>Webhook URL</th><th>Error</th>
            </tr></thead>
            <tbody>
              {events.map(evt => (
                <tr key={evt.id}>
                  <td style={{ color: 'var(--muted)', fontSize: 11 }}>{fmtTime(evt.ts)}</td>
                  <td style={{ fontSize: 11 }}><code>{evt.type}</code></td>
                  <td style={{ fontSize: 11 }}>{evt.partnerName.split(' ')[0]}</td>
                  <td><span style={{ color: DIR_COLOR[evt.direction], fontWeight: 600, fontSize: 11 }}>
                    {evt.direction === 'inbound' ? '↙ IN' : '↗ OUT'}
                  </span></td>
                  <td><span style={{ width: 7, height: 7, borderRadius: '50%', background: EVT_STATUS[evt.status], display: 'inline-block', marginRight: 5 }} />
                    <span style={{ fontSize: 11 }}>{evt.status}</span></td>
                  <td style={{ textAlign: 'center' }}>{evt.attempts}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {evt.webhookUrl ?? '—'}</td>
                  <td style={{ fontSize: 10, color: '#EF4444' }}>{evt.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// AUDIT LOG TAB
// ══════════════════════════════════════════════════════════════════════
function AuditTab({ apiLogs }: { apiLogs: ApiLog[] }) {
  const [search, setSearch] = useState('')
  const filtered = apiLogs.filter(l =>
    !search || l.endpoint.includes(search) || l.partnerName.toLowerCase().includes(search.toLowerCase()) || l.requestId.includes(search)
  )

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <input className="form-input" style={{ maxWidth: 380 }} placeholder="Search endpoint, partner, request ID…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>
              <th>Timestamp</th><th>Direction</th><th>Method</th><th>Endpoint</th>
              <th>Partner</th><th>Key</th><th>IP</th><th>Status</th><th>Duration</th><th>Request ID</th>
            </tr></thead>
            <tbody>
              {filtered.slice(0, 80).map(log => (
                <tr key={log.id} style={{ background: !log.success ? 'rgba(239,68,68,0.04)' : undefined }}>
                  <td style={{ fontFamily: 'monospace', fontSize: 10 }}>
                    {new Date(log.ts).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td style={{ color: DIR_COLOR[log.direction], fontWeight: 700, fontSize: 10 }}>{log.direction.toUpperCase()}</td>
                  <td style={{ fontWeight: 700, fontSize: 10, color: log.method === 'GET' ? '#5B7FE8' : '#10B981' }}>{log.method}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{log.endpoint}</td>
                  <td style={{ fontSize: 11 }}>{log.partnerName.split(' ')[0]}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 9 }}>{log.apiKeyPrefix ?? '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{log.ip ?? '—'}</td>
                  <td>
                    <span style={{ color: log.success ? '#10B981' : '#EF4444', fontWeight: 700, fontSize: 11 }}>{log.statusCode}</span>
                    {!log.success && <span style={{ fontSize: 9, color: '#EF4444', marginLeft: 4 }}>{log.error}</span>}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, color: log.duration > 300 ? '#F59E0B' : 'inherit' }}>{fmtMs(log.duration)}</td>
                  <td><code style={{ fontSize: 9 }}>{log.requestId}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────
function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <div className="stat-card-label">{label}</div>
        <div className={`stat-card-icon icon-${color}`}>{icon}</div>
      </div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-sub">{sub}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{label}</div>
    </div>
  )
}
