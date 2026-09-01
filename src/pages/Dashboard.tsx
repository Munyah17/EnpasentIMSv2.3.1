import { useState, useEffect } from 'react'
import type { ActivePanel } from '../App'
import type { ToastMessage, Policy } from '../types'
import { db, type DashboardStats } from '../lib/db'
import { formatPremium } from '../lib/productUtils'
import { formatDate } from '../lib/dateUtils'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

const CATEGORY_LABELS: Record<string, string> = {
  funeral: 'Funeral Cover',
  life: 'Life Cover',
  health: 'Hospital Cash',
  accident: 'Personal Accident',
  motor: 'Motor',
  property: 'Property',
  other: 'Other',
}

const CATEGORY_CLASS: Record<string, string> = {
  funeral: 'bar-fill-blue',
  life: 'bar-fill-teal',
  health: 'bar-fill-purple',
  accident: 'bar-fill-gold',
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'Just now'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(iso)
}

const EMPTY_STATS: DashboardStats = {
  activePolicies: 0, pendingClaims: 0, totalPremiums: 0, newLeads: 0, fraudAlerts: 0, lapseRate: 0, totalClients: 0,
  productBreakdown: [], recentPolicies: [], latestClaim: null, latestPayment: null, latestLead: null, latestFraud: null, latestClient: null,
}

