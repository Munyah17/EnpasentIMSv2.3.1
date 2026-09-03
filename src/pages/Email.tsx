import { useState, useEffect } from 'react'
import type { ToastMessage, EmailMessage } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import { sendEmail } from '../lib/mailService'
import { MAILBOXES } from '../lib/mailboxes'
import { useAuth } from '../contexts/AuthContext'
import { ACCEPTED_DOCUMENT_TYPES } from '../lib/storage'
import { formatDateTime } from '../lib/dateUtils'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

type Folder = 'inbox' | 'sent' | 'draft' | 'claims' | 'starred'

interface ComposeState {
  to: string
  cc: string
  subject: string
  body: string
  replyTo?: string
  from?: string
}

const MAILBOX_LIST = Object.values(MAILBOXES)

const FOLDER_ICONS: Record<Folder, string> = {
  inbox: '📥',
  sent: '📤',
  draft: '📝',
  claims: '📋',
  starred: '⭐',
}

const FOLDER_LABELS: Record<Folder, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  draft: 'Drafts',
  claims: 'Claims',
  starred: 'Starred',
}

/** Inbox-list shorthand: a time for today, a weekday within the week, then
 *  day and named month. Never a bare numeric date, so there is nothing here
 *  that could be read month-first. The full timestamp uses the house
 *  format below. */
