import { useState, useEffect } from 'react'
import type { ToastMessage } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import { exportToCsv, exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatPremium } from '../lib/productUtils'
import { policyBillablePremium, billableHeadCount } from '../lib/premium'
import type { Policy, Claim, Payment, Client } from '../types'
import { formatDate } from '../lib/dateUtils'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

export default function Reports({ showToast }: Props) {
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year' | 'custom'>('month')
  const [activeTab, setActiveTab] = useState<'overview' | 'claims' | 'financials' | 'ipec'>('overview')
  const [policies, setPolicies] = useState<Policy[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      db.policies.list(),
      db.claims.list(),
      db.payments.list(),
      db.clients.list(),
    ]).then(([policiesRes, claimsRes, paymentsRes, clientsRes]) => {
      if (policiesRes.data) setPolicies(policiesRes.data)
      if (claimsRes.data) setClaims(claimsRes.data)
      if (paymentsRes.data) setPayments(paymentsRes.data)
      if (clientsRes.data) setClients(clientsRes.data)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="panel">Loading reports…</div>

  const totalPolicies = policies.length
  const activePolicies = policies.filter(p => p.status === 'active').length
  const lapseRate = totalPolicies > 0 ? ((policies.filter(p => p.status === 'lapsed').length / totalPolicies) * 100).toFixed(1) : '0'
  const totalPremiums = payments.filter(p => p.status === 'completed').reduce((s, p) => s + p.amount, 0)
  const totalClaims = claims.length
  const paidClaims = claims.filter(c => c.status === 'paid')
  const totalPaid = paidClaims.reduce((s, c) => s + c.amount, 0)
  const claimsRatio = totalPremiums > 0 ? ((totalPaid / totalPremiums) * 100).toFixed(1) : '0'

  // Revenue is what a policy actually bills — per head, so a family policy
  // counts every dependant's premium, not just the policyholder's.
  const productBreakdown = Object.values(
    policies.reduce<Record<string, { name: string; policies: number; revenue: number }>>((acc, p) => {
      const key = p.productName || 'Unknown'
      if (!acc[key]) acc[key] = { name: key, policies: 0, revenue: 0 }
      acc[key].policies += 1
      acc[key].revenue += policyBillablePremium(p)
      return acc
    }, {}),
  ).sort((a, b) => b.policies - a.policies)

  const completedPayments = payments.filter(p => p.status === 'completed')
  const pendingPayments = payments.filter(p => p.status === 'pending')
  const failedPayments = payments.filter(p => p.status === 'failed')
  const outstanding = pendingPayments.reduce((s, p) => s + p.amount, 0)
  const failedValue = failedPayments.reduce((s, p) => s + p.amount, 0)
  const collectionRate = payments.length > 0 ? ((completedPayments.length / payments.length) * 100).toFixed(1) : '0'
  const avgPremium = totalPolicies > 0 ? (policies.reduce((s, p) => s + policyBillablePremium(p), 0) / totalPolicies) : 0

  const methodBreakdown = Object.values(
    payments.reduce<Record<string, { method: string; count: number; amount: number }>>((acc, p) => {
      const key = p.method || 'Unknown'
      if (!acc[key]) acc[key] = { method: key, count: 0, amount: 0 }
      acc[key].count += 1
      acc[key].amount += p.amount
      return acc
    }, {}),
  ).sort((a, b) => b.amount - a.amount)

  const insurerBreakdown = Object.values(
    policies.reduce<Record<string, { name: string; policies: number; revenue: number }>>((acc, p) => {
      const key = p.insurer || 'Unassigned'
      if (!acc[key]) acc[key] = { name: key, policies: 0, revenue: 0 }
      acc[key].policies += 1
      acc[key].revenue += policyBillablePremium(p)
      return acc
    }, {}),
  ).sort((a, b) => b.revenue - a.revenue)

  const monthlyCollections = Object.values(
    completedPayments.reduce<Record<string, { month: string; amount: number; count: number }>>((acc, p) => {
      const key = (p.date || '').slice(0, 7) || 'Unknown'
      if (!acc[key]) acc[key] = { month: key, amount: 0, count: 0 }
      acc[key].amount += p.amount
      acc[key].count += 1
      return acc
    }, {}),
  ).sort((a, b) => a.month.localeCompare(b.month)).slice(-6)

  const topClients = Object.values(
    policies.reduce<Record<string, { name: string; policies: number; premium: number }>>((acc, p) => {
      if (!acc[p.clientId]) acc[p.clientId] = { name: p.clientName, policies: 0, premium: 0 }
      acc[p.clientId].policies += 1
      acc[p.clientId].premium += policyBillablePremium(p)
      return acc
    }, {}),
  ).sort((a, b) => b.premium - a.premium).slice(0, 8)

  const claimsByStage = Object.values(
    claims.reduce<Record<string, { stage: string; count: number; amount: number }>>((acc, c) => {
      const key = c.stage || 'Unknown'
      if (!acc[key]) acc[key] = { stage: key, count: 0, amount: 0 }
      acc[key].count += 1
      acc[key].amount += c.amount
      return acc
    }, {}),
  ).sort((a, b) => b.count - a.count)

  const maxMonthlyAmount = Math.max(1, ...monthlyCollections.map(m => m.amount))

  const dateStamp = new Date().toISOString().split('T')[0]

  const handleExport = async (format: 'PDF' | 'Excel' | 'CSV' | 'IPEC PDF') => {
    if (format === 'IPEC PDF') {
      await exportToPdf(
        `ipec-return-${dateStamp}.pdf`, 'IPEC Quarterly Return', ['Field', 'Value'],
        [
          ['Intermediary Name', 'Enpasent Multiple Agent (Pvt) Ltd'],
          ['IPEC Reg. Number', 'IPEC/IB/2020/001'],
          ['Total Policies Issued', totalPolicies],
          ['Active Policies', activePolicies],
          ['Gross Premiums Written', `$${totalPremiums.toFixed(2)}`],
          ['Claims Incurred', `$${totalPaid.toFixed(2)}`],
          ['Claims Ratio', `${claimsRatio}%`],
          ['Lapse Rate', `${lapseRate}%`],
          ['Total Clients', clients.length],
        ],
        `Generated ${formatDate(new Date())}`,
      )
      showToast('success', 'IPEC return downloaded.')
      return
    }

    let headers: string[]
    let rows: (string | number)[][]
    let title: string
    let baseName: string

    if (activeTab === 'claims') {
      title = 'Claims Analysis'
      baseName = 'claims-analysis'
      headers = ['Claim No.', 'Client', 'Amount', 'Type', 'Fraud Score', 'Status']
      rows = claims.map(c => [c.claimNumber, c.clientName, c.amount, c.claimType, `${c.fraudScore}%`, c.status])
    } else if (activeTab === 'financials') {
      title = 'Financials Report'
      baseName = 'financials-report'
      headers = ['Reference', 'Client', 'Amount', 'Method', 'Status', 'Date']
      rows = payments.map(p => [p.reference, p.clientName, `$${p.amount.toFixed(2)}`, p.method, p.status, p.date])
    } else if (activeTab === 'ipec') {
      title = 'IPEC Quarterly Return'
      baseName = 'ipec-return'
      headers = ['Field', 'Value']
      rows = [
        ['Intermediary Name', 'Enpasent Multiple Agent (Pvt) Ltd'],
        ['IPEC Reg. Number', 'IPEC/IB/2020/001'],
        ['Total Policies Issued', totalPolicies],
        ['Active Policies', activePolicies],
        ['Gross Premiums Written', `$${totalPremiums.toFixed(2)}`],
        ['Claims Incurred', `$${totalPaid.toFixed(2)}`],
        ['Claims Ratio', `${claimsRatio}%`],
        ['Lapse Rate', `${lapseRate}%`],
        ['Total Clients', clients.length],
      ]
    } else {
      title = 'Policy Report: Overview'
      baseName = 'policies-report'
      headers = ['Policy No.', 'Client', 'Product', 'Premium', 'Status', 'Start Date']
      rows = policies.map(p => [
        p.policyNumber, p.clientName, p.productName,
        // The billed figure, with the head count that explains it.
        `${formatPremium(policyBillablePremium(p), p.productCategory ?? '')}${billableHeadCount(p) > 1 ? ` (${billableHeadCount(p)} members)` : ''}`,
        p.status, p.startDate,
      ])
    }

    if (format === 'CSV') exportToCsv(`${baseName}-${dateStamp}.csv`, headers, rows)
    else if (format === 'Excel') await exportToExcel(`${baseName}-${dateStamp}.xlsx`, title, headers, rows)
    else await exportToPdf(`${baseName}-${dateStamp}.pdf`, title, headers, rows, `Generated ${formatDate(new Date())}`)

    showToast('success', `${title} exported as ${format}.`)
  }

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="tabs" style={{ marginBottom: 0 }}>
          {([['overview', 'Overview'], ['claims', 'Claims Analysis'], ['financials', 'Financials'], ['ipec', 'IPEC Report']] as [typeof activeTab, string][]).map(([t, label]) => (
            <button key={t} className={`tab${activeTab === t ? ' active' : ''}`} onClick={() => setActiveTab(t)}>{label}</button>
          ))}
        </div>
        <div className="filter-row">
          <select className="filter-select" value={period} onChange={e => setPeriod(e.target.value as typeof period)}>
            <option value="month">This Month</option>
            <option value="quarter">This Quarter</option>
            <option value="year">This Year</option>
            <option value="custom">Custom Range</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => handleExport('PDF')}>↓ PDF</button>
          <button className="btn btn-ghost btn-sm" onClick={() => handleExport('Excel')}>↓ Excel</button>
          <button className="btn btn-ghost btn-sm" onClick={() => handleExport('CSV')}>↓ CSV</button>
        </div>
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(91,127,232,0.15)', color: 'var(--blue)' }}>🛡</div>
              <div className="stat-body">
                <div className="stat-value">{totalPolicies}</div>
                <div className="stat-label">Total Policies</div>
                <div className="stat-delta positive">{activePolicies} active</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--teal)' }}>💰</div>
              <div className="stat-body">
                <div className="stat-value">${totalPremiums.toFixed(0)}</div>
                <div className="stat-label">Total Premiums</div>
                <div className="stat-delta positive">Collected</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--gold)' }}>📋</div>
              <div className="stat-body">
                <div className="stat-value">{totalClaims}</div>
                <div className="stat-label">Total Claims</div>
                <div className="stat-delta">{paidClaims.length} paid</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--purple)' }}>📊</div>
              <div className="stat-body">
                <div className="stat-value">{claimsRatio}%</div>
                <div className="stat-label">Claims Ratio</div>
                <div className="stat-delta">Paid / Premiums</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--danger)' }}>📉</div>
              <div className="stat-body">
                <div className="stat-value">{lapseRate}%</div>
                <div className="stat-label">Lapse Rate</div>
                <div className="stat-delta negative">Monitor</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(91,127,232,0.15)', color: 'var(--blue)' }}>👥</div>
              <div className="stat-body">
                <div className="stat-value">{clients.length}</div>
                <div className="stat-label">Total Clients</div>
                <div className="stat-delta positive">{clients.filter(c => c.status === 'active').length} active</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--teal)' }}>📈</div>
              <div className="stat-body">
                <div className="stat-value">${avgPremium.toFixed(2)}</div>
                <div className="stat-label">Avg. Premium / Policy</div>
                <div className="stat-delta">Per year</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--gold)' }}>⏳</div>
              <div className="stat-body">
                <div className="stat-value">${outstanding.toFixed(0)}</div>
                <div className="stat-label">Outstanding Payments</div>
                <div className="stat-delta">{pendingPayments.length} pending</div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: '1.5rem' }}>
            <div className="card-header"><h3 className="card-title">Product Performance</h3></div>
            <table className="table">
              <thead>
                <tr><th>Product</th><th>Policies</th><th>Annual Revenue ($)</th><th>Share</th></tr>
              </thead>
              <tbody>
                {productBreakdown.map(p => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{p.policies}</td>
                    <td>${p.revenue.toFixed(2)}</td>
                    <td>
                      <div className="bar-track" style={{ height: 8, width: 120, display: 'inline-block' }}>
                        <div className="bar-fill" style={{ width: `${(p.policies / totalPolicies) * 100}%`, background: 'var(--blue)', height: '100%', borderRadius: 4 }} />
                      </div>
                      <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--muted)' }}>
                        {((p.policies / totalPolicies) * 100).toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
            <div className="card">
              <div className="card-header"><h3 className="card-title">Top Clients by Premium</h3></div>
              <table className="table">
                <thead>
                  <tr><th>Client</th><th>Policies</th><th>Annual Premium</th></tr>
                </thead>
                <tbody>
                  {topClients.length === 0 ? (
                    <tr><td colSpan={3} className="td-empty">No policies yet.</td></tr>
                  ) : topClients.map(c => (
                    <tr key={c.name}>
                      <td><strong>{c.name}</strong></td>
                      <td>{c.policies}</td>
                      <td>${c.premium.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <div className="card-header"><h3 className="card-title">Business by Insurer</h3></div>
              <table className="table">
                <thead>
                  <tr><th>Insurer</th><th>Policies</th><th>Revenue</th></tr>
                </thead>
                <tbody>
                  {insurerBreakdown.length === 0 ? (
                    <tr><td colSpan={3} className="td-empty">No policies yet.</td></tr>
                  ) : insurerBreakdown.map(i => (
                    <tr key={i.name}>
                      <td>{i.name}</td>
                      <td>{i.policies}</td>
                      <td>${i.revenue.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === 'claims' && (
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Claims Analysis</h3>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '1.5rem' }}>
            {['pending', 'under_review', 'approved', 'rejected', 'paid'].map(s => (
              <div key={s} className="stat-card">
                <div className="stat-body">
                  <div className="stat-value">{claims.filter(c => c.status === s).length}</div>
                  <div className="stat-label" style={{ textTransform: 'capitalize' }}>{s.replace('_', ' ')}</div>
                </div>
              </div>
            ))}
          </div>
          <table className="table">
            <thead>
              <tr><th>Claim No.</th><th>Client</th><th>Amount</th><th>Type</th><th>Fraud Score</th><th>Status</th></tr>
            </thead>
            <tbody>
              {claims.map(c => (
                <tr key={c.id}>
                  <td><span className="mono">{c.claimNumber}</span></td>
                  <td>{c.clientName}</td>
                  <td>${c.amount.toLocaleString()}</td>
                  <td>{c.claimType}</td>
                  <td><span style={{ color: c.fraudScore >= 70 ? 'var(--danger)' : c.fraudScore >= 40 ? 'var(--gold)' : 'var(--teal)' }}>{c.fraudScore}%</span></td>
                  <td><span className={`pill pill-${c.status.replace('_', '-')}`}>{c.status.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ margin: '1.5rem 0 1rem' }}>Claims by Workflow Stage</h3>
          <table className="table">
            <thead>
              <tr><th>Stage</th><th>Count</th><th>Value</th></tr>
            </thead>
            <tbody>
              {claimsByStage.length === 0 ? (
                <tr><td colSpan={3} className="td-empty">No claims yet.</td></tr>
              ) : claimsByStage.map(s => (
                <tr key={s.stage}>
                  <td style={{ textTransform: 'capitalize' }}>{s.stage.replace('_', ' ')}</td>
                  <td>{s.count}</td>
                  <td>${s.amount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'financials' && (
        <>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--teal)' }}>✅</div>
              <div className="stat-body">
                <div className="stat-value">${completedPayments.reduce((s, p) => s + p.amount, 0).toFixed(0)}</div>
                <div className="stat-label">Collected</div>
                <div className="stat-delta positive">{completedPayments.length} payments</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--gold)' }}>⏳</div>
              <div className="stat-body">
                <div className="stat-value">${outstanding.toFixed(0)}</div>
                <div className="stat-label">Pending</div>
                <div className="stat-delta">{pendingPayments.length} payments</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--danger)' }}>✕</div>
              <div className="stat-body">
                <div className="stat-value">${failedValue.toFixed(0)}</div>
                <div className="stat-label">Failed</div>
                <div className="stat-delta negative">{failedPayments.length} payments</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: 'rgba(91,127,232,0.15)', color: 'var(--blue)' }}>%</div>
              <div className="stat-body">
                <div className="stat-value">{collectionRate}%</div>
                <div className="stat-label">Collection Rate</div>
                <div className="stat-delta">Completed / total</div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: '1.5rem' }}>
            <div className="card-header"><h3 className="card-title">Monthly Collections (last 6 months)</h3></div>
            <table className="table">
              <thead>
                <tr><th>Month</th><th>Payments</th><th>Amount</th><th></th></tr>
              </thead>
              <tbody>
                {monthlyCollections.length === 0 ? (
                  <tr><td colSpan={4} className="td-empty">No completed payments yet.</td></tr>
                ) : monthlyCollections.map(m => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{m.count}</td>
                    <td>${m.amount.toFixed(2)}</td>
                    <td>
                      <div className="bar-track" style={{ height: 8, width: 140, display: 'inline-block' }}>
                        <div className="bar-fill" style={{ width: `${(m.amount / maxMonthlyAmount) * 100}%`, background: 'var(--teal)', height: '100%', borderRadius: 4 }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: '1.5rem' }}>
            <div className="card-header"><h3 className="card-title">Payments by Method</h3></div>
            <table className="table">
              <thead>
                <tr><th>Method</th><th>Payments</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {methodBreakdown.length === 0 ? (
                  <tr><td colSpan={3} className="td-empty">No payments yet.</td></tr>
                ) : methodBreakdown.map(m => (
                  <tr key={m.method}>
                    <td style={{ textTransform: 'capitalize' }}>{m.method.replace('_', ' ')}</td>
                    <td>{m.count}</td>
                    <td>${m.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: '1.5rem' }}>
            <div className="card-header"><h3 className="card-title">Recent Payments</h3></div>
            <table className="table">
              <thead>
                <tr><th>Reference</th><th>Client</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr><td colSpan={6} className="td-empty">No payments yet.</td></tr>
                ) : [...payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15).map(p => (
                  <tr key={p.id}>
                    <td><span className="mono">{p.reference}</span></td>
                    <td>{p.clientName}</td>
                    <td>${p.amount.toFixed(2)}</td>
                    <td style={{ textTransform: 'capitalize' }}>{p.method.replace('_', ' ')}</td>
                    <td><span className={`pill pill-${p.status === 'completed' ? 'active' : p.status === 'pending' ? 'lapsed' : 'lapsed'}`}>{p.status}</span></td>
                    <td>{p.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'ipec' && (
        <div className="card" style={{ maxWidth: 700 }}>
          <div className="info-banner info-banner-info" style={{ marginBottom: '1.5rem' }}>
            ℹ IPEC Quarterly Return: Submit before the 15th of the month following quarter end.
          </div>
          <h3 style={{ marginBottom: '1.5rem' }}>IPEC Quarterly Return: Q2 2026</h3>
          <table className="table">
            <tbody>
              <tr><td><strong>Intermediary Name</strong></td><td>Enpasent Multiple Agent (Pvt) Ltd</td></tr>
              <tr><td><strong>IPEC Reg. Number</strong></td><td>IPEC/IB/2020/001</td></tr>
              <tr><td><strong>Reporting Period</strong></td><td>01 April – 30 June 2026</td></tr>
              <tr><td><strong>Total Policies Issued</strong></td><td>{totalPolicies}</td></tr>
              <tr><td><strong>Active Policies</strong></td><td>{activePolicies}</td></tr>
              <tr><td><strong>Gross Premiums Written</strong></td><td>${totalPremiums.toFixed(2)}</td></tr>
              <tr><td><strong>Claims Incurred</strong></td><td>${totalPaid.toFixed(2)}</td></tr>
              <tr><td><strong>Claims Ratio</strong></td><td>{claimsRatio}%</td></tr>
              <tr><td><strong>Lapse Rate</strong></td><td>{lapseRate}%</td></tr>
              <tr><td><strong>Total Clients</strong></td><td>{clients.length}</td></tr>
            </tbody>
          </table>
          <div style={{ marginTop: '1.5rem' }}>
            <button className="btn btn-primary" onClick={() => handleExport('IPEC PDF')}>↓ Download IPEC Return</button>
          </div>
        </div>
      )}
    </div>
  )
}
