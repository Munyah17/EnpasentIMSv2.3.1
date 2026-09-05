import { supabase } from './supabase'

/**
 * Append-only record of what staff do with their privileges.
 *
 * Only actions that change access, money, or a policy/claim outcome are
 * recorded. Logging every click would bury the handful of entries anyone
 * would ever investigate, so reads are not logged and routine navigation is
 * not logged; the question this answers is "who did this, and when", not
 * "who looked at what".
 *
 * Writes are fire-and-forget and never throw. An audit trail that can fail
 * a user's action would be worse than the gap it leaves, and the database
 * has no UPDATE or DELETE policy on this table, so entries cannot be
 * rewritten afterwards, including by an admin.
 */

export type ActivityAction =
  // Access and privilege
  | 'staff.created' | 'staff.deleted' | 'staff.role_changed' | 'staff.password_reset'
  | 'role.permissions_changed'
  | 'apikey.issued' | 'apikey.paused' | 'apikey.resumed' | 'apikey.revoked'
  | 'developer.registered' | 'developer.status_changed' | 'developer.terminated'
  | 'developer.commission_changed'
  // Money and outcomes
  | 'policy.created' | 'policy.updated' | 'policy.deleted'
  | 'claim.intake_accepted' | 'claim.intake_rejected' | 'claim.escalated'
  | 'claim.approved' | 'claim.declined' | 'claim.deleted'
  // Taking a payment and validating one are different acts and are logged
  // as such. 'payment.recorded' is money a gateway confirmed it collected.
  // 'payment.validated' is a staff member asserting money arrived by a
  // route the system never saw — cash over the counter, an EcoCash
  // send-money transfer between two personal wallets, a bank transfer, or a
  // correction after a client hit trouble paying. The second is a
  // privileged manual act and has to be attributable to a person.
  | 'payment.recorded'
  | 'payment.validated'
  // A gateway's own verdict on a reference, logged whichever of the three
  // reconcile routes (webhook / verify / sweep) is the one that first sees
  // it settle into that state — see api/_lib/paynowReconcile.ts. 'recorded'
  // above covers the credited case; these cover the other outcomes staff
  // need visibility into without having to read a policy's payment history
  // to notice something never arrived.
  | 'payment.failed'
  | 'payment.mismatch'
  // Bulk / outbound
  | 'sms.bulk_sent'

export interface ActivityActor {
  id?: string
  name: string
  role: string
}

export interface ActivityEntry {
  action: ActivityAction
  actor: ActivityActor
  entityType?: string
  entityId?: string
  /** Human-readable identifier: a policy number, a company name, a person. */
  entityLabel?: string
  detail?: string
  /** 'notice' for privilege changes, 'warning' for destructive or high-value. */
  severity?: 'info' | 'notice' | 'warning'
}

export async function recordActivity(entry: ActivityEntry): Promise<void> {
  try {
    await supabase.from('activity_log').insert({
      actor_id: entry.actor.id ?? null,
      actor_name: entry.actor.name,
      actor_role: entry.actor.role,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      entity_label: entry.entityLabel ?? null,
      detail: entry.detail ?? null,
      severity: entry.severity ?? 'info',
    })
  } catch (e) {
    console.error('activity_log write failed', entry.action, e)
  }
}

export interface ActivityRow {
  id: string
  actorId?: string
  actorName: string
  actorRole: string
  action: string
  entityType?: string
  entityId?: string
  entityLabel?: string
  detail?: string
  severity: 'info' | 'notice' | 'warning'
  ts: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(r: any): ActivityRow {
  return {
    id: r.id,
    actorId: r.actor_id ?? undefined,
    actorName: r.actor_name,
    actorRole: r.actor_role,
    action: r.action,
    entityType: r.entity_type ?? undefined,
    entityId: r.entity_id ?? undefined,
    entityLabel: r.entity_label ?? undefined,
    detail: r.detail ?? undefined,
    severity: (r.severity as ActivityRow['severity']) ?? 'info',
    ts: r.ts,
  }
}

export async function listActivity(opts: { limit?: number; action?: string; actorId?: string } = {}): Promise<ActivityRow[]> {
  let query = supabase.from('activity_log').select('*').order('ts', { ascending: false }).limit(opts.limit ?? 200)
  if (opts.action) query = query.eq('action', opts.action)
  if (opts.actorId) query = query.eq('actor_id', opts.actorId)
  const { data, error } = await query
  if (error || !data) return []
  return (data as unknown[]).map(toRow)
}

/** Streams new entries as they are written, for the live view. */
export function subscribeToActivity(onEntry: (row: ActivityRow) => void): () => void {
  const channel = supabase
    .channel('activity_log_live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' },
      payload => onEntry(toRow(payload.new)))
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

/** Plain-language label for the activity feed. */
export const ACTION_LABELS: Record<string, string> = {
  'staff.created': 'Created a staff account',
  'staff.deleted': 'Deleted a staff account',
  'staff.role_changed': 'Changed a staff role',
  'staff.password_reset': 'Reset a staff password',
  'role.permissions_changed': 'Changed role permissions',
  'apikey.issued': 'Issued an API key',
  'apikey.paused': 'Paused an API key',
  'apikey.resumed': 'Resumed an API key',
  'apikey.revoked': 'Revoked an API key',
  'developer.registered': 'Registered a developer',
  'developer.status_changed': 'Changed developer status',
  'developer.terminated': 'Terminated a developer',
  'developer.commission_changed': 'Changed developer commission',
  'policy.created': 'Created a policy',
  'policy.updated': 'Updated a policy',
  'policy.deleted': 'Deleted a policy',
  'claim.intake_accepted': 'Accepted a claim at intake',
  'claim.intake_rejected': 'Rejected a claim at intake',
  'claim.escalated': 'Escalated a claim to final review',
  'claim.approved': 'Approved a claim',
  'claim.declined': 'Declined a claim',
  'claim.deleted': 'Deleted a claim',
  'payment.recorded': 'Recorded a gateway-confirmed payment',
  'payment.validated': 'Manually validated a payment',
  'sms.bulk_sent': 'Sent a bulk SMS campaign',
}