export default function Dashboard({ setActivePanel }: Props) {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [chartPeriod, setChartPeriod] = useState<'week' | 'month' | 'quarter'>('month')

  useEffect(() => {
    db.dashboardStats.load().then(({ data }) => { setStats(data); setLoading(false) })
  }, [])

  const recentPolicies: Policy[] = stats.recentPolicies
  const maxCount = Math.max(...stats.productBreakdown.map(p => p.count), 1)

  const activity = [
    stats.latestClient && { icon: '👤', text: `New client registered: ${stats.latestClient.name}`, at: stats.latestClient.at, cls: 'activity-icon-purple' },
    recentPolicies[0] && { icon: '🛡', text: `New policy issued to ${recentPolicies[0].clientName}`, at: recentPolicies[0].createdAt, cls: 'activity-icon-blue' },
    stats.latestClaim && { icon: '📋', text: `Claim ${stats.latestClaim.claimNumber} submitted by ${stats.latestClaim.clientName}`, at: stats.latestClaim.at, cls: 'activity-icon-gold' },
    stats.latestPayment && { icon: '💳', text: `Payment received from ${stats.latestPayment.clientName}: $${stats.latestPayment.amount}`, at: stats.latestPayment.at, cls: 'activity-icon-teal' },
    stats.latestLead && { icon: '🎯', text: `New lead: ${stats.latestLead.name} via ${stats.latestLead.source}`, at: stats.latestLead.at, cls: 'activity-icon-purple' },
    stats.latestFraud && { icon: '⚠', text: `Fraud alert on claim ${stats.latestFraud.claimNumber}: Score ${stats.latestFraud.fraudScore}%`, at: stats.latestFraud.at, cls: 'activity-icon-danger' },
  ].filter(Boolean).map(a => ({ ...(a as { icon: string; text: string; at: string; cls: string }), time: timeAgo((a as { at: string }).at) }))
    .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())

  if (loading) return <div className="panel"><div className="empty-state">Loading dashboard…</div></div>

  return (
    <div className="panel">
      <div className="stats-grid">
        <div className="stat-card stat-card-clickable" onClick={() => setActivePanel('policies')}>
          <div className="stat-icon stat-icon-blue">🛡</div>
          <div className="stat-body">
            <div className="stat-value">{stats.activePolicies}</div>
            <div className="stat-label">Active Policies</div>
          </div>
        </div>
        <div className="stat-card stat-card-clickable" onClick={() => setActivePanel('clients')}>
          <div className="stat-icon stat-icon-purple">👥</div>
          <div className="stat-body">
            <div className="stat-value">{stats.totalClients}</div>
            <div className="stat-label">Total Clients</div>
          </div>
        </div>
        <div className="stat-card stat-card-clickable" onClick={() => setActivePanel('claims')}>
          <div className="stat-icon stat-icon-gold">📋</div>
          <div className="stat-body">
            <div className="stat-value">{stats.pendingClaims}</div>
            <div className="stat-label">Pending Claims</div>
            <div className="stat-delta negative">{stats.pendingClaims > 0 ? 'Requires attention' : 'All clear'}</div>
          </div>
        </div>
        <div className="stat-card stat-card-clickable" onClick={() => setActivePanel('payments')}>
          <div className="stat-icon stat-icon-teal">💳</div>
          <div className="stat-body">
            <div className="stat-value">${stats.totalPremiums.toFixed(0)}</div>
            <div className="stat-label">Premiums Collected</div>
            <div className="stat-delta positive">This month</div>
          </div>
        </div>
        <div className="stat-card stat-card-clickable" onClick={() => setActivePanel('leads')}>
          <div className="stat-icon stat-icon-purple">🎯</div>
          <div className="stat-body">
            <div className="stat-value">{stats.newLeads}</div>
            <div className="stat-label">New Leads</div>
            <div className="stat-delta positive">+{stats.newLeads} this week</div>
          </div>
        </div>
        <div className="stat-card stat-card-clickable" onClick={() => setActivePanel('fraud')}>
          <div className="stat-icon stat-icon-danger">⚠</div>
          <div className="stat-body">
            <div className="stat-value">{stats.fraudAlerts}</div>
            <div className="stat-label">Fraud Alerts</div>
            <div className="stat-delta negative">{stats.fraudAlerts > 0 ? 'Investigate now' : 'All clear'}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-danger">📉</div>
          <div className="stat-body">
            <div className="stat-value">{stats.lapseRate}%</div>
            <div className="stat-label">Lapse Rate</div>
            <div className="stat-delta negative">Monitor closely</div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card dashboard-card-wide">
          <div className="card-header">
            <h3 className="card-title">Recent Policies</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActivePanel('policies')}>View All</button>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Policy No.</th>
                <th>Client</th>
                <th>Product</th>
                <th>Premium</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentPolicies.length === 0 ? (
                <tr><td colSpan={5} className="td-empty">No policies yet.</td></tr>
              ) : recentPolicies.map(p => (
                <tr key={p.id}>
                  <td><span className="mono">{p.policyNumber}</span></td>
                  <td>{p.clientName}</td>
                  <td>{p.productName}</td>
                  <td>{formatPremium(p.premium, p.productCategory ?? '')}</td>
                  <td><span className={`pill pill-${p.status}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Portfolio Mix</h3>
            <div className="chart-tabs">
              {(['week', 'month', 'quarter'] as const).map(p => (
                <button
                  type="button"
                  key={p}
                  className={`chart-tab${chartPeriod === p ? ' active' : ''}`}
                  onClick={() => setChartPeriod(p)}
                >{p}</button>
              ))}
            </div>
          </div>
          <div className="bar-chart">
            {stats.productBreakdown.map(pb => (
              <div key={pb.category} className="bar-item">
                <div className="bar-label">{CATEGORY_LABELS[pb.category] ?? pb.category}</div>
                <div className="bar-track">
                  <div
                    className={`bar-fill ${CATEGORY_CLASS[pb.category] ?? 'bar-fill-blue'}`}
                    style={{ width: `${(pb.count / maxCount) * 100}%` }}
                  />
                </div>
                <div className="bar-value">{pb.count}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recent Activity</h3>
          </div>
          <div className="activity-list">
            {activity.map((a, i) => (
              <div key={i} className="activity-item">
                <div className={`activity-icon ${a.cls}`}>{a.icon}</div>
                <div className="activity-body">
                  <div className="activity-text">{a.text}</div>
                  <div className="activity-time">{a.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Quick Actions</h3>
          </div>
          <div className="quick-actions">
            <button type="button" className="btn btn-primary btn-full" onClick={() => setActivePanel('policies')}>
              🛡 New Policy
            </button>
            <button type="button" className="btn btn-secondary btn-full" onClick={() => setActivePanel('claims')}>
              📋 New Claim
            </button>
            <button type="button" className="btn btn-ghost btn-full" onClick={() => setActivePanel('clients')}>
              👥 Register Client
            </button>
            <button type="button" className="btn btn-ghost btn-full" onClick={() => setActivePanel('payments')}>
              💳 Record Payment
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
