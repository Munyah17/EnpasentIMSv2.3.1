import { useState, useEffect, useRef, useCallback } from 'react'
import type { ChatTopic, ChatSession, ChatMessage } from '../../types'
import * as chat from '../../lib/chatService'
import PhoneInput from '../ui/PhoneInput'

type Stage = 'closed' | 'form' | 'chatting'

interface Props {
  /** When the visitor is already a known, logged-in policyholder, skip
   *  asking for contact details again and pre-fill from their account. */
  prefill?: { name: string; phone: string; email: string }
}

export default function ChatWidget({ prefill }: Props) {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>('form')
  const [topics, setTopics] = useState<ChatTopic[]>([])
  const [name, setName] = useState(prefill?.name ?? '')
  const [phone, setPhone] = useState(prefill?.phone ?? '')
  const [email, setEmail] = useState(prefill?.email ?? '')
  const [topic, setTopic] = useState('')
  const [starting, setStarting] = useState(false)
  const [formError, setFormError] = useState('')

  const [session, setSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [queuePosition, setQueuePosition] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && stage === 'form' && topics.length === 0) {
      chat.listTopics().then(t => { setTopics(t); if (t[0]) setTopic(t[0].name) })
    }
  }, [open, stage, topics.length])

  useEffect(() => {
    if (!session) return
    const unsubMsg = chat.subscribeToMessages(session.id, msg => setMessages(prev => [...prev, msg]))
    const unsubSession = chat.subscribeToSession(session.id, updated => setSession(updated))
    return () => { unsubMsg(); unsubSession() }
  }, [session?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (session?.status === 'queued') {
      const poll = () => chat.getQueuePosition(session.id).then(setQueuePosition)
      poll()
      const interval = setInterval(poll, 5000)
      return () => clearInterval(interval)
    }
  }, [session?.id, session?.status])

  // Polling backstop alongside the realtime subscription — a freshly-opened
  // channel can take a moment to pick up the anonymous session's auth
  // context, during which a staff claim (or reply) landing in that window
  // would otherwise go unnoticed until something else re-renders the widget.
  useEffect(() => {
    if (!session || session.status === 'closed') return
    const interval = setInterval(() => {
      chat.getSession(session.id).then(fresh => { if (fresh) setSession(fresh) })
      chat.listMessages(session.id).then(fresh => {
        setMessages(prev => {
          const known = new Set(prev.map(m => m.id))
          const missed = fresh.filter(m => !known.has(m.id))
          return missed.length ? [...prev, ...missed] : prev
        })
      })
    }, 4000)
    return () => clearInterval(interval)
  }, [session?.id, session?.status])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  // Auto-close after 5 minutes of no activity from either side. Checked
  // from whichever end (this widget, or the staff LiveChat page) happens to
  // be open — there's no reliable way to run this on a schedule server-side
  // without a third Vercel Cron job, which the Hobby plan's 2-job cap
  // doesn't allow, so both ends watch independently instead.
  useEffect(() => {
    if (!session || session.status !== 'active') return
    const check = () => {
      const lastActivity = messages.length ? new Date(messages[messages.length - 1].createdAt).getTime() : new Date(session.startedAt ?? session.queuedAt).getTime()
      if (Date.now() - lastActivity > 5 * 60 * 1000) chat.closeSession(session.id)
    }
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [session, messages])

  const startChat = async () => {
    setFormError('')
    if (topics.length === 0) {
      setFormError('Still loading, please try again in a moment.')
      return
    }
    if (!name.trim() || !phone.trim() || !email.trim() || !topic) {
      setFormError(prefill ? 'Please choose what you need help with.' : 'Please fill in all fields.')
      return
    }
    if (!email.includes('@')) {
      setFormError('Enter a valid email address.')
      return
    }
    setStarting(true)
    try {
      const { session: s, error } = await chat.startChatSession({ name: name.trim(), phone: phone.trim(), email: email.trim(), topic })
      if (error || !s) { setFormError(error ?? 'Failed to start chat.'); return }
      setSession(s)
      const initial = await chat.listMessages(s.id)
      setMessages(initial)
      setStage('chatting')
    } finally {
      setStarting(false)
    }
  }

  const send = useCallback(async () => {
    if (!session || !draft.trim()) return
    const body = draft.trim()
    setDraft('')
    await chat.sendMessage(session.id, 'visitor', session.visitorName, body)
  }, [session, draft])

  const reset = () => {
    setOpen(false)
    setStage('form')
    setSession(null)
    setMessages([])
    setName(prefill?.name ?? ''); setPhone(prefill?.phone ?? ''); setEmail(prefill?.email ?? '')
  }

  return (
    <>
      <button className="chat-fab" onClick={() => setOpen(o => !o)} aria-label="Chat with us">
        {open ? '✕' : '💬'}
      </button>

      {open && (
        <div className="chat-panel">
          <div className="chat-panel-header">
            <div>
              <div className="chat-panel-title">Enpasent Support</div>
              {session && <div className="chat-panel-sub">{session.status === 'queued' ? 'Waiting for an agent…' : session.status === 'active' ? `Connected${session.assignedName ? `: ${session.assignedName}` : ''}` : 'Chat ended'}</div>}
            </div>
            <button className="modal-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          {stage === 'form' && (
            <div className="chat-panel-body">
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                {prefill ? `Chatting as ${prefill.name}. What can we help with?` : 'Tell us a bit about yourself so we can connect you with the right agent.'}
              </p>
              <div className="form-group">
                <label>What can we help with? *</label>
                <select className="form-control" value={topic} onChange={e => setTopic(e.target.value)}>
                  {topics.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              {!prefill && (
                <>
                  <div className="form-group">
                    <label>Full Name *</label>
                    <input className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
                  </div>
                  <div className="form-group">
                    <label>Phone Number *</label>
                    <PhoneInput value={phone} onChange={setPhone} />
                  </div>
                  <div className="form-group">
                    <label>Email Address *</label>
                    <input type="email" className="form-control" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                </>
              )}
              {formError && <div className="login-error">{formError}</div>}
              <button className="btn btn-primary btn-full" onClick={startChat} disabled={starting || topics.length === 0}>
                {starting ? 'Starting…' : topics.length === 0 ? 'Loading…' : 'Start Chat'}
              </button>
            </div>
          )}

          {stage === 'chatting' && session && (
            <>
              <div className="chat-messages" ref={listRef}>
                {session.status === 'queued' && (
                  <div className="chat-queue-note">
                    You are #{queuePosition ?? '…'} in the queue. An agent will join shortly.
                  </div>
                )}
                {messages.map(m => (
                  <div key={m.id} className={`chat-msg chat-msg-${m.senderType}`}>
                    {m.senderType !== 'system' && <div className="chat-msg-sender">{m.senderName}</div>}
                    <div className="chat-msg-body">{m.body}</div>
                  </div>
                ))}
                {session.status === 'closed' && (
                  <div className="chat-queue-note">This chat has ended. Thanks for reaching out!</div>
                )}
              </div>
              {session.status !== 'closed' ? (
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
              ) : (
                <div className="chat-input-row">
                  <button className="btn btn-ghost btn-full" onClick={reset}>Start a new chat</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
