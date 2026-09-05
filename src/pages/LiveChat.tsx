import { useState, useEffect, useRef, useCallback } from 'react'
import type { ToastMessage, ChatSession, ChatMessage } from '../types'
import type { ActivePanel } from '../App'
import { useAuth } from '../contexts/AuthContext'
import * as chat from '../lib/chatService'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

function timeAgo(iso: string) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

export default function LiveChat({ showToast }: Props) {
  const { user } = useAuth()
  const [queue, setQueue] = useState<ChatSession[]>([])
  const [active, setActive] = useState<ChatSession[]>([])
  const [closed, setClosed] = useState<ChatSession[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const reload = useCallback(() => {
    Promise.all([chat.listQueue(), chat.listActiveSessions()]).then(([q, a]) => {
      setQueue(q); setActive(a); setLoading(false)
      setSelected(prev => prev ? [...q, ...a, ...closed].find(s => s.id === prev.id) ?? prev : prev)
    })
  }, [closed])

  useEffect(() => {
    if (showHistory) chat.listClosedSessions().then(setClosed)
  }, [showHistory])

  useEffect(() => {
    reload()
    const unsub = chat.subscribeToAllSessions(reload)
    // Polling backstop alongside realtime — see the matching note in
    // ChatWidget.tsx for why this matters, not just belt-and-braces.
    const interval = setInterval(reload, 8000)
    return () => { unsub(); clearInterval(interval) }
  }, [reload])

  useEffect(() => {
    if (!selected) return
    chat.listMessages(selected.id).then(setMessages)
    const unsub = chat.subscribeToMessages(selected.id, msg => setMessages(prev => [...prev, msg]))
    // Polling backstop — see the matching note in ChatWidget.tsx.
    const interval = setInterval(() => {
      chat.listMessages(selected.id).then(fresh => {
        setMessages(prev => {
          const known = new Set(prev.map(m => m.id))
          const missed = fresh.filter(m => !known.has(m.id))
          return missed.length ? [...prev, ...missed] : prev
        })
      })
    }, 4000)
    return () => { unsub(); clearInterval(interval) }
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  // Auto-close after 5 minutes of no activity — see the matching note in
  // ChatWidget.tsx for why this runs from here rather than a scheduled job.
  // Only checks the session currently open in this window; ChatWidget.tsx
  // does the same for whichever session a visitor has open, so between the
  // two ends a stale chat gets caught by whichever side is actually watching.
  useEffect(() => {
    if (!selected || selected.status !== 'active') return
    const check = () => {
      const lastActivity = messages.length ? new Date(messages[messages.length - 1].createdAt).getTime() : new Date(selected.startedAt ?? selected.queuedAt).getTime()
      if (Date.now() - lastActivity > 5 * 60 * 1000) chat.closeSession(selected.id)
    }
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [selected, messages])

  const claim = async (session: ChatSession) => {
    if (!user) return
    const { error } = await chat.claimSession(session.id, user.id)
    if (error) { showToast('error', 'Failed to claim chat.'); return }
    showToast('success', `Chat with ${session.visitorName} claimed.`)
    setSelected(session)
  }

  const close = async (session: ChatSession) => {
    const { error } = await chat.closeSession(session.id)
    if (error) { showToast('error', 'Failed to close chat.'); return }
    showToast('info', 'Chat closed.')
  }

  const send = async () => {
    if (!selected || !draft.trim() || !user) return
    const body = draft.trim()
    setDraft('')
    await chat.sendMessage(selected.id, 'agent', user.name, body)
  }

  return (
    <div className="panel">
      <div className="livechat-layout">
        <div className="livechat-sidebar">
          <div className="livechat-section-title">Queue ({queue.length})</div>
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : queue.length === 0 ? (
            <div className="empty-state" style={{ padding: '12px 0' }}>No one waiting.</div>
          ) : queue.map(s => (
            <div key={s.id} className="livechat-item">
              <div className="livechat-item-main">
                <strong>{s.visitorName}</strong>
                <span className="livechat-item-topic">{s.topic}</span>
                <span className="livechat-item-time">{timeAgo(s.queuedAt)}</span>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => claim(s)}>Claim</button>
            </div>
          ))}

          <div className="livechat-section-title" style={{ marginTop: 16 }}>My Active Chats ({active.filter(s => s.assignedTo === user?.id).length})</div>
          {active.filter(s => s.assignedTo === user?.id).length === 0 ? (
            <div className="empty-state" style={{ padding: '12px 0' }}>No active chats.</div>
          ) : active.filter(s => s.assignedTo === user?.id).map(s => (
            <div key={s.id} className={`livechat-item livechat-item-clickable${selected?.id === s.id ? ' active' : ''}`} onClick={() => setSelected(s)}>
              <div className="livechat-item-main">
                <strong>{s.visitorName}</strong>
                <span className="livechat-item-topic">{s.topic}</span>
              </div>
            </div>
          ))}

          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 16, width: '100%' }} onClick={() => setShowHistory(h => !h)}>
            {showHistory ? '▲ Hide Chat History' : '▼ View Chat History'}
          </button>
          {showHistory && (
            closed.length === 0 ? (
              <div className="empty-state" style={{ padding: '12px 0' }}>No closed chats yet.</div>
            ) : closed.map(s => (
              <div key={s.id} className={`livechat-item livechat-item-clickable${selected?.id === s.id ? ' active' : ''}`} onClick={() => setSelected(s)}>
                <div className="livechat-item-main">
                  <strong>{s.visitorName}</strong>
                  <span className="livechat-item-topic">{s.topic}</span>
                  <span className="livechat-item-time">{s.closedAt ? timeAgo(s.closedAt) : ''}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="livechat-window">
          {!selected ? (
            <div className="empty-state">Select a chat from the queue or your active chats.</div>
          ) : (
            <>
              <div className="livechat-window-header">
                <div>
                  <strong>{selected.visitorName}</strong>
                  <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>{selected.visitorPhone} · {selected.visitorEmail}</span>
                </div>
                {selected.status === 'active' && selected.assignedTo === user?.id && (
                  <button className="btn btn-ghost btn-sm" onClick={() => close(selected)}>End Chat</button>
                )}
              </div>
              <div className="chat-messages" ref={listRef} style={{ flex: 1 }}>
                {messages.map(m => (
                  <div key={m.id} className={`chat-msg ${m.senderType === 'agent' ? 'chat-msg-visitor' : m.senderType === 'visitor' ? 'chat-msg-agent' : 'chat-msg-system'}`}>
                    {m.senderType !== 'system' && <div className="chat-msg-sender">{m.senderName}</div>}
                    <div className="chat-msg-body">{m.body}</div>
                  </div>
                ))}
              </div>
              {selected.status === 'active' && selected.assignedTo === user?.id ? (
                <div className="chat-input-row">
                  <input
                    className="form-control"
                    placeholder="Type a message…"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') send() }}
                  />
                  <button className="btn btn-primary" onClick={send} disabled={!draft.trim()}>Send</button>
                </div>
              ) : selected.status === 'queued' ? (
                <div className="chat-input-row">
                  <button className="btn btn-primary btn-full" onClick={() => claim(selected)}>Claim this chat</button>
                </div>
              ) : (
                <div className="chat-input-row"><span style={{ fontSize: 12, color: 'var(--muted)' }}>This chat has ended.</span></div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
