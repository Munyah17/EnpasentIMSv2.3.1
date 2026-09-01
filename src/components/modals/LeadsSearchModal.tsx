import { useState } from 'react'
import type { Lead } from '../../types'
import { searchForLeads, type FoundLead } from '../../lib/leadsSearch'

interface Props {
  onClose: () => void
  onImport: (leads: Omit<Lead, 'id'>[]) => Promise<void>
}

export default function LeadsSearchModal({ onClose, onImport }: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<FoundLead[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [notConfigured, setNotConfigured] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    setNotConfigured(null)
    setResults(null)
    const res = await searchForLeads(query.trim())
    setSearching(false)
    if (res.simulated) { setNotConfigured(res.reason ?? 'Lead search is not configured yet.'); return }
    if (res.error) { setError(res.error); return }
    setResults(res.leads)
    setSelected(new Set(res.leads.map((_, i) => i)))
  }

  const toggle = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const handleImport = async () => {
    if (!results || selected.size === 0) return
    setImporting(true)
    const toImport: Omit<Lead, 'id'>[] = [...selected].map(i => {
      const r = results[i]
      return {
        name: r.name,
        phone: r.phone ?? '',
        source: r.source,
        productInterest: r.productInterest,
        status: 'new',
        intentScore: r.intentScore,
        createdAt: new Date().toISOString().split('T')[0],
        notes: r.notes,
      }
    })
    await onImport(toImport)
    setImporting(false)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h3>🎯 Run Leads Search</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            Searches Google for plausible prospects matching what you describe, then uses AI to pull out specific leads worth following up. Run it whenever you want a fresh batch; there's no automatic schedule.
          </p>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>What are you looking for?</label>
              <input
                className="form-control"
                placeholder="e.g. small business owners Harare, funeral cover prospects"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSearch} disabled={searching || !query.trim()}>
            {searching ? 'Searching…' : '🔍 Search'}
          </button>

          {notConfigured && (
            <div className="info-banner info-banner-warning" style={{ marginTop: 14 }}>
              ⚠ {notConfigured} This needs a Google Custom Search API key and Search Engine ID configured on the server before it can run for real.
            </div>
          )}
          {error && (
            <div className="info-banner info-banner-danger" style={{ marginTop: 14 }}>⚠ {error}</div>
          )}

          {results && (
            <div style={{ marginTop: 16 }}>
              {results.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>No plausible leads found for that search; try a different phrasing.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>{results.length} candidate{results.length !== 1 ? 's' : ''} found</label>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{selected.size} selected</span>
                  </div>
                  {results.map((r, i) => (
                    <label key={i} className="permission-item" style={{ alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} style={{ marginTop: 3 }} />
                      <span>
                        <strong>{r.name}</strong> {r.phone && <span className="mono">· {r.phone}</span>}
                        <br />
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.source} · {r.productInterest} · Intent {r.intentScore}%</span>
                        <br />
                        <span style={{ fontSize: 11, fontStyle: 'italic' }}>{r.notes}</span>
                      </span>
                    </label>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {results && results.length > 0 && (
            <button className="btn btn-primary" onClick={handleImport} disabled={importing || selected.size === 0}>
              {importing ? 'Importing…' : `Import ${selected.size} Lead${selected.size !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
