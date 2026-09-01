import { supabase } from './supabase'
import type { ChatTopic, ChatSession, ChatMessage } from '../types'

function toTopic(r: Record<string, unknown>): ChatTopic {
  return { id: r.id as string, name: r.name as string, active: r.active as boolean, sortOrder: r.sort_order as number }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(r: any): ChatSession {
  return {
    id: r.id,
    visitorId: r.visitor_id,
    visitorName: r.visitor_name,
    visitorPhone: r.visitor_phone,
    visitorEmail: r.visitor_email,
    topic: r.topic,
    status: r.status,
    assignedTo: r.assigned_to ?? undefined,
    assignedName: r.profiles?.name ?? undefined,
    queuedAt: r.queued_at,
    startedAt: r.started_at ?? undefined,
    closedAt: r.closed_at ?? undefined,
  }
}

function toMessage(r: Record<string, unknown>): ChatMessage {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    senderType: r.sender_type as ChatMessage['senderType'],
    senderName: r.sender_name as string,
    body: r.body as string,
    createdAt: r.created_at as string,
  }
}

export async function listTopics(): Promise<ChatTopic[]> {
  const { data, error } = await supabase.from('chat_topics').select('*').eq('active', true).order('sort_order')
  if (error || !data) return []
  return data.map(toTopic)
}

/** Ensures the visitor has an (anonymous, if not already logged in) Supabase session. */
async function ensureVisitorAuth(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user) return session.user.id
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error || !data.user) return null
  return data.user.id
}

export async function startChatSession(input: {
  name: string; phone: string; email: string; topic: string
}): Promise<{ session: ChatSession | null; error: string | null }> {
  const visitorId = await ensureVisitorAuth()
  if (!visitorId) return { session: null, error: 'Could not start a chat session. Please try again.' }

  const { data, error } = await supabase.from('chat_sessions').insert({
    visitor_id: visitorId, visitor_name: input.name, visitor_phone: input.phone,
    visitor_email: input.email, topic: input.topic,
  }).select().single()
  if (error || !data) return { session: null, error: error?.message ?? 'Failed to start chat.' }

  await supabase.from('chat_messages').insert({
    session_id: data.id, sender_type: 'system', sender_name: 'System',
    body: `Chat started: topic ${input.topic}`,
  })

  return { session: toSession(data), error: null }
}

export async function getQueuePosition(sessionId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_chat_queue_position', { p_session_id: sessionId })
  return error || typeof data !== 'number' ? 1 : data
}

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase.from('chat_messages').select('*').eq('session_id', sessionId).order('created_at')
  if (error || !data) return []
  return data.map(toMessage)
}

export async function sendMessage(sessionId: string, senderType: ChatMessage['senderType'], senderName: string, body: string) {
  return supabase.from('chat_messages').insert({ session_id: sessionId, sender_type: senderType, sender_name: senderName, body })
}

export function subscribeToMessages(sessionId: string, onInsert: (msg: ChatMessage) => void) {
  const channel = supabase
    .channel(`chat-messages-${sessionId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${sessionId}` },
      payload => onInsert(toMessage(payload.new as Record<string, unknown>)))
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

export function subscribeToSession(sessionId: string, onUpdate: (session: ChatSession) => void) {
  const channel = supabase
    .channel(`chat-session-${sessionId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_sessions', filter: `id=eq.${sessionId}` },
      payload => onUpdate(toSession(payload.new)))
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

/** Direct fetch, used as a polling backstop alongside subscribeToSession — a
 *  freshly-created Realtime channel can take a moment to pick up the new
 *  auth context after supabase.auth.signInAnonymously(), during which an
 *  UPDATE landing in that window would otherwise be silently missed. */
export async function getSession(sessionId: string): Promise<ChatSession | null> {
  const { data, error } = await supabase.from('chat_sessions').select(SESSION_SELECT).eq('id', sessionId).single()
  if (error || !data) return null
  return toSession(data)
}

const SESSION_SELECT = 'id, visitor_id, visitor_name, visitor_phone, visitor_email, topic, status, assigned_to, queued_at, started_at, closed_at, profiles!assigned_to(id, name)'

export async function listQueue(): Promise<ChatSession[]> {
  const { data, error } = await supabase.from('chat_sessions').select(SESSION_SELECT).eq('status', 'queued').order('queued_at')
  if (error || !data) return []
  return data.map(toSession)
}

export async function listActiveSessions(): Promise<ChatSession[]> {
  const { data, error } = await supabase.from('chat_sessions').select(SESSION_SELECT).eq('status', 'active').order('started_at', { ascending: false })
  if (error || !data) return []
  return data.map(toSession)
}

export async function listClosedSessions(limit = 50): Promise<ChatSession[]> {
  const { data, error } = await supabase.from('chat_sessions').select(SESSION_SELECT).eq('status', 'closed').order('closed_at', { ascending: false }).limit(limit)
  if (error || !data) return []
  return data.map(toSession)
}

export function subscribeToAllSessions(onChange: () => void) {
  const channel = supabase
    .channel('chat-sessions-staff')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_sessions' }, onChange)
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

export async function claimSession(sessionId: string, agentId: string) {
  return supabase.from('chat_sessions').update({ status: 'active', assigned_to: agentId, started_at: new Date().toISOString() }).eq('id', sessionId)
}

export async function closeSession(sessionId: string) {
  return supabase.from('chat_sessions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', sessionId)
}
