import { useEffect, useRef, useState } from 'react'
import { health } from '../../lib/health'
import type { DbOp } from '../../lib/health'

interface Stats {
  uptime: number
  totalOps: number
  sbConnected: boolean
  sbSuccessPct: number
  readSuccessPct: number
  writeSuccessPct: number
  avgMs: number
  overall: 'healthy' | 'degraded' | 'offline'
  localMode: boolean
  recent: DbOp[]
}

function fmtUptime(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const STATUS_COLOR: Record<string, string> = {
  healthy: '#10B981',
  degraded: '#F59E0B',
  offline: '#EF4444',
}

const OP_COLOR: Record<string, string> = {
  read: '#5B7FE8',
  write: '#10B981',
  delete: '#EF4444',
}

export default function SystemHealth() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'overview' | 'log'>('overview')
  const [stats, setStats] = useState<Stats>(() => health.stats as Stats)
  const [ticker, setTicker] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = health.subscribe(() => setStats(health.stats as Stats))
    const interval = setInterval(() => setTicker(t => t + 1), 1000)
    return () => { unsub(); clearInterval(interval) }
  }, [])

  useEffect(() => {
    if (open && tab === 'log' && logRef.current) {
      logRef.current.scrollTop = 0
    }
  }, [open, tab, stats.recent.length])

  const dot = STATUS_COLOR[stats.overall]

  return (
    <>
      {/* Floating trigger */}
      <button
        className="syshealth-btn"
        onClick={() => setOpen(o => !o)}
        title="System Health"
        aria-label="System Health Monitor"
      >
        <span className="syshealth-dot" style={{ background: dot }} />
        <span className="syshealth-btn-label">SYS</span>
      </button>

      {/* Panel */}
      {open && (
        <div className="syshealth-panel">
          <div className="syshealth-header">
            <div className="syshealth-title">
              <span className="syshealth-dot lg" style={{ background: dot }} />
              System Health
              <span className="syshealth-status-label" style={{ color: dot }}>
                {stats.overall.toUpperCase()}
              </span>
            </div>
            <button className="syshealth-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="syshealth-tabs">
            <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
            <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
              Op Log <span className="syshealth-log-count">{stats.totalOps}</span>
            </button>
          </div>

          {tab === 'overview' && (
            <div className="syshealth-body">
              {/* Source row */}
              <div className="syshealth-row">
                <span className="syshealth-row-label">Data source</span>
                <span className="syshealth-chip" style={{
                  background: stats.localMode ? '#FEF3C7' : '#D1FAE5',
                  color: stats.localMode ? '#92400E' : '#065F46',
                }}>
                  {stats.localMode ? 'Local (offline fallback)' : 'Supabase'}
                </span>
              </div>

              {/* Uptime */}
              <div className="syshealth-row">
                <span className="syshealth-row-label">Session uptime</span>
                <span className="syshealth-val">{fmtUptime(stats.uptime + ticker * 0)}</span>
              </div>

              {/* Total ops */}
              <div className="syshealth-row">
                <span className="syshealth-row-label">Total operations</span>
                <span className="syshealth-val">{stats.totalOps}</span>
              </div>

              {/* Avg latency */}
              <div className="syshealth-row">
                <span className="syshealth-row-label">Avg latency</span>
                <span className="syshealth-val">{stats.avgMs}ms</span>
              </div>

              <div className="syshealth-divider" />

              {/* Read success */}
              <div className="syshealth-metric">
                <div className="syshealth-metric-row">
                  <span className="syshealth-metric-label">Read success</span>
                  <span className="syshealth-metric-pct">{stats.readSuccessPct}%</span>
                </div>
                <div className="syshealth-bar-bg">
                  <div className="syshealth-bar-fill blue" style={{ width: `${stats.readSuccessPct}%` }} />
                </div>
              </div>

              {/* Write success */}
              <div className="syshealth-metric">
                <div className="syshealth-metric-row">
                  <span className="syshealth-metric-label">Write success</span>
                  <span className="syshealth-metric-pct">{stats.writeSuccessPct}%</span>
                </div>
                <div className="syshealth-bar-bg">
                  <div className="syshealth-bar-fill teal" style={{ width: `${stats.writeSuccessPct}%` }} />
                </div>
              </div>

              {/* Supabase */}
              <div className="syshealth-metric">
                <div className="syshealth-metric-row">
                  <span className="syshealth-metric-label">Supabase success</span>
                  <span className="syshealth-metric-pct">{stats.sbSuccessPct}%</span>
                </div>
                <div className="syshealth-bar-bg">
                  <div className="syshealth-bar-fill gold" style={{ width: `${stats.sbSuccessPct}%` }} />
                </div>
              </div>

              <div className="syshealth-divider" />

              {/* Recent ops mini-table */}
              <div className="syshealth-recent-label">Recent operations</div>
              <div className="syshealth-mini-log">
                {stats.recent.slice(0, 8).map(op => (
                  <div key={op.id} className="syshealth-mini-row">
                    <span
                      className="syshealth-op-type"
                      style={{ color: OP_COLOR[op.type] }}
                    >{op.type.toUpperCase()}</span>
                    <span className="syshealth-op-table">{op.table}</span>
                    <span className="syshealth-op-src">{op.source === 'supabase' ? 'SB' : 'LC'}</span>
                    <span className="syshealth-op-ms">{op.duration}ms</span>
                    <span className={`syshealth-op-ok ${op.success ? 'ok' : 'fail'}`}>
                      {op.success ? '✓' : '✗'}
                    </span>
                  </div>
                ))}
                {stats.recent.length === 0 && (
                  <div className="syshealth-empty">No operations yet</div>
                )}
              </div>
            </div>
          )}

          {tab === 'log' && (
            <div className="syshealth-body" ref={logRef}>
              <div className="syshealth-log">
                {stats.recent.length === 0 && (
                  <div className="syshealth-empty">No operations recorded yet</div>
                )}
                {stats.recent.map(op => (
                  <div key={op.id} className={`syshealth-log-row ${op.success ? '' : 'fail'}`}>
                    <span className="syshealth-log-time">{fmtTime(op.ts)}</span>
                    <span
                      className="syshealth-op-type"
                      style={{ color: OP_COLOR[op.type] }}
                    >{op.type.toUpperCase()}</span>
                    <span className="syshealth-log-table">{op.table}</span>
                    <span className="syshealth-log-src">{op.source === 'supabase' ? '☁ SB' : '💾 LC'}</span>
                    <span className="syshealth-log-ms">{op.duration}ms</span>
                    <span className={`syshealth-op-ok ${op.success ? 'ok' : 'fail'}`}>
                      {op.success ? '✓' : '✗'}
                    </span>
                    {op.detail && <span className="syshealth-log-detail">{op.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