function formatDate(ts: string) {
  const d = new Date(ts)
  const diff = (Date.now() - d.getTime()) / 86400000
  if (diff < 1) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' })
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

const formatFull = (ts: string) => formatDateTime(ts)

export default function Email({ showToast }: Props) {
  const { user, hasPermission } = useAuth()
  const canChooseSender = user?.role === 'super_admin' || user?.role === 'admin'
  const [emails, setEmails] = useState<EmailMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [folder, setFolder] = useState<Folder>('inbox')
  const [selected, setSelected] = useState<EmailMessage | null>(null)
  const [showCompose, setShowCompose] = useState(false)
  const [compose, setCompose] = useState<ComposeState>({ to: '', cc: '', subject: '', body: '' })
  const [attachment, setAttachment] = useState<File | null>(null)
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    db.emails.list().then(({ data, error }) => {
      if (error) showToast('error', 'Failed to load emails.')
      else if (data) setEmails(data)
      setLoading(false)
    })
  }, [showToast])

  const displayed = emails.filter(e => {
    if (folder === 'starred') return e.starred
    if (folder === 'claims') return e.folder === 'claims' || e.linkedTo
    return e.folder === folder
  }).filter(e => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      e.subject.toLowerCase().includes(q) ||
      e.from.toLowerCase().includes(q) ||
      e.to.toLowerCase().includes(q) ||
      e.body.toLowerCase().includes(q)
    )
  })

  const unreadCount = (f: Folder) => {
    if (f === 'starred') return emails.filter(e => e.starred && !e.read).length
    if (f === 'claims') return emails.filter(e => (e.folder === 'claims' || e.linkedTo) && !e.read).length
    return emails.filter(e => e.folder === f && !e.read).length
  }

  const openEmail = async (email: EmailMessage) => {
    if (!email.read) {
      await db.emails.markRead(email.id)
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, read: true } : e))
    }
    setSelected(email)
  }

  const toggleStar = async (e: React.MouseEvent, email: EmailMessage) => {
    e.stopPropagation()
    const updated = { ...email, starred: !email.starred }
    await db.emails.update(email.id, { starred: !email.starred })
    setEmails(prev => prev.map(em => em.id === email.id ? updated : em))
    if (selected?.id === email.id) setSelected(updated)
  }

  const handleSend = async () => {
    if (!compose.to.trim() || !compose.subject.trim() || !compose.body.trim()) {
      showToast('warning', 'Please fill in To, Subject, and Body.')
      return
    }
    setSending(true)
    try {
      const fromAddr = (canChooseSender && compose.from) || user?.email || 'noreply@enpassent.co.zw'
      const fromName = user?.name ?? 'Enpasent Multiple Agent'
      let attachmentBase64: string | undefined
      if (attachment) {
        attachmentBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
          reader.onerror = reject
          reader.readAsDataURL(attachment)
        })
      }
      const { email: sent, delivered, error } = await sendEmail({
        from: fromAddr,
        fromName,
        to: compose.to.trim(),
        cc: compose.cc.trim() || undefined,
        subject: compose.subject.trim(),
        body: compose.body.trim(),
        folder: 'sent',
        attachmentBase64,
        attachmentFilename: attachment?.name,
      })
      setEmails(prev => [sent, ...prev])
      setShowCompose(false)
      setCompose({ to: '', cc: '', subject: '', body: '' })
      setAttachment(null)
      if (delivered) showToast('success', `Email sent to ${compose.to}.`)
      else showToast('warning', error ?? `Email to ${compose.to} was recorded but not actually delivered.`)
    } finally {
      setSending(false)
    }
  }

  const startReply = (email: EmailMessage) => {
    setCompose({
      to: email.from,
      cc: email.cc ?? '',
      subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
      body: `\n\n---\nFrom: ${email.fromName} <${email.from}>\nDate: ${formatFull(email.timestamp)}\nSubject: ${email.subject}\n\n${email.body}`,
      replyTo: email.id,
    })
    setShowCompose(true)
  }

  const startForward = (email: EmailMessage) => {
    setCompose({
      to: '',
      cc: '',
      subject: email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`,
      body: `\n\n------- Forwarded Message -------\nFrom: ${email.fromName} <${email.from}>\nDate: ${formatFull(email.timestamp)}\nSubject: ${email.subject}\nTo: ${email.to}\n\n${email.body}`,
    })
    setShowCompose(true)
  }

  const deleteEmail = async (email: EmailMessage) => {
    await db.emails.delete(email.id)
    setEmails(prev => prev.filter(e => e.id !== email.id))
    if (selected?.id === email.id) setSelected(null)
    showToast('info', 'Email deleted.')
  }

  return (
    <div className="panel">
      <div className="email3-shell">
        {/* Top: Compose + folder nav + search, run horizontally to keep the
            list/reader panes below at full width */}
        <div className="email3-topbar">
          <button
            className="btn btn-primary"
            onClick={() => { setCompose({ to: '', cc: '', subject: '', body: '' }); setAttachment(null); setShowCompose(true) }}
          >
            ✉ Compose
          </button>

          <nav className="email3-folders">
            {(['inbox', 'sent', 'claims', 'draft', 'starred'] as Folder[]).map(f => {
              const count = unreadCount(f)
              return (
                <button
                  key={f}
                  className={`email3-folder${folder === f ? ' active' : ''}`}
                  onClick={() => { setFolder(f); setSelected(null) }}
                >
                  <span className="email3-folder-icon">{FOLDER_ICONS[f]}</span>
                  <span className="email3-folder-label">{FOLDER_LABELS[f]}</span>
                  {count > 0 && <span className="nav-badge">{count}</span>}
                </button>
              )
            })}
          </nav>

          <div className="email3-search">
            <input
              className="search-input"
              placeholder="Search emails…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ fontSize: 12 }}
            />
          </div>
        </div>

        <div className="email3-body">
        {/* Left: Email list */}
        <div className="email3-list">
          <div className="email3-list-header">
            <span className="email3-list-title">{FOLDER_LABELS[folder]}</span>
            <span className="email3-list-count">{displayed.length} emails</span>
          </div>

          {loading ? (
            <div className="empty-state">Loading emails…</div>
          ) : displayed.length === 0 ? (
            <div className="empty-state">
              {search ? 'No emails match your search.' : `No emails in ${FOLDER_LABELS[folder]}.`}
            </div>
          ) : (
            <div className="email3-items">
              {displayed.map(e => (
                <div
                  key={e.id}
                  className={`email3-item${!e.read ? ' unread' : ''}${selected?.id === e.id ? ' selected' : ''}`}
                  onClick={() => openEmail(e)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={ev => ev.key === 'Enter' && openEmail(e)}
                >
                  <button
                    className="email3-star"
                    onClick={ev => toggleStar(ev, e)}
                    title={e.starred ? 'Unstar' : 'Star'}
                  >
                    {e.starred ? '⭐' : '☆'}
                  </button>
                  <div className="email3-item-body">
                    <div className="email3-item-top">
                      <span className="email3-item-from">
                        {folder === 'sent' || folder === 'draft' ? e.to : e.fromName || e.from}
                      </span>
                      <span className="email3-item-date">{formatDate(e.timestamp)}</span>
                    </div>
                    <div className="email3-item-subject">{e.subject}</div>
                    <div className="email3-item-preview">{e.body.replace(/\n/g, ' ').substring(0, 90)}…</div>
                    {e.linkedTo && <span className="email-linked-badge">Claim Linked</span>}
                    {e.cc && <span className="email-linked-badge" style={{ background: 'var(--blue-light)', color: 'var(--blue)' }}>CC</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Email reader */}
        <div className="email3-reader">
          {!selected ? (
            <div className="email3-reader-empty">
              <div style={{ fontSize: 48, opacity: 0.15 }}>✉</div>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 12 }}>Select an email to read</p>
            </div>
          ) : (
            <div className="email3-reader-content">
              <div className="email3-reader-header">
                <h3 className="email3-reader-subject">{selected.subject}</h3>
                <div className="email3-reader-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => startReply(selected)} title="Reply">↩ Reply</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => startForward(selected)} title="Forward">↪ Forward</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => deleteEmail(selected)} title="Delete">🗑</button>
                </div>
              </div>

              <div className="email3-reader-meta">
                <div className="email3-meta-row">
                  <span className="email3-meta-label">From</span>
                  <span>{selected.fromName} &lt;{selected.from}&gt;</span>
                </div>
                <div className="email3-meta-row">
                  <span className="email3-meta-label">To</span>
                  <span>{selected.to}</span>
                </div>
                {selected.cc && (
                  <div className="email3-meta-row">
                    <span className="email3-meta-label">CC</span>
                    <span>{selected.cc}</span>
                  </div>
                )}
                <div className="email3-meta-row">
                  <span className="email3-meta-label">Date</span>
                  <span>{formatFull(selected.timestamp)}</span>
                </div>
                {selected.linkedTo && (
                  <div className="email3-meta-row">
                    <span className="email3-meta-label">Claim</span>
                    <span className="email-linked-badge" style={{ fontSize: 11 }}>Linked to Claim</span>
                  </div>
                )}
              </div>

              <div className="email3-reader-body">
                {selected.body.split('\n').map((line, i) => (
                  <p key={i} style={{ marginBottom: line.startsWith('---') ? 12 : 4, color: line.startsWith('---') ? 'var(--muted)' : undefined, fontSize: line.startsWith('---') ? 11 : 13 }}>
                    {line || ' '}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>{compose.replyTo ? 'Reply' : 'Compose Email'}</h3>
              <button className="modal-close" onClick={() => setShowCompose(false)}>✕</button>
            </div>
            <div className="modal-body">
              {canChooseSender && (
                <div className="form-group">
                  <label>From</label>
                  <select className="form-control" value={compose.from ?? user?.email ?? ''} onChange={e => setCompose(p => ({ ...p, from: e.target.value }))}>
                    <option value={user?.email ?? ''}>{user?.email} (my account)</option>
                    {MAILBOX_LIST.map(addr => <option key={addr} value={addr}>{addr}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>To *</label>
                <input
                  className="form-control"
                  placeholder="recipient@example.com"
                  value={compose.to}
                  onChange={e => setCompose(p => ({ ...p, to: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>CC</label>
                <input
                  className="form-control"
                  placeholder="cc@example.com, another@example.com"
                  value={compose.cc}
                  onChange={e => setCompose(p => ({ ...p, cc: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Subject *</label>
                <input
                  className="form-control"
                  placeholder="Email subject"
                  value={compose.subject}
                  onChange={e => setCompose(p => ({ ...p, subject: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Body *</label>
                <textarea
                  className="form-control"
                  rows={10}
                  placeholder="Write your message…"
                  value={compose.body}
                  onChange={e => setCompose(p => ({ ...p, body: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Attachment</label>
                {attachment ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span>📎 {attachment.name}</span>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setAttachment(null)}>Remove</button>
                  </div>
                ) : (
                  <input type="file" accept={ACCEPTED_DOCUMENT_TYPES} onChange={e => setAttachment(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} />
                )}
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>PDF, Word, Excel, CSV, JPG, PNG, or WEBP (keep it under ~4MB for reliable delivery (it travels as base64 through the email function).</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowCompose(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSend} disabled={sending || !hasPermission('communications.send_email')}>
                {sending ? 'Sending…' : '✉ Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
