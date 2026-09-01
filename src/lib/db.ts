import { supabase } from './supabase'
import { health } from './health'
// localStore is deliberately NOT imported here. It seeds itself from
// src/data/mockData.ts, so serving it on a failed read put invented clients,
// policies and payments in front of staff as though they were the real book.
// Reads fall back to offlineCache (real rows previously fetched) or to an
// empty result with an explanation; writes fail and say why.
import { cacheGet, cacheSet } from './offlineCache'
import { hammingDistance, DUPLICATE_THRESHOLD } from './photoHash'
import { policyBillablePremium } from './premium'
import { houseInsurerFirst } from './insurerAssignment'
import type {
  AppUser, Client, Product, ClientSafeProduct, Policy, Claim, Payment,
  Ticket, EmailMessage, Lead, FraudCase, Reminder, CautionFlag,
  PolicyStatus, ClaimStatus, PaymentStatus, PaymentMethod,
  TicketStatus, TicketPriority, LeadStatus, FraudCaseStatus, CustomRole,
  ClaimAssessment, PolicyAssessment, AssessmentPhoto, InsurerRecord, CropType, FraudSignalRule, HeroSlide,
  PolicyCard,
} from '../types'

// ── helpers ───────────────────────────────────────────────────────
function date(v: string | null | undefined): string { return v?.split('T')[0] ?? '' }
// uid() used to mint ids for records invented in browser storage when a
// write failed. Writes no longer do that, so nothing needs a fake id.

/** Try a Supabase query; record timing/health; return {ok, data, error}. */
async function sb<T>(
  table: string,
  type: 'read' | 'write' | 'delete',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: () => PromiseLike<{ data: any; error: any }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isListOk: (d: any) => boolean = (d) => d !== null,
): Promise<{ ok: boolean; data: T | null; error: string | null }> {
  const start = Date.now()
  try {
    const { data, error } = await query()
    const duration = Date.now() - start
    const ok = !error && isListOk(data)
    health.record({ ts: Date.now(), type, table, success: ok, duration, source: 'supabase',
      detail: error ? String(error?.message ?? error) : undefined })
    return { ok, data: ok ? data : null, error: ok ? null : (error?.message ?? 'The database rejected this request.') }
  } catch (e) {
    const duration = Date.now() - start
    health.record({ ts: Date.now(), type, table, success: false, duration, source: 'supabase',
      detail: String(e) })
    return { ok: false, data: null, error: String(e) }
  }
}

/**
 * A write that did not reach the database is a failure, and must be
 * reported as one.
 *
 * Every create/update below used to fall back to browser-local storage on
 * any error and return `error: null`, so the UI announced success. Nothing
 * ever syncs that storage back, so the record existed in exactly one
 * browser: invisible to every colleague, gone when the cache cleared. It is
 * how a policy captured on one laptop was simply not there for anyone else.
 *
 * Reads still fall back to the local cache — showing the last known data
 * beats showing nothing — but a write now surfaces the real reason.
 */
function writeFailed(table: string, error: string | null): { data: null; error: string } {
  health.record({ ts: Date.now(), type: 'write', table, success: false, duration: 0, source: 'supabase', detail: error ?? undefined })
  window.dispatchEvent(new CustomEvent(DB_FALLBACK_EVENT, { detail: { table, type: 'write', error } }))
  return { data: null, error: error ?? 'Could not save to the database. Check your connection and try again — nothing has been saved.' }
}

/** Dispatched whenever a read/write falls back to browser-local storage, so the UI can warn the user. */
export const DB_FALLBACK_EVENT = 'ims:db-fallback'

function local(table: string, type: 'read' | 'write' | 'delete') {
  health.record({ ts: Date.now(), type, table, success: true, duration: 0, source: 'local' })
  window.dispatchEvent(new CustomEvent(DB_FALLBACK_EVENT, { detail: { table, type } }))
}

// ── Row transformers ──────────────────────────────────────────────

function toProfile(r: Record<string, unknown>): AppUser {
  return {
    id:          r.id as string,
    name:        r.name as string,
    username:    (r.username as string | null) ?? undefined,
    email:       (r.email as string) ?? '',
    role:        r.role as AppUser['role'],
    department:  (r.department as string) ?? '',
    phone:       r.phone as string | undefined,
    active:      r.active as boolean,
    permissions: (r.permissions as string[]) ?? [],
    customRoleId:   (r.custom_role_id as string | null) ?? undefined,
    customRoleName: (r.custom_roles as { name?: string } | null)?.name ?? undefined,
    lastLogin:   r.last_login as string | undefined,
  }
}

function toCustomRole(r: Record<string, unknown>): CustomRole {
  return {
    id:          r.id as string,
    name:        r.name as string,
    description: (r.description as string | null) ?? undefined,
    permissions: (r.permissions as string[]) ?? [],
    createdBy:   (r.created_by as string | null) ?? undefined,
    createdAt:   r.created_at as string,
  }
}

function toClient(r: Record<string, unknown>): Client {
  return {
    id:          r.id as string,
    name:        r.name as string,
    email:       (r.email as string) ?? '',
    phone:       r.phone as string,
    nationalId:  r.national_id as string,
    dob:         date(r.dob as string),
    address:     (r.address as string) ?? '',
    occupation:  r.occupation as string | undefined,
    insurer:     (r.insurer as Client['insurer']) ?? undefined,
    insurerProvisional: (r.insurer_provisional as boolean) ?? false,
    createdAt:   date(r.created_at as string),
    policyCount: (r.policy_count as number) ?? 0,
    status:      r.status as Client['status'],
  }
}

/** Shared by toProduct and toClientSafeProduct — every column the client-safe
 *  view actually carries. Kept as one function so the two never drift apart
 *  on the fields both are allowed to see. */
function toClientSafeProduct(r: Record<string, unknown>): ClientSafeProduct {
  return {
    id:                r.id as string,
    name:              r.name as string,
    code:              r.code as string,
    category:          r.category as Product['category'],
    premium:           r.premium as number,
    coverAmount:       r.cover_amount as number,
    waitingPeriodDays: r.waiting_period_days as number,
    minAge:            r.min_age as number,
    maxAge:            r.max_age as number,
    active:            r.active as boolean,
    features:          (r.features as string[]) ?? [],
    description:       (r.description as string) ?? '',
    excess:            (r.excess as string) || undefined,
  }
}

function toProduct(r: Record<string, unknown>): Product {
  return {
    ...toClientSafeProduct(r),
    commissionPct:     r.commission_pct as number,
    policiesCount:     (r.policies_count as number) ?? 0,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPolicy(r: any): Policy {
  return {
    id:              r.id,
    policyNumber:    r.policy_number,
    clientId:        r.clients?.id ?? r.client_id ?? '',
    clientName:      r.clients?.name ?? '',
    productId:       r.products?.id ?? r.product_id ?? '',
    productName:     r.products?.name ?? '',
    productCategory: r.products?.category ?? undefined,
    excess:          r.products?.excess ?? undefined,
    premium:         r.premium,
    coverAmount:     r.cover_amount,
    startDate:       date(r.start_date),
    endDate:         date(r.end_date),
    status:          r.status as PolicyStatus,
    dependants:      r.dependants ?? [],
    paymentMethod:   r.payment_method,
    insurer:         r.insurer ?? undefined,
    growerNumber:    r.grower_number ?? undefined,
    gpsLat:          r.gps_lat ?? undefined,
    gpsLng:          r.gps_lng ?? undefined,
    agentId:         r.profiles?.id ?? r.agent_id,
    agentName:       r.profiles?.name,
    createdAt:       date(r.created_at),
    nextPaymentDate: r.next_payment_date ? date(r.next_payment_date) : undefined,
    lastPaymentDate: r.last_payment_date ? date(r.last_payment_date) : undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toClaim(r: any): Claim {
  const pol = r.policies
  return {
    id:            r.id,
    claimNumber:   r.claim_number,
    policyId:      r.policy_id,
    policyNumber:  pol?.policy_number ?? '',
    clientId:      pol?.clients?.id ?? '',
    clientName:    pol?.clients?.name ?? '',
    productName:   pol?.products?.name ?? '',
    claimType:     r.claim_type,
    amount:        r.amount,
    status:        r.status as ClaimStatus,
    stage:         (r.stage as Claim['stage']) ?? 'intake',
    category:      r.category ?? pol?.products?.category ?? undefined,
    dateOfEvent:   date(r.date_of_event),
    dateSubmitted: date(r.date_submitted),
    description:   r.description ?? '',
    fraudScore:    r.fraud_score,
    assignedTo:    r.assigned_to ?? undefined,
    assignedName:  r.assignee?.name ?? undefined,
    agentId:       r.agent_id ?? undefined,
    agentName:     r.agent?.name ?? undefined,
    assessmentNotes: r.assessment_notes ?? undefined,
    documents:     r.documents ?? [],
    notes:         r.notes ?? undefined,
    resolvedAt:    r.resolved_at ?? undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPayment(r: any): Payment {
  const pol = r.policies
  return {
    id:            r.id,
    reference:     r.reference,
    policyId:      r.policy_id,
    policyNumber:  pol?.policy_number ?? '',
    clientName:    pol?.clients?.name ?? '',
    amount:        r.amount,
    method:        r.method as PaymentMethod,
    status:        r.status as PaymentStatus,
    date:          date(r.payment_date),
    splitPayments: r.split_payments ?? undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTicket(r: any): Ticket {
  return {
    id:           r.id,
    ticketNumber: r.ticket_number,
    clientId:     r.clients?.id ?? r.client_id ?? '',
    clientName:   r.clients?.name ?? '',
    subject:      r.subject,
    description:  r.description ?? '',
    status:       r.status as TicketStatus,
    priority:     r.priority as TicketPriority,
    category:     r.category,
    assignedTo:   r.assigned_to ?? undefined,
    assignedName: r.profiles?.name ?? undefined,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at,
    messages:     r.messages ?? [],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEmail(r: any): EmailMessage {
  return {
    id:          r.id,
    from:        r.from_address,
    fromName:    r.from_name ?? r.from_address,
    to:          r.to_address,
    cc:          r.cc ?? undefined,
    subject:     r.subject,
    body:        r.body ?? '',
    timestamp:   r.created_at ?? r.timestamp,
    read:        r.read,
    starred:     r.starred ?? false,
    folder:      r.folder,
    linkedTo:    r.linked_to ?? undefined,
    attachments: r.attachments ?? [],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toLead(r: any): Lead {
  return {
    id:              r.id,
    name:            r.name,
    email:           r.email ?? undefined,
    phone:           r.phone,
    source:          r.source ?? '',
    productInterest: r.product_interest ?? '',
    status:          r.status as LeadStatus,
    intentScore:     r.intent_score,
    createdAt:       r.created_at,
    lastContact:     r.last_contact ? date(r.last_contact) : undefined,
    notes:           r.notes ?? undefined,
    assignedTo:      r.assigned_to ?? undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toFraudCase(r: any): FraudCase {
  return {
    id:           r.id,
    claimId:      r.claim_id,
    claimNumber:  r.claims?.claim_number ?? '',
    policyNumber: r.claims?.policies?.policy_number ?? '',
    clientName:   r.claims?.policies?.clients?.name ?? '',
    category:     r.claims?.category ?? undefined,
    amount:       r.claims?.amount ?? undefined,
    fraudScore:   r.fraud_score,
    signals:      r.signals ?? [],
    status:       r.status as FraudCaseStatus,
    assignedTo:   r.assigned_to ?? undefined,
    createdAt:    r.created_at,
    resolvedAt:   r.resolved_at ?? undefined,
    notes:        r.notes ?? undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toReminder(r: any): Reminder {
  return {
    id:           r.id,
    type:         r.type,
    clientId:     r.clients?.id ?? r.client_id ?? '',
    clientName:   r.clients?.name ?? '',
    policyId:     r.policy_id ?? undefined,
    policyNumber: r.policies?.policy_number ?? undefined,
    dueDate:      date(r.due_date),
    message:      r.message ?? '',
    sent:         r.sent,
    channel:      r.channel,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCautionFlag(r: any): CautionFlag {
  return {
    policyId:        r.policy_id,
    policyNumber:    r.policy_number,
    clientId:        r.client_id,
    clientName:      r.client_name,
    agentId:         r.agent_id ?? undefined,
    daysOverdue:     r.days_overdue,
    flaggedAt:       r.flagged_at,
    monthsDefaulted: r.months_defaulted,
    cleared:         r.cleared,
    clearedAt:       r.cleared_at ?? undefined,
  }
}

// ── SELECT strings ────────────────────────────────────────────────
const POLICY_SELECT = `
  id, policy_number, client_id, product_id, premium, cover_amount,
  start_date, end_date, status, dependants, payment_method, insurer,
  grower_number, gps_lat, gps_lng, agent_id, next_payment_date, last_payment_date, created_at,
  clients!client_id(id, name),
  products!product_id(id, name, category, excess),
  profiles!agent_id(id, name)
`
const CLAIM_SELECT = `
  id, claim_number, policy_id, claim_type, amount, status,
  stage, assessment_notes, agent_id, category,
  date_of_event, date_submitted, description, fraud_score,
  assigned_to, documents, notes, resolved_at, created_at,
  policies!policy_id(
    id, policy_number,
    clients!client_id(id, name),
    products!product_id(name, category)
  ),
  assignee:profiles!assigned_to(id, name),
  agent:profiles!agent_id(id, name)
`
const PAYMENT_SELECT = `
  id, reference, policy_id, amount, method, status, payment_date, split_payments, created_at,
  policies!policy_id(
    policy_number,
    clients!client_id(name)
  )
`
const TICKET_SELECT = `
  id, ticket_number, client_id, subject, description,
  status, priority, category, assigned_to, messages, created_at, updated_at,
  clients!client_id(id, name),
  profiles!assigned_to(id, name)
`
const FRAUD_SELECT = `
  id, claim_id, fraud_score, signals, status, assigned_to, notes, resolved_at, created_at,
  claims!claim_id(
    claim_number, category, amount,
    policies!policy_id(
      policy_number,
      clients!client_id(name)
    )
  )
`
const REMINDER_SELECT = `
  id, type, client_id, policy_id, due_date, message, sent, channel, created_at,
  clients!client_id(id, name),
  policies!policy_id(policy_number)
`

// ── POLICIES ──────────────────────────────────────────────────────
export const policies = {
  // Falls back to a real read-through cache (offlineCache.ts), not
  // localStore's demo-seeded mock data — an assessor offline on a farm
  // visit must see their real assigned policies (or a clear "no cached
  // data yet" empty state), never a fake policy that looks real enough to
  // record a genuine site visit against.
  async list() {
    const { ok, data } = await sb('policies', 'read',
      () => supabase.from('policies').select(POLICY_SELECT).order('created_at', { ascending: false }),
      d => Array.isArray(d),
    )
    if (ok && data) {
      const mapped = (data as unknown[]).map(toPolicy)
      cacheSet('policies', mapped)
      return { data: mapped, error: null }
    }
    const cached = cacheGet<Policy>('policies')
    if (cached) return { data: cached.data, error: null }
    local('policies', 'read')
    return { data: [], error: 'Could not load policies — connect to the internet at least once to cache them for offline use.' }
  },

  async get(id: string) {
    const { ok, data } = await sb('policies', 'read',
      () => supabase.from('policies').select(POLICY_SELECT).eq('id', id).single(),
    )
    if (ok && data) return { data: toPolicy(data), error: null }
    const cachedPolicy = cacheGet<Policy>('policies')?.data.find(p => p.id === id)
    if (cachedPolicy) return { data: cachedPolicy, error: null }
    return { data: null, error: 'Could not load that policy.' }
  },

  async create(policy: Omit<Policy, 'id'>) {
    const row = {
      policy_number: policy.policyNumber, client_id: policy.clientId,
      product_id: policy.productId, premium: policy.premium,
      cover_amount: policy.coverAmount, start_date: policy.startDate,
      end_date: policy.endDate, status: policy.status,
      dependants: policy.dependants, payment_method: policy.paymentMethod,
      insurer: policy.insurer ?? null, grower_number: policy.growerNumber ?? null,
      gps_lat: policy.gpsLat ?? null, gps_lng: policy.gpsLng ?? null,
      agent_id: policy.agentId ?? null, next_payment_date: policy.nextPaymentDate ?? null,
    }
    // Inserted directly rather than through sb(), because a duplicate must
    // be reported as a refusal. Falling back to local storage on a unique
    // violation would tell the user their policy was created and then
    // quietly never sync it -- the opposite of what the constraint is for.
    const start = Date.now()
    const { data, error } = await supabase.from('policies').insert(row).select(POLICY_SELECT).single()
    health.record({ ts: Date.now(), type: 'write', table: 'policies', success: !error, duration: Date.now() - start, source: 'supabase', detail: error ? String(error.message) : undefined })

    if (!error && data) return { data: toPolicy(data), error: null }
    if (error?.code === '23505') {
      const duplicateProduct = error.message.includes('policies_one_live_per_client_product')
      return {
        data: null,
        error: duplicateProduct
          ? 'This client already holds a live policy for this product. Add a different product, or upgrade the existing policy instead of issuing a second one.'
          : 'That would duplicate an existing record. Check whether this client or policy is already on the system.',
      }
    }
    // Anything else is a genuine failure: the policy does not exist.
    return writeFailed('policies', error?.message ?? null)
  },

  async update(id: string, updates: Partial<Policy>) {
    const row: Record<string, unknown> = {}
    if (updates.status)                              row.status             = updates.status
    if (updates.paymentMethod)                       row.payment_method     = updates.paymentMethod
    if (updates.insurer !== undefined)               row.insurer            = updates.insurer ?? null
    if (updates.growerNumber !== undefined)          row.grower_number      = updates.growerNumber ?? null
    if (updates.gpsLat !== undefined)                row.gps_lat            = updates.gpsLat ?? null
    if (updates.gpsLng !== undefined)                row.gps_lng            = updates.gpsLng ?? null
    if (updates.nextPaymentDate !== undefined)        row.next_payment_date  = updates.nextPaymentDate ?? null
    if (updates.dependants)                          row.dependants         = updates.dependants
    if (updates.premium !== undefined)               row.premium            = updates.premium
    if (updates.coverAmount !== undefined)           row.cover_amount       = updates.coverAmount
    if (updates.endDate !== undefined)               row.end_date           = updates.endDate
    if (updates.agentId !== undefined)               row.agent_id           = updates.agentId ?? null
    const { ok, data, error } = await sb('policies', 'write',
      () => supabase.from('policies').update(row).eq('id', id).select(POLICY_SELECT).single(),
    )
    if (ok && data) return { data: toPolicy(data), error: null }
    return writeFailed('policies', error)
  },

  /** What is standing in the way of deleting this policy. Reminders,
   *  caution flags and pre-loss assessments all cascade, so what remains is
   *  claims, payments, and the web checkout session a policy bought online
   *  was created from -- that last one holds a plain reference that neither
   *  cascades nor nulls itself, so it blocks silently if not accounted for. */
  async deletionBlockers(id: string): Promise<{ claims: number; payments: number; checkouts: number }> {
    const [claimsRes, paymentsRes, checkoutRes] = await Promise.all([
      supabase.from('claims').select('id', { count: 'exact', head: true }).eq('policy_id', id),
      supabase.from('payments').select('id', { count: 'exact', head: true }).eq('policy_id', id),
      supabase.from('checkout_sessions').select('id', { count: 'exact', head: true }).eq('policy_id', id),
    ])
    return { claims: claimsRes.count ?? 0, payments: paymentsRes.count ?? 0, checkouts: checkoutRes.count ?? 0 }
  },

  /**
   * RLS (policies_delete_admin) restricts this to admin/super_admin already;
   * hasPermission('policies.delete') additionally gates the button itself
   * so a custom role can hide it from a given admin/staff member too.
   *
   * Claims and payments deliberately do NOT cascade in the schema, because
   * silently destroying a payment record along with a policy is not
   * something anyone should be able to do by accident. Passing `force`
   * removes them explicitly, which is the caller stating that is what they
   * meant -- and the reason for it gets written to the activity log.
   */
  async remove(id: string, opts: { force?: boolean } = {}) {
    if (opts.force) {
      // Order matters: all three reference the policy, so they go first.
      const { error: claimsError } = await supabase.from('claims').delete().eq('policy_id', id)
      if (claimsError) return { error: `Could not remove the policy's claims: ${claimsError.message}` }
      const { error: paymentsError } = await supabase.from('payments').delete().eq('policy_id', id)
      if (paymentsError) return { error: `Could not remove the policy's payments: ${paymentsError.message}` }
      // The checkout session is a payment record in its own right, so it is
      // detached rather than destroyed -- what the buyer paid, when, and
      // through which gateway stays on file even though the policy it
      // produced is gone.
      const { error: checkoutError } = await supabase.from('checkout_sessions').update({ policy_id: null }).eq('policy_id', id)
      if (checkoutError) return { error: `Could not detach the policy's checkout session: ${checkoutError.message}` }
    }

    const { error } = await supabase.from('policies').delete().eq('id', id)
    if (!error) return { error: null }
    if (error.code !== '23503') return { error: error.message }

    // Name what is actually holding it, rather than listing everything it
    // might have been -- "claims or payments" sends someone looking for a
    // claim that was never there.
    const { claims, payments, checkouts } = await policies.deletionBlockers(id)
    const parts = [
      claims > 0 && `${claims} claim${claims === 1 ? '' : 's'}`,
      payments > 0 && `${payments} payment${payments === 1 ? '' : 's'}`,
      checkouts > 0 && `${checkouts} online checkout${checkouts === 1 ? '' : 's'}`,
    ].filter(Boolean)
    return {
      error: parts.length
        ? `This policy still has ${parts.join(' and ')} recorded against it.`
        : 'This policy is still referenced by other records and cannot be deleted.',
    }
  },
}

// ── CLIENTS ───────────────────────────────────────────────────────
export const clients = {
  // See policies.list() above — falls back to a real cache, not
  // localStore's demo-seeded mock data, so offline lookups (e.g. matching
  // a farm visit to the right grower by phone/ID) never surface a fake
  // client record.
  async list() {
    const { ok, data } = await sb('clients', 'read',
      () => supabase.from('clients').select('*, policies(count)').order('created_at', { ascending: false }),
      d => Array.isArray(d),
    )
    if (ok && data) {
      const mapped = (data as Record<string, unknown>[]).map(r =>
        toClient({ ...r, policy_count: (r.policies as {count:number}[])?.[0]?.count ?? 0 })
      )
      cacheSet('clients', mapped)
      return { data: mapped, error: null }
    }
    const cached = cacheGet<Client>('clients')
    if (cached) return { data: cached.data, error: null }
    local('clients', 'read')
    return { data: [], error: 'Could not load clients — connect to the internet at least once to cache them for offline use.' }
  },

  async get(id: string) {
    const { ok, data } = await sb('clients', 'read',
      () => supabase.from('clients').select('*, policies(count)').eq('id', id).single(),
    )
    if (ok && data) return {
      data: toClient({ ...(data as Record<string, unknown>), policy_count: ((data as Record<string, unknown>).policies as {count:number}[])?.[0]?.count ?? 0 }),
      error: null,
    }
    const cachedClient = cacheGet<Client>('clients')?.data.find(c => c.id === id)
    if (cachedClient) return { data: cachedClient, error: null }
    return { data: null, error: 'Could not load that client.' }
  },

  async create(client: Omit<Client, 'id' | 'policyCount'>) {
    const row = {
      name: client.name, email: client.email, phone: client.phone,
      national_id: client.nationalId, dob: client.dob || null,
      address: client.address, occupation: client.occupation ?? null,
      insurer: client.insurer ?? null, status: client.status,
      insurer_provisional: client.insurerProvisional ?? false,
    }
    const { ok, data, error } = await sb('clients', 'write',
      () => supabase.from('clients').insert(row).select().single(),
    )
    if (ok && data) return { data: toClient({ ...(data as Record<string,unknown>), policy_count: 0 }), error: null }
    return writeFailed('clients', error)
  },

  async update(id: string, updates: Partial<Client>) {
    const row: Record<string, unknown> = {}
    if (updates.name       !== undefined) row.name       = updates.name
    if (updates.email      !== undefined) row.email      = updates.email
    if (updates.phone      !== undefined) row.phone      = updates.phone
    if (updates.address    !== undefined) row.address    = updates.address
    if (updates.occupation !== undefined) row.occupation = updates.occupation
    if (updates.insurer    !== undefined) row.insurer    = updates.insurer ?? null
    if (updates.insurerProvisional !== undefined) row.insurer_provisional = updates.insurerProvisional
    if (updates.status     !== undefined) row.status     = updates.status
    const { ok, data, error } = await sb('clients', 'write',
      () => supabase.from('clients').update(row).eq('id', id).select().single(),
    )
    if (ok && data) return { data: toClient({ ...(data as Record<string,unknown>), policy_count: 0 }), error: null }
    return writeFailed('clients', error)
  },

  /**
   * Super Admin only (enforced by RLS — clients_delete_super_admin). No
   * local-storage fallback, same reasoning as staff.remove(): a "deleted"
   * client that only disappeared from browser state was never really gone.
   * Policies/claims reference clients with ON DELETE RESTRICT, so this
   * fails with a clear foreign-key error for any client who still has a
   * policy — surfaced as a friendly message rather than a raw Postgres one.
   */
  async remove(id: string) {
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) {
      return { error: error.code === '23503' ? 'This client has existing policies and cannot be deleted.' : error.message }
    }
    return { error: null }
  },
}

// ── PRODUCTS ──────────────────────────────────────────────────────
export const products = {
  // See policies.list() above — falls back to a real cache, not
  // localStore's demo-seeded mock data, so an offline category lookup
  // (e.g. deciding whether a policy is agriculture or vehicle) never uses
  // fake product data.
  async list() {
    const { ok, data } = await sb('products', 'read',
      () => supabase.from('products').select('*').order('name'),
      d => Array.isArray(d),
    )
    if (ok && data) {
      const mapped = (data as Record<string,unknown>[]).map(toProduct)
      cacheSet('products', mapped)
      return { data: mapped, error: null }
    }
    const cached = cacheGet<Product>('products')
    if (cached) return { data: cached.data, error: null }
    local('products', 'read')
    return { data: [], error: 'Could not load products — connect to the internet at least once to cache them for offline use.' }
  },

  /**
   * For anyone who is not staff — a client viewing their own cover, or a
   * future public quote/checkout flow. Reads public.products_client_safe
   * (see database/add_products_client_safe_view.sql) instead of the base
   * table, so commission_pct and policies_count never reach the browser in
   * the first place -- not merely go unrendered by whichever page called
   * this. Cached under its own key so a client-safe read can never be the
   * thing that backfills the full-Product cache products.list() falls back
   * to when offline.
   */
  async listClientSafe(): Promise<{ data: ClientSafeProduct[]; error: string | null }> {
    const { ok, data } = await sb('products_client_safe', 'read',
      () => supabase.from('products_client_safe').select('*').order('name'),
      d => Array.isArray(d),
    )
    if (ok && data) {
      const mapped = (data as Record<string,unknown>[]).map(toClientSafeProduct)
      cacheSet('products_client_safe', mapped)
      return { data: mapped, error: null }
    }
    const cached = cacheGet<ClientSafeProduct>('products_client_safe')
    if (cached) return { data: cached.data, error: null }
    local('products_client_safe', 'read')
    return { data: [], error: 'Could not load products — connect to the internet at least once to cache them for offline use.' }
  },

  /**
   * No local-storage fallback here — products.code is UNIQUE in the
   * database, so a reused code fails with a real, actionable Postgres
   * error. Silently "succeeding" into localStorage on that error was the
   * cause of "products aren't saving / vanish after logout": the item
   * looked saved for the current browser session but was never actually
   * in Supabase, so it disappeared the moment a real fetch replaced it.
   */
  async create(product: Omit<Product, 'id' | 'policiesCount'>) {
    const row = {
      name: product.name, code: product.code, category: product.category,
      premium: product.premium, cover_amount: product.coverAmount,
      waiting_period_days: product.waitingPeriodDays, min_age: product.minAge,
      max_age: product.maxAge, commission_pct: product.commissionPct,
      active: product.active, features: product.features, description: product.description,
      excess: product.excess || null,
    }
    const start = Date.now()
    const { data, error } = await supabase.from('products').insert(row).select().single()
    health.record({ ts: Date.now(), type: 'write', table: 'products', success: !error, duration: Date.now() - start, source: 'supabase', detail: error ? String(error.message) : undefined })
    if (error) {
      return { data: null, error: error.code === '23505' ? 'That product code is already in use; please choose a different one.' : error.message }
    }
    return { data: toProduct({ ...(data as Record<string,unknown>), policies_count: 0 }), error: null }
  },

  async update(id: string, updates: Partial<Product>) {
    const row: Record<string, unknown> = {}
    if (updates.name              !== undefined) row.name                = updates.name
    if (updates.code              !== undefined) row.code                = updates.code
    if (updates.premium           !== undefined) row.premium             = updates.premium
    if (updates.coverAmount       !== undefined) row.cover_amount        = updates.coverAmount
    if (updates.commissionPct     !== undefined) row.commission_pct      = updates.commissionPct
    if (updates.active            !== undefined) row.active              = updates.active
    if (updates.features          !== undefined) row.features            = updates.features
    if (updates.description       !== undefined) row.description         = updates.description
    if (updates.waitingPeriodDays !== undefined) row.waiting_period_days = updates.waitingPeriodDays
    if (updates.excess            !== undefined) row.excess              = updates.excess || null
    const start = Date.now()
    const { data, error } = await supabase.from('products').update(row).eq('id', id).select().single()
    health.record({ ts: Date.now(), type: 'write', table: 'products', success: !error, duration: Date.now() - start, source: 'supabase', detail: error ? String(error.message) : undefined })
    if (error) {
      return { data: null, error: error.code === '23505' ? 'That product code is already in use; please choose a different one.' : error.message }
    }
    return { data: toProduct(data as Record<string,unknown>), error: null }
  },
}

// ── INSURERS ──────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toInsurer(r: any): InsurerRecord {
  return {
    id: r.id, name: r.name,
    contactEmail: r.contact_email ?? undefined, contactPhone: r.contact_phone ?? undefined,
    address: r.address ?? undefined, regNumber: r.reg_number ?? undefined,
    commissionPercent: r.commission_percent ?? undefined,
    status: r.status, notes: r.notes ?? undefined, coverTypes: r.cover_types ?? [], createdAt: r.created_at,
  }
}

export const insurers = {
  async list() {
    const { ok, data } = await sb('insurers', 'read',
      () => supabase.from('insurers').select('*').order('name'),
      d => Array.isArray(d),
    )
    if (ok && data) return { data: houseInsurerFirst((data as Record<string, unknown>[]).map(toInsurer)), error: null }
    return { data: [] as InsurerRecord[], error: null }
  },

  async create(input: { name: string; contactEmail?: string; contactPhone?: string; address?: string; regNumber?: string; commissionPercent?: number; notes?: string; coverTypes?: string[] }) {
    const row = {
      name: input.name, contact_email: input.contactEmail || null, contact_phone: input.contactPhone || null,
      address: input.address || null, reg_number: input.regNumber || null,
      commission_percent: input.commissionPercent ?? null, notes: input.notes || null,
      cover_types: input.coverTypes ?? [],
    }
    const { data, error } = await supabase.from('insurers').insert(row).select().single()
    if (error) return { data: null, error: error.code === '23505' ? 'An insurer with that name already exists.' : error.message }
    return { data: toInsurer(data), error: null }
  },

  async update(id: string, updates: Partial<Omit<InsurerRecord, 'id' | 'createdAt'>>) {
    const row: Record<string, unknown> = {}
    if (updates.name              !== undefined) row.name = updates.name
    if (updates.contactEmail      !== undefined) row.contact_email = updates.contactEmail || null
    if (updates.contactPhone      !== undefined) row.contact_phone = updates.contactPhone || null
    if (updates.address           !== undefined) row.address = updates.address || null
    if (updates.regNumber         !== undefined) row.reg_number = updates.regNumber || null
    if (updates.commissionPercent !== undefined) row.commission_percent = updates.commissionPercent ?? null
    if (updates.status            !== undefined) row.status = updates.status
    if (updates.notes             !== undefined) row.notes = updates.notes || null
    if (updates.coverTypes        !== undefined) row.cover_types = updates.coverTypes
    const { data, error } = await supabase.from('insurers').update(row).eq('id', id).select().single()
    if (error) return { data: null, error: error.code === '23505' ? 'An insurer with that name already exists.' : error.message }
    return { data: toInsurer(data), error: null }
  },
}

// ── CROP TYPES ────────────────────────────────────────────────────
export const cropTypes = {
  async list() {
    const { ok, data } = await sb('crop_types', 'read',
      () => supabase.from('crop_types').select('*').order('name'),
      d => Array.isArray(d),
    )
    if (ok && data) return { data: (data as Record<string, unknown>[]).map(r => ({ id: r.id as string, name: r.name as string, status: r.status as 'active' | 'inactive', createdAt: r.created_at as string })), error: null }
    return { data: [] as CropType[], error: null }
  },

  async create(name: string) {
    const { data, error } = await supabase.from('crop_types').insert({ name }).select().single()
    if (error) return { data: null, error: error.code === '23505' ? 'That crop type already exists.' : error.message }
    return { data: { id: data.id, name: data.name, status: data.status, createdAt: data.created_at } as CropType, error: null }
  },

  async setStatus(id: string, status: 'active' | 'inactive') {
    const { error } = await supabase.from('crop_types').update({ status }).eq('id', id)
    return { error: error?.message ?? null }
  },
}

// ── FRAUD SIGNAL RULES (org-defined red flags fed into AI scoring) ──
export const fraudSignalRules = {
  async list() {
    const { ok, data } = await sb('fraud_signal_rules', 'read',
      () => supabase.from('fraud_signal_rules').select('id, description, status, created_at, profiles!created_by(name)').order('created_at', { ascending: false }),
      d => Array.isArray(d),
    )
    if (ok && data) {
      return {
        data: (data as Record<string, unknown>[]).map(r => ({
          id: r.id as string, description: r.description as string, status: r.status as 'active' | 'inactive',
          createdByName: (r.profiles as { name?: string } | null)?.name, createdAt: r.created_at as string,
        })) as FraudSignalRule[],
        error: null,
      }
    }
    return { data: [] as FraudSignalRule[], error: null }
  },

  async create(description: string, createdBy: string) {
    const { data, error } = await supabase.from('fraud_signal_rules').insert({ description, created_by: createdBy || null }).select().single()
    if (error) return { data: null, error: error.message }
    return { data: { id: data.id, description: data.description, status: data.status, createdAt: data.created_at } as FraudSignalRule, error: null }
  },

  async setStatus(id: string, status: 'active' | 'inactive') {
    const { error } = await supabase.from('fraud_signal_rules').update({ status }).eq('id', id)
    return { error: error?.message ?? null }
  },

  async remove(id: string) {
    const { error } = await supabase.from('fraud_signal_rules').delete().eq('id', id)
    return { error: error?.message ?? null }
  },
}

// ── HERO SLIDES (public site hero carousel content) ──────────────────
function toHeroSlide(r: Record<string, unknown>): HeroSlide {
  return {
    id: r.id as string, icon: r.icon as string, headline: (r.headline as string) ?? undefined,
    sortOrder: r.sort_order as number, status: r.status as 'active' | 'inactive', createdAt: r.created_at as string,
  }
}

export const heroSlides = {
  async list() {
    const { ok, data } = await sb('hero_slides', 'read',
      () => supabase.from('hero_slides').select('*').order('sort_order'),
      d => Array.isArray(d),
    )
    if (ok && data) return { data: (data as Record<string, unknown>[]).map(toHeroSlide), error: null }
    return { data: [] as HeroSlide[], error: null }
  },

  async create(input: { icon: string; headline?: string; sortOrder: number }) {
    const { data, error } = await supabase.from('hero_slides')
      .insert({ icon: input.icon, headline: input.headline || null, sort_order: input.sortOrder })
      .select().single()
    if (error) return { data: null, error: error.message }
    return { data: toHeroSlide(data), error: null }
  },

  async update(id: string, patch: Partial<{ icon: string; headline: string | null; sortOrder: number; status: 'active' | 'inactive' }>) {
    const row: Record<string, unknown> = {}
    if (patch.icon !== undefined) row.icon = patch.icon
    if (patch.headline !== undefined) row.headline = patch.headline || null
    if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder
    if (patch.status !== undefined) row.status = patch.status
    const { data, error } = await supabase.from('hero_slides').update(row).eq('id', id).select().single()
    if (error) return { data: null, error: error.message }
    return { data: toHeroSlide(data), error: null }
  },

  async remove(id: string) {
    const { error } = await supabase.from('hero_slides').delete().eq('id', id)
    return { error: error?.message ?? null }
  },
}

// ── PHOTO HASHES (duplicate/reused photo detection) ─────────────────
export interface PhotoHashMatch {
  reference: string
  label: string
  sourceType: 'claim' | 'policy'
  createdAt: string
  distance: number
}

export const photoHashes = {
  async record(input: { hash: string; sourceType: 'claim' | 'policy'; sourceId: string; reference: string; label: string; photoPath: string }) {
    await supabase.from('photo_hashes').insert({
      hash: input.hash, source_type: input.sourceType, source_id: input.sourceId,
      reference: input.reference, label: input.label, photo_path: input.photoPath,
    })
  },

  /** First-version duplicate check: pulls the most recent hashes and
   *  compares client-side via Hamming distance (see lib/photoHash.ts) —
   *  fine at the volumes a single insurer sees, not meant to scale to
   *  millions of rows without moving the comparison server-side. */
  async findMatches(hash: string, excludeSourceId: string): Promise<PhotoHashMatch[]> {
    const { data, error } = await supabase
      .from('photo_hashes')
      .select('hash, source_type, source_id, reference, label, created_at')
      .neq('source_id', excludeSourceId)
      .order('created_at', { ascending: false })
      .limit(2000)
    if (error || !data) return []
    return (data as { hash: string; source_type: 'claim' | 'policy'; reference: string; label: string; created_at: string }[])
      .map(row => ({ ...row, distance: hammingDistance(hash, row.hash) }))
      .filter(row => row.distance <= DUPLICATE_THRESHOLD)
      .sort((a, b) => a.distance - b.distance)
      .map(row => ({ reference: row.reference, label: row.label, sourceType: row.source_type, createdAt: row.created_at, distance: row.distance }))
  },
}

// ── CLAIMS ────────────────────────────────────────────────────────
export const claims = {
  async list() {
    const { ok, data } = await sb('claims', 'read',
      () => supabase.from('claims').select(CLAIM_SELECT).order('created_at', { ascending: false }),
      d => Array.isArray(d),
    )
    if (ok && data) {
      const mapped = (data as unknown[]).map(toClaim)
      cacheSet('claims', mapped)
      return { data: mapped, error: null }
    }
    const cached = cacheGet<Claim>('claims')
    if (cached) return { data: cached.data, error: null }
    return { data: [] as Claim[], error: 'Could not load claims — connect to the internet at least once to cache them for offline use.' }
  },

  async create(claim: Omit<Claim, 'id' | 'claimNumber' | 'policyNumber' | 'clientId' | 'clientName' | 'productName'>) {
    if (!Number.isFinite(claim.amount) || claim.amount <= 0) {
      return { data: null, error: 'Claim amount must be greater than zero.' }
    }
    const claimNumber = `CLM${new Date().getFullYear()}${String(Date.now()).slice(-4)}`
    const row = {
      claim_number: claimNumber, policy_id: claim.policyId,
      claim_type: claim.claimType, amount: claim.amount, status: claim.status,
      stage: claim.stage ?? 'intake', agent_id: claim.agentId ?? null, category: claim.category ?? null,
      date_of_event: claim.dateOfEvent, date_submitted: claim.dateSubmitted,
      description: claim.description, fraud_score: claim.fraudScore, documents: claim.documents,
    }
    const { ok, data, error } = await sb('claims', 'write',
      () => supabase.from('claims').insert(row).select(CLAIM_SELECT).single(),
    )
    if (ok && data) return { data: toClaim(data), error: null }
    return writeFailed('claims', error)
  },

  async update(id: string, updates: Partial<Claim>) {
    const row: Record<string, unknown> = {}
    if (updates.status     !== undefined) row.status      = updates.status
    if (updates.stage      !== undefined) row.stage       = updates.stage
    if (updates.assignedTo !== undefined) row.assigned_to = updates.assignedTo ?? null
    if (updates.assessmentNotes !== undefined) row.assessment_notes = updates.assessmentNotes ?? null
    if (updates.notes      !== undefined) row.notes       = updates.notes ?? null
    if (updates.resolvedAt !== undefined) row.resolved_at = updates.resolvedAt ?? null
    const { ok, data, error } = await sb('claims', 'write',
      () => supabase.from('claims').update(row).eq('id', id).select(CLAIM_SELECT).single(),
    )
    if (ok && data) return { data: toClaim(data), error: null }
    // This used to save to browser storage and report "pending sync". There
    // is no sync: nothing ever writes local storage back to Supabase, so the
    // claim advanced a stage for one person and for nobody else, while the
    // message promised it would catch up. A failed write is a failed write.
    return writeFailed('claims', error)
  },

  /**
   * Removes a claim outright. Its physical assessment and any fraud case go
   * with it (both cascade), so nothing is left orphaned pointing at a claim
   * that no longer exists.
   *
   * The activity log is deliberately untouched: entity_id there is plain
   * text rather than a foreign key, precisely so the record of who deleted
   * what survives the deletion. A trail that disappears along with the thing
   * it describes is not a trail.
   *
   * RLS (claims_delete_admin) already limits this to admin/super_admin;
   * hasPermission('claims.delete') gates the button as well, so a custom
   * role can withhold it from a given administrator.
   */
  async remove(id: string) {
    const { error } = await supabase.from('claims').delete().eq('id', id)
    if (error) return { error: error.message }
    return { error: null }
  },
}

/**
 * Advances a policy's payment cursor and status whenever a completed
 * payment lands against it — called from every completion path (create or
 * update-to-completed) so the lifecycle stays consistent everywhere rather
 * than being reimplemented per call site. Agriculture goes straight to
 * 'active' on its first payment (no waiting period); a lapsed policy that
 * gets caught up is reinstated to 'waiting_period', not straight to
 * 'active' — except agriculture, which has no waiting period at all and
 * reinstates straight to 'active', per the 2026-08 access review.
 * Fire-and-forget — a failure here shouldn't roll back an already-recorded
 * payment.
 */
async function applyCompletedPaymentToPolicy(policyId: string, amountPaid: number): Promise<void> {
  const [{ data: policy }, { data: prods }] = await Promise.all([policies.get(policyId), products.list()])
  if (!policy) return
  const category = prods?.find(p => p.id === policy.productId)?.category ?? ''
  const cycleMonths = category === 'agriculture' ? 12 : 1
  // One period costs the whole policy's premium — the policyholder plus
  // every dependant, since premiums are per head. Dividing by the
  // policyholder's share alone credited a family's single monthly payment
  // as several months of cover.
  const perPeriod = policyBillablePremium(policy, category)

  /**
   * Cover is only extended by the whole periods the money actually covers.
   *
   * This used to be Math.max(1, Math.round(paid / perPeriod)), which gave a
   * full month of cover for ANY payment at all: 50 cents against a $12
   * premium, a zero, even a negative, all bought a month. Rounding also
   * over-credited — $18 against $12 bought two months instead of one.
   *
   * floor() and no minimum: a part payment is still recorded as received
   * (the client is owed the credit and staff can see it), but it does not
   * move the due date until it adds up to a full period. Nothing is ever
   * extended for free.
   */
  const periodsPaid = perPeriod > 0 && amountPaid > 0
    ? Math.floor(amountPaid / perPeriod)
    : 0
  const monthsToAdvance = cycleMonths * periodsPaid

  const today = new Date()
  const base = policy.nextPaymentDate && new Date(policy.nextPaymentDate) > today ? new Date(policy.nextPaymentDate) : today
  const next = new Date(base)
  next.setMonth(next.getMonth() + monthsToAdvance)

  // Reinstatement and activation are worth a full period, same as cover:
  // a token payment must not bring a lapsed policy back to life. Gated on
  // periodsPaid for exactly that reason.
  let status = policy.status
  if (periodsPaid >= 1) {
    if (policy.status === 'lapsed') status = category === 'agriculture' ? 'active' : 'waiting_period'
    else if (category === 'agriculture' && policy.status === 'waiting_period') status = 'active'
  }

  await policies.update(policyId, {
    status,
    lastPaymentDate: today.toISOString().split('T')[0],
    nextPaymentDate: next.toISOString().split('T')[0],
  })
}

// ── PAYMENTS ──────────────────────────────────────────────────────
export const payments = {
  async list() {
    const { ok, data } = await sb('payments', 'read',
      () => supabase.from('payments').select(PAYMENT_SELECT).order('payment_date', { ascending: false }),
      d => Array.isArray(d),
    )
    if (ok && data) {
      const mapped = (data as unknown[]).map(toPayment)
      cacheSet('payments', mapped)
      return { data: mapped, error: null }
    }
    const cached = cacheGet<Payment>('payments')
    if (cached) return { data: cached.data, error: null }
    return { data: [] as Payment[], error: 'Could not load payments — connect to the internet at least once to cache them for offline use.' }
  },

  async create(payment: Omit<Payment, 'id'>) {
    // A zero or negative amount recorded as 'completed' still advances
    // nextPaymentDate and can reinstate a lapsed policy for free (see
    // applyCompletedPaymentToPolicy's Math.max(1, ...) floor) -- checked
    // here rather than trusting every caller (a UI form, the manual
    // recording flow, a future one) to have validated it first.
    if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
      return { data: null, error: 'Payment amount must be greater than zero.' }
    }
    const row = {
      reference: payment.reference, policy_id: payment.policyId,
      amount: payment.amount, method: payment.method, status: payment.status,
      payment_date: payment.date, split_payments: payment.splitPayments ?? null,
    }
    const { ok, data, error } = await sb('payments', 'write',
      () => supabase.from('payments').insert(row).select(PAYMENT_SELECT).single(),
    )
    if (ok && data) {
      const result = toPayment(data)
      if (result.status === 'completed') void applyCompletedPaymentToPolicy(result.policyId, result.amount)
      return { data: result, error: null }
    }
    return writeFailed('payments', error)
  },

  /** Marks a captured payment as validated (completed) or otherwise updates
   *  its status — the "payments capturing and validation" split from the
   *  2026-08 access review: capture = record(), validation = this. */
  async update(id: string, updates: Partial<Payment>) {
    if (updates.amount !== undefined && (!Number.isFinite(updates.amount) || updates.amount <= 0)) {
      return { data: null, error: 'Payment amount must be greater than zero.' }
    }
    const row: Record<string, unknown> = {}
    if (updates.status !== undefined) row.status = updates.status
    if (updates.amount !== undefined) row.amount = updates.amount
    if (updates.method !== undefined) row.method = updates.method
    if (updates.date !== undefined) row.payment_date = updates.date
    if (updates.splitPayments !== undefined) row.split_payments = updates.splitPayments ?? null
    const { ok, data, error } = await sb('payments', 'write',
      () => supabase.from('payments').update(row).eq('id', id).select(PAYMENT_SELECT).single(),
    )
    if (ok && data) {
      const result = toPayment(data)
      if (updates.status === 'completed') void applyCompletedPaymentToPolicy(result.policyId, result.amount)
      return { data: result, error: null }
    }
    return writeFailed('payments', error)
  },
}

// ── AGRICULTURE ASSESSMENTS ─────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toClaimAssessment(r: any): ClaimAssessment {
  return {
    id:                 r.id,
    claimId:            r.claim_id,
    claimNumber:        r.claims?.claim_number ?? '',
    assessorId:         r.assessor_id ?? '',
    assessorName:       r.profiles?.name ?? '',
    descriptionOfLoss:  r.description_of_loss ?? '',
    photos:             (r.photos as AssessmentPhoto[]) ?? [],
    assessorComments:   r.assessor_comments ?? '',
    farmerStatement:    r.farmer_statement ?? undefined,
    gpsLat:             r.gps_lat ?? undefined,
    gpsLng:             r.gps_lng ?? undefined,
    cropPopulation:     r.crop_population ?? undefined,
    cropStage:          r.crop_stage ?? undefined,
    barnCapacity:       r.barn_capacity ?? undefined,
    hectares:           r.hectares ?? undefined,
    leavesExpected:     r.leaves_expected ?? undefined,
    damagedLeaves:      r.damaged_leaves ?? undefined,
    barnStrings:        r.barn_strings ?? undefined,
    leavesPerString:    r.leaves_per_string ?? undefined,
    leavesLost:         r.leaves_lost ?? undefined,
    percentageLoss:     r.percentage_loss ?? undefined,
    grossLoss:          r.gross_loss ?? undefined,
    handlingExpenses:   r.handling_expenses ?? undefined,
    excessAmount:       r.excess_amount ?? undefined,
    claimPayable:       r.claim_payable ?? undefined,
    farmerSignature:    r.farmer_signature ?? undefined,
    assessorSignature:  r.assessor_signature ?? undefined,
    farmerSelfie:       r.farmer_selfie ?? undefined,
    submittedAt:        r.submitted_at ?? undefined,
    syncStatus:         r.sync_status ?? 'synced',
    createdAt:          r.created_at,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPolicyAssessment(r: any): PolicyAssessment {
  return {
    id:               r.id,
    policyId:         r.policy_id,
    policyNumber:     r.policies?.policy_number ?? '',
    clientName:       r.policies?.clients?.name ?? undefined,
    assessorId:       r.assessor_id ?? '',
    assessorName:     r.profiles?.name ?? '',
    subjectType:      r.subject_type ?? 'agriculture',
    cropType:         r.crop_type ?? undefined,
    cropPopulation:   r.crop_population ?? undefined,
    plantDate:        r.plant_date ?? undefined,
    registrationNumber: r.registration_number ?? undefined,
    vehicleMake:      r.vehicle_make ?? undefined,
    vehicleModel:     r.vehicle_model ?? undefined,
    odometerReading:  r.odometer_reading ?? undefined,
    existingDamage:   r.existing_damage ?? undefined,
    photos:           (r.photos as AssessmentPhoto[]) ?? [],
    notes:            r.notes ?? '',
    gpsLat:           r.gps_lat ?? undefined,
    gpsLng:           r.gps_lng ?? undefined,
    barnHooks:        r.barn_hooks ?? undefined,
    barnTiers:        r.barn_tiers ?? undefined,
    barnBays:         r.barn_bays ?? undefined,
    barnOwnership:    r.barn_ownership ?? undefined,
    barnUsage:        r.barn_usage ?? undefined,
    farmerSignature:  r.farmer_signature ?? undefined,
    assessorSignature: r.assessor_signature ?? undefined,
    syncStatus:       r.sync_status ?? 'synced',
    createdAt:        r.created_at,
  }
}

const CLAIM_ASSESSMENT_SELECT = `
  id, claim_id, assessor_id, description_of_loss, photos, assessor_comments, farmer_statement,
  gps_lat, gps_lng, crop_population, crop_stage, barn_capacity,
  hectares, leaves_expected, damaged_leaves, barn_strings, leaves_per_string, leaves_lost,
  percentage_loss, gross_loss, handling_expenses, excess_amount, claim_payable,
  farmer_signature, assessor_signature, farmer_selfie, submitted_at, sync_status, created_at,
  claims!claim_id(claim_number),
  profiles!assessor_id(name)
`
const POLICY_ASSESSMENT_SELECT = `
  id, policy_id, assessor_id, subject_type, crop_type, crop_population, plant_date,
  registration_number, vehicle_make, vehicle_model, odometer_reading, existing_damage,
  photos, notes, gps_lat, gps_lng, farmer_signature, assessor_signature, sync_status, created_at,
  barn_hooks, barn_tiers, barn_bays, barn_ownership, barn_usage,
  policies!policy_id(policy_number, clients!client_id(name)),
  profiles!assessor_id(name)
`

export const claimAssessments = {
  async listForClaim(claimId: string) {
    const { ok, data } = await sb('claim_assessments', 'read',
      () => supabase.from('claim_assessments').select(CLAIM_ASSESSMENT_SELECT).eq('claim_id', claimId).order('created_at', { ascending: false }),
      d => Array.isArray(d),
    )
    if (ok && data) return { data: (data as unknown[]).map(toClaimAssessment), error: null }
    return { data: [], error: null }
  },

  async create(a: Omit<ClaimAssessment, 'id' | 'claimNumber' | 'assessorName' | 'createdAt'>) {
    const row = {
      claim_id: a.claimId, assessor_id: a.assessorId || null,
      description_of_loss: a.descriptionOfLoss, photos: a.photos,
      assessor_comments: a.assessorComments, farmer_statement: a.farmerStatement ?? null,
      gps_lat: a.gpsLat ?? null, gps_lng: a.gpsLng ?? null,
      crop_population: a.cropPopulation ?? null, crop_stage: a.cropStage ?? null, barn_capacity: a.barnCapacity ?? null,
      hectares: a.hectares ?? null, leaves_expected: a.leavesExpected ?? null,
      damaged_leaves: a.damagedLeaves ?? null, barn_strings: a.barnStrings ?? null,
      leaves_per_string: a.leavesPerString ?? null, leaves_lost: a.leavesLost ?? null,
      percentage_loss: a.percentageLoss ?? null, gross_loss: a.grossLoss ?? null,
      handling_expenses: a.handlingExpenses ?? null, excess_amount: a.excessAmount ?? null,
      claim_payable: a.claimPayable ?? null,
      farmer_signature: a.farmerSignature ?? null, assessor_signature: a.assessorSignature ?? null,
      farmer_selfie: a.farmerSelfie ?? null, submitted_at: a.submittedAt ?? null, sync_status: a.syncStatus,
    }
    const { data, error } = await supabase.from('claim_assessments').insert(row).select(CLAIM_ASSESSMENT_SELECT).single()
    if (error) return { data: null, error: error.message }
    return { data: toClaimAssessment(data), error: null }
  },
}

export const policyAssessments = {
  async listForPolicy(policyId: string) {
    const { ok, data } = await sb('policy_assessments', 'read',
      () => supabase.from('policy_assessments').select(POLICY_ASSESSMENT_SELECT).eq('policy_id', policyId).order('created_at', { ascending: false }),
      d => Array.isArray(d),
    )
    if (ok && data) return { data: (data as unknown[]).map(toPolicyAssessment), error: null }
    return { data: [], error: null }
  },

  /** Every pre-loss assessment across every policy — powers the dedicated
   *  Pre-Loss Assessments management page (there was previously no way to
   *  browse this history at all, only record a new one from inside a
   *  policy). */
  async listAll() {
    const { ok, data } = await sb('policy_assessments', 'read',
      () => supabase.from('policy_assessments').select(POLICY_ASSESSMENT_SELECT).order('created_at', { ascending: false }).limit(500),
      d => Array.isArray(d),
    )
    if (ok && data) return { data: (data as unknown[]).map(toPolicyAssessment), error: null }
    return { data: [], error: null }
  },

  async create(a: Omit<PolicyAssessment, 'id' | 'policyNumber' | 'assessorName' | 'createdAt'>) {
    const row = {
      policy_id: a.policyId, assessor_id: a.assessorId || null, subject_type: a.subjectType,
      crop_type: a.cropType ?? null, crop_population: a.cropPopulation ?? null, plant_date: a.plantDate || null,
      registration_number: a.registrationNumber ?? null, vehicle_make: a.vehicleMake ?? null,
      vehicle_model: a.vehicleModel ?? null, odometer_reading: a.odometerReading ?? null,
      existing_damage: a.existingDamage ?? null,
      photos: a.photos, notes: a.notes, gps_lat: a.gpsLat ?? null, gps_lng: a.gpsLng ?? null,
      barn_hooks: a.barnHooks ?? null, barn_tiers: a.barnTiers ?? null, barn_bays: a.barnBays ?? null,
      barn_ownership: a.barnOwnership ?? null, barn_usage: a.barnUsage ?? null,
      farmer_signature: a.farmerSignature ?? null, assessor_signature: a.assessorSignature ?? null,
      sync_status: a.syncStatus,
    }
    const { data, error } = await supabase.from('policy_assessments').insert(row).select(POLICY_ASSESSMENT_SELECT).single()
    if (error) return { data: null, error: error.message }
    return { data: toPolicyAssessment(data), error: null }
  },
}

// ── CUSTOM ROLES ──────────────────────────────────────────────────
export const customRoles = {
  async list() {
    const { ok, data } = await sb('custom_roles', 'read',
      () => supabase.from('custom_roles').select('*').order('name'),
      d => Array.isArray(d),
    )
    if (ok && data) return { data: (data as Record<string, unknown>[]).map(toCustomRole), error: null }
    return { data: [], error: null }
  },

  async create(role: { name: string; description?: string; permissions: string[] }) {
    const { data: { user } } = await supabase.auth.getUser()
    const row = { name: role.name, description: role.description ?? null, permissions: role.permissions, created_by: user?.id ?? null }
    const { data, error } = await supabase.from('custom_roles').insert(row).select().single()
    if (error) return { data: null, error: error.code === '23505' ? 'A role with that name already exists.' : error.message }
    return { data: toCustomRole(data as Record<string, unknown>), error: null }
  },

  async update(id: string, updates: { name?: string; description?: string; permissions?: string[] }) {
    const row: Record<string, unknown> = {}
    if (updates.name !== undefined) row.name = updates.name
    if (updates.description !== undefined) row.description = updates.description
    if (updates.permissions !== undefined) row.permissions = updates.permissions
    const { data, error } = await supabase.from('custom_roles').update(row).eq('id', id).select().single()
    if (error) return { data: null, error: error.code === '23505' ? 'A role with that name already exists.' : error.message }
    return { data: toCustomRole(data as Record<string, unknown>), error: null }
  },

  /** Deleting a role clears custom_role_id on any staff it's assigned to
   *  (ON DELETE SET NULL) rather than failing — their permissions array is
   *  unaffected since it was only ever a snapshot copied at assignment time. */
  async remove(id: string) {
    const { error } = await supabase.from('custom_roles').delete().eq('id', id)
    if (error) return { error: error.message }
    return { error: null }
  },
}

// ── TICKETS ───────────────────────────────────────────────────────
export const tickets = {
  async list() {
    const { ok, data } = await sb('tickets', 'read',
      () => supabase.from('tickets').select(TICKET_SELECT).order('created_at', { ascending: false }),
      d => Array.isArray(d),
    )
    if (ok && data) {
      const mapped = (data as unknown[]).map(toTicket)
      cacheSet('tickets', mapped)
      return { data: mapped, error: null }
    }
    const cached = cacheGet<Ticket>('tickets')
    if (cached) return { data: cached.data, error: null }
    return { data: [] as Ticket[], error: 'Could not load tickets.' }
  },

  async create(ticket: Omit<Ticket, 'id'>) {
    const row = {
      ticket_number: ticket.ticketNumber, client_id: ticket.clientId,
      subject: ticket.subject, description: ticket.description,
      status: ticket.status, priority: ticket.priority, category: ticket.category,
      messages: ticket.messages,
    }
    const { ok, data, error } = await sb('tickets', 'write',
      () => supabase.from('tickets').insert(row).select(TICKET_SELECT).single(),
    )
    if (ok && data) return { data: toTicket(data), error: null }
    return writeFailed('tickets', error)
  },

  async update(id: string, updates: Partial<Ticket>) {
    const row: Record<string, unknown> = {}
    if (updates.status     !== undefined) row.status      = updates.status
    if (updates.assignedTo !== undefined) row.assigned_to = updates.assignedTo ?? null
    if (updates.messages   !== undefined) row.messages    = updates.messages
    row.updated_at = new Date().toISOString()
    const { ok, data, error } = await sb('tickets', 'write',
      () => supabase.from('tickets').update(row).eq('id', id).select(TICKET_SELECT).single(),
    )
    if (ok && data) return { data: toTicket(data), error: null }
    return writeFailed('tickets', error)
  },
}

// ── EMAILS ────────────────────────────────────────────────────────
export const emails = {
  async list(folder?: 'inbox' | 'sent') {
    const { ok, data } = await sb('emails', 'read',
      () => {
        let q = supabase.from('emails').select('*').order('created_at', { ascending: false })
        if (folder) q = q.eq('folder', folder)
        return q
      },
      d => Array.isArray(d),
    )
    if (ok && data) return { data: (data as unknown[]).map(toEmail), error: null }
    return { data: [] as EmailMessage[], error: 'Could not load the mailbox.' }
  },

  async create(email: Omit<EmailMessage, 'id' | 'timestamp'>) {
    const row = {
      from_address: email.from, from_name: email.fromName, to_address: email.to,
      subject: email.subject, body: email.body, read: email.read,
      folder: email.folder, linked_to: email.linkedTo ?? null,
    }
    const { ok, data, error } = await sb('emails', 'write',
      () => supabase.from('emails').insert(row).select().single(),
    )
    if (ok && data) return { data: toEmail(data), error: null }
    return writeFailed('emails', error)
  },

  async update(id: string, updates: Partial<EmailMessage>) {
    const row: Record<string, unknown> = {}
    if (updates.read    !== undefined) row.read    = updates.read
    if (updates.starred !== undefined) row.starred = updates.starred
    if (updates.folder  !== undefined) row.folder  = updates.folder
    const { ok, data, error } = await sb('emails', 'write',
      () => supabase.from('emails').update(row).eq('id', id).select().single(),
    )
    if (ok && data) return { data: toEmail(data), error: null }
    return writeFailed('emails', error)
  },

  async markRead(id: string) {
    await sb('emails', 'write', () => supabase.from('emails').update({ read: true }).eq('id', id))
  },

  async delete(id: string) {
    await sb('emails', 'delete', () => supabase.from('emails').delete().eq('id', id))
  },
}

// ── LEADS ─────────────────────────────────────────────────────────
export const leads = {
  async list() {
    const { ok, data } = await sb('leads', 'read',
      () => supabase.from('leads').select('*').order('created_at', { ascending: false }),
      d => Array.isArray(d),
    )
    if (ok && data) {
      const mapped = (data as unknown[]).map(toLead)
      cacheSet('leads', mapped)
      return { data: mapped, error: null }
    }
    const cached = cacheGet<Lead>('leads')
    if (cached) return { data: cached.data, error: null }
    return { data: [] as Lead[], error: 'Could not load leads.' }
  },

  async create(lead: Omit<Lead, 'id'>) {
    const row = {
      name: lead.name, email: lead.email ?? null, phone: lead.phone,
      source: lead.source, product_interest: lead.productInterest,
      status: lead.status, intent_score: lead.intentScore, assigned_to: lead.assignedTo ?? null,
    }
    const start = Date.now()
    const { data, error } = await supabase.from('leads').insert(row).select().single()
    health.record({ ts: Date.now(), type: 'write', table: 'leads', success: !error, duration: Date.now() - start, source: 'supabase', detail: error ? String(error.message) : undefined })
    if (error) return { data: null, error: error.message }
    return { data: toLead(data), error: null }
  },

  async update(id: string, updates: Partial<Lead>) {
    const row: Record<string, unknown> = {}
    if (updates.status      !== undefined) row.status       = updates.status
    if (updates.notes       !== undefined) row.notes        = updates.notes ?? null
    if (updates.lastContact !== undefined) row.last_contact = updates.lastContact ?? null
    if (updates.assignedTo  !== undefined) row.assigned_to  = updates.assignedTo ?? null
    const { ok, data, error } = await sb('leads', 'write',
      () => supabase.from('leads').update(row).eq('id', id).select().single(),
    )
    if (ok && data) return { data: toLead(data), error: null }
    return writeFailed('leads', error)
  },
}

// ── STAFF / PROFILES ──────────────────────────────────────────────
export const staff = {
  // No local-storage fallback here — unlike most list() methods, a stale
  // mock roster standing in for real staff/system accounts is actively
  // dangerous: it looks real enough to act on (edit, delete) but its IDs
  // don't exist in the real profiles table, so e.g. a delete against it
  // fails with a confusing 404 instead of the real account ever being
  // touched. Better to surface the load failure than to risk that.
  async list() {
    const { ok, data } = await sb('profiles', 'read',
      () => supabase.from('profiles').select('*, custom_roles!profiles_custom_role_id_fkey(name)').order('name'),
      d => Array.isArray(d),
    )
    if (ok && data) return { data: (data as Record<string,unknown>[]).map(toProfile), error: null }
    return { data: null, error: 'Could not load the staff list from the server. Please check your connection and try again.' }
  },

  /**
   * Creates a real Supabase Auth user + profiles row via a Netlify function
   * (api/create-account.ts), which alone holds the service-role
   * key needed for account creation. Unlike every other method in this
   * module, there is no local-storage fallback here — a "staff member"
   * that only exists in browser state was never real, so a failure must be
   * surfaced as an error rather than silently faked.
   */
  async create(input: { name: string; username?: string; email: string; password: string; phone?: string; role: string; department: string; customRoleId?: string; permissions?: string[] }) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { data: null, error: 'Not signed in.' }
    try {
      const res = await fetch('/api/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { data: null, error: body?.error ?? `Failed to create staff account (HTTP ${res.status}).` }
      return { data: toProfile(body.profile as Record<string, unknown>), error: null }
    } catch (e) {
      return { data: null, error: `Could not reach the server: ${e}` }
    }
  },

  // No local-storage fallback — a profile edit (name/phone especially) that
  // only "succeeds" into localStorage looks fine in the moment but reverts
  // the next time real data loads, which is exactly what was reported.
  async update(id: string, updates: Partial<AppUser>) {
    const row: Record<string, unknown> = {}
    if (updates.name        !== undefined) row.name        = updates.name
    if (updates.username    !== undefined) row.username    = updates.username?.trim() || null
    if (updates.role        !== undefined) row.role        = updates.role
    if (updates.department  !== undefined) row.department  = updates.department
    if (updates.phone       !== undefined) row.phone       = updates.phone ?? null
    if (updates.active      !== undefined) row.active      = updates.active
    if (updates.permissions !== undefined) row.permissions = updates.permissions
    if (updates.customRoleId !== undefined) row.custom_role_id = updates.customRoleId || null
    const start = Date.now()
    const { data, error } = await supabase.from('profiles').update(row).eq('id', id).select('*, custom_roles!profiles_custom_role_id_fkey(name)').single()
    health.record({ ts: Date.now(), type: 'write', table: 'profiles', success: !error, duration: Date.now() - start, source: 'supabase', detail: error ? String(error.message) : undefined })
    if (error) return { data: null, error: error.code === '23505' ? 'That username is already taken.' : error.message }
    return { data: toProfile(data as Record<string,unknown>), error: null }
  },

  /**
   * Permanently deletes a staff member via delete-staff.ts (service-role
   * only — removes the Supabase Auth identity itself, not just the
   * profiles row, so the account can no longer sign in at all). No
   * local-storage fallback, same reasoning as create(): a "deleted" staff
   * member that only disappeared from browser state was never really gone.
   */
  async remove(staffId: string) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { error: 'Not signed in.' }
    try {
      const res = await fetch('/api/delete-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ staffId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { error: body?.error ?? `Failed to delete staff account (HTTP ${res.status}).` }
      return { error: null }
    } catch (e) {
      return { error: `Could not reach the server: ${e}` }
    }
  },

  /**
   * Creates a Super Admin / Admin / Tech Support account — same
   * api/create-account.ts endpoint as staff.create() (Staff Management,
   * work roles only), which branches on whether body.role falls into the
   * system-role or work-role list. Super Admin caller only, enforced both
   * here and again by the DB trigger.
   */
  async createSystemUser(input: { name: string; username?: string; email: string; password: string; phone?: string; role: string; department: string }) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { data: null, error: 'Not signed in.' }
    try {
      const res = await fetch('/api/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(input),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { data: null, error: body?.error ?? `Failed to create account (HTTP ${res.status}).` }
      return { data: toProfile(body.profile as Record<string, unknown>), error: null }
    } catch (e) {
      return { data: null, error: `Could not reach the server: ${e}` }
    }
  },

  /**
   * Sets a new password for a staff member via reset-staff-password.ts
   * (service-role only). Replaces the "Not editable here" dead end that
   * used to be the only thing shown for an existing staff member's
   * password — an admin helping a locked-out colleague has no way to
   * supply that colleague's CURRENT password, so self-service Change
   * Password isn't an option for them.
   */
  async resetPassword(staffId: string, newPassword: string) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { error: 'Not signed in.' }
    try {
      const res = await fetch('/api/reset-staff-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ staffId, newPassword }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { error: body?.error ?? `Failed to reset password (HTTP ${res.status}).` }
      return { error: null }
    } catch (e) {
      return { error: `Could not reach the server: ${e}` }
    }
  },
}

// ── FRAUD CASES ───────────────────────────────────────────────────
export const fraudCases = {
  async list() {
    const { ok, data } = await sb('fraud_cases', 'read',
      () => supabase.from('fraud_cases').select(FRAUD_SELECT).order('created_at', { ascending: false }),
      d => Array.isArray(d),
    )
    if (ok && data) {
      const mapped = (data as unknown[]).map(toFraudCase)
      cacheSet('fraud_cases', mapped)
      return { data: mapped, error: null }
    }
    const cached = cacheGet<FraudCase>('fraud_cases')
    if (cached) return { data: cached.data, error: null }
    return { data: [] as FraudCase[], error: 'Could not load fraud cases.' }
  },

  async update(id: string, updates: Partial<FraudCase>) {
    const row: Record<string, unknown> = {}
    if (updates.status     !== undefined) row.status      = updates.status
    if (updates.assignedTo !== undefined) row.assigned_to = updates.assignedTo ?? null
    if (updates.notes      !== undefined) row.notes       = updates.notes ?? null
    if (updates.resolvedAt !== undefined) row.resolved_at = updates.resolvedAt ?? null
    const { ok, data, error } = await sb('fraud_cases', 'write',
      () => supabase.from('fraud_cases').update(row).eq('id', id).select(FRAUD_SELECT).single(),
    )
    if (ok && data) return { data: toFraudCase(data), error: null }
    return writeFailed('fraud_cases', error)
  },

  /** Auto-opened when a newly submitted claim's AI fraud score clears the review threshold. */
  async create(claimId: string, fraudScore: number, signals: string[]) {
    const row = { claim_id: claimId, fraud_score: fraudScore, signals, status: 'open' }
    const { data, error } = await supabase.from('fraud_cases').insert(row).select(FRAUD_SELECT).single()
    if (error) return { data: null, error: error.message }
    return { data: toFraudCase(data), error: null }
  },
}

// ── REMINDERS ─────────────────────────────────────────────────────
export const reminders = {
  async list() {
    const { ok, data } = await sb('reminders', 'read',
      () => supabase.from('reminders').select(REMINDER_SELECT).order('due_date'),
      d => Array.isArray(d),
    )
    if (ok && data) return { data: (data as unknown[]).map(toReminder), error: null }
    return { data: [] as Reminder[], error: 'Could not load reminders.' }
  },

  async markSent(id: string) {
    await sb('reminders', 'write', () => supabase.from('reminders').update({ sent: true }).eq('id', id))

  },

  async markAllSent(ids: string[]) {
    await sb('reminders', 'write', () => supabase.from('reminders').update({ sent: true }).in('id', ids))

  },

  /** Has a reminder tagged with this stage already been logged for this
   *  policy+due date? Dedup lives in the database (not localStorage) so it
   *  holds regardless of how many staff browsers have the app open —
   *  otherwise every logged-in staff member's hourly check would re-send
   *  the same reminder independently. */
  async existsForStage(policyId: string, dueDateISO: string, stageTag: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('reminders').select('id').eq('policy_id', policyId).eq('due_date', dueDateISO)
      .like('message', `${stageTag}%`).limit(1)
    if (error) return false // fail open: better to risk a rare duplicate than silently stop all reminders
    return (data?.length ?? 0) > 0
  },

  async create(reminder: Omit<Reminder, 'id'>) {
    const row = {
      type: reminder.type, client_id: reminder.clientId, policy_id: reminder.policyId ?? null,
      due_date: reminder.dueDate, message: reminder.message, sent: reminder.sent, channel: reminder.channel,
    }
    const { data, error } = await supabase.from('reminders').insert(row).select(REMINDER_SELECT).single()
    if (error) return { data: null, error: error.message }
    return { data: toReminder(data), error: null }
  },
}

// ── CAUTION FLAGS ─────────────────────────────────────────────────
// Real table (not localStorage) so a flag raised by one staff member's
// browser is visible to every other staff member, including whoever
// reviews claims — a caution flag is meant to trigger extra scrutiny there.
export const cautionFlags = {
  async listActive() {
    const { data, error } = await supabase.from('caution_flags').select('*').eq('cleared', false).order('flagged_at', { ascending: false })
    if (error) return { data: [] as CautionFlag[], error: error.message }
    return { data: (data ?? []).map(toCautionFlag), error: null }
  },

  async get(policyId: string) {
    const { data, error } = await supabase.from('caution_flags').select('*').eq('policy_id', policyId).maybeSingle()
    if (error || !data) return { data: null, error: error?.message ?? null }
    return { data: toCautionFlag(data), error: null }
  },

  async set(flag: CautionFlag) {
    const row = {
      policy_id: flag.policyId, policy_number: flag.policyNumber, client_id: flag.clientId,
      client_name: flag.clientName, agent_id: flag.agentId ?? null, days_overdue: flag.daysOverdue,
      flagged_at: flag.flaggedAt, months_defaulted: flag.monthsDefaulted, cleared: flag.cleared,
      cleared_at: flag.clearedAt ?? null,
    }
    const { error } = await supabase.from('caution_flags').upsert(row, { onConflict: 'policy_id' })
    return { error: error?.message ?? null }
  },

  async clear(policyId: string) {
    const { error } = await supabase.from('caution_flags')
      .update({ cleared: true, cleared_at: new Date().toISOString() }).eq('policy_id', policyId)
    return { error: error?.message ?? null }
  },
}

// ── DEVELOPER API ─────────────────────────────────────────────────
export interface ApiDeveloper {
  id: string
  agentProfileId: string
  companyName: string
  contactEmail: string
  contactPhone?: string
  status: 'active' | 'suspended' | 'terminated'
  commissionOverridePercent?: number
  termsAcceptedAt?: string
  termsVersion?: string
  terminatedAt?: string
  terminationReason?: string
  createdAt: string
}

export interface ApiKeyRow {
  id: string
  developerId: string
  keyPrefix: string
  /** Safe to display/copy at any time — identifies the key without
   *  granting access on its own (mirrors Stripe's pk_/sk_ pattern). */
  publishableKey: string
  environment: 'sandbox' | 'live'
  scopes: string[]
  status: 'active' | 'paused' | 'revoked'
  rateLimitPerMin: number
  createdAt: string
  lastUsedAt?: string
}

export interface ApiRequestLogRow {
  id: string
  keyId: string
  keyPrefix?: string
  endpoint: string
  statusCode: number
  ts: string
}

export interface ApiUsageStats {
  requestsToday: number
  requests7d: number
  requestsTotal: number
  lastRequestAt?: string
  errorRate7d: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toApiDeveloper(r: any): ApiDeveloper {
  return {
    id: r.id, agentProfileId: r.agent_profile_id, companyName: r.company_name,
    contactEmail: r.contact_email, contactPhone: r.contact_phone ?? undefined,
    status: r.status, commissionOverridePercent: r.commission_override_percent ?? undefined,
    termsAcceptedAt: r.terms_accepted_at ?? undefined, termsVersion: r.terms_version ?? undefined,
    terminatedAt: r.terminated_at ?? undefined, terminationReason: r.termination_reason ?? undefined,
    createdAt: r.created_at,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toApiKeyRow(r: any): ApiKeyRow {
  return {
    id: r.id, developerId: r.developer_id, keyPrefix: r.key_prefix,
    publishableKey: r.publishable_key ?? '', environment: (r.environment as 'sandbox' | 'live') ?? 'live',
    scopes: r.scopes ?? [],
    status: r.status, rateLimitPerMin: r.rate_limit_per_min, createdAt: r.created_at,
    lastUsedAt: r.last_used_at ?? undefined,
  }
}

export const developerApi = {
  async listDevelopers() {
    const { data, error } = await supabase.from('api_developers').select('*').order('created_at', { ascending: false })
    if (error) return { data: [] as ApiDeveloper[], error: error.message }
    return { data: (data ?? []).map(toApiDeveloper), error: null }
  },

  async listKeys(developerId: string) {
    const { data, error } = await supabase.from('api_keys').select('*').eq('developer_id', developerId).order('created_at', { ascending: false })
    if (error) return { data: [] as ApiKeyRow[], error: error.message }
    return { data: (data ?? []).map(toApiKeyRow), error: null }
  },

  /** Calls create-api-developer.ts — needs the service-role key to create the partner's login-disabled identity. */
  async createDeveloper(input: { companyName: string; contactEmail: string; contactPhone?: string; termsVersion: string }) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { data: null, error: 'Not signed in.' }
    try {
      // termsAccepted is hardcoded true here — the only caller (DeveloperApi
      // page) already gates the Register button on the acceptance checkbox,
      // so by the time this fires the admin has confirmed it on the client's
      // behalf. termsVersion still travels through from the caller so the
      // stored record reflects exactly what was shown at registration time.
      const res = await fetch('/api/create-api-developer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ ...input, termsAccepted: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { data: null, error: body?.error ?? `Failed to register developer (HTTP ${res.status}).` }
      return { data: toApiDeveloper(body.developer), error: null }
    } catch (e) {
      return { data: null, error: `Could not reach the server: ${e}` }
    }
  },

  /** Calls create-api-key.ts. Returns the raw secret key ONCE — it is never
   *  stored or retrievable again. The publishable key is safe to fetch and
   *  display again later (it's just a display/lookup id, not a credential). */
  async issueKey(developerId: string, opts?: { scopes?: string[]; rateLimitPerMin?: number; environment?: 'sandbox' | 'live' }) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { data: null, error: 'Not signed in.' }
    try {
      const res = await fetch('/api/create-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ developerId, scopes: opts?.scopes, rateLimitPerMin: opts?.rateLimitPerMin, environment: opts?.environment ?? 'live' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { data: null, error: body?.error ?? `Failed to issue key (HTTP ${res.status}).` }
      return { data: { ...toApiKeyRow(body.key), rawKey: body.key.rawKey as string }, error: null }
    } catch (e) {
      return { data: null, error: `Could not reach the server: ${e}` }
    }
  },

  async revokeKey(keyId: string) {
    const { error } = await supabase.from('api_keys').update({ status: 'revoked' }).eq('id', keyId)
    return { error: error?.message ?? null }
  },

  /** Reversible, unlike revoke — a paused key can be resumed. Rejected by
   *  the external API exactly like a revoked one in the meantime (only
   *  status = 'active' is accepted there). */
  async pauseKey(keyId: string) {
    const { error } = await supabase.from('api_keys').update({ status: 'paused' }).eq('id', keyId)
    return { error: error?.message ?? null }
  },

  async resumeKey(keyId: string) {
    const { error } = await supabase.from('api_keys').update({ status: 'active' }).eq('id', keyId)
    return { error: error?.message ?? null }
  },

  /** Recent raw request log for one developer's keys — the audit trail
   *  behind the usage stats below. */
  async listRequestLog(developerId: string, limit = 100): Promise<{ data: ApiRequestLogRow[]; error: string | null }> {
    const { data: keys } = await supabase.from('api_keys').select('id, key_prefix').eq('developer_id', developerId)
    const keyIds = (keys ?? []).map(k => k.id)
    if (keyIds.length === 0) return { data: [], error: null }
    const prefixById = new Map((keys ?? []).map(k => [k.id, k.key_prefix as string]))
    const { data, error } = await supabase
      .from('api_request_log')
      .select('id, key_id, endpoint, status_code, ts')
      .in('key_id', keyIds)
      .order('ts', { ascending: false })
      .limit(limit)
    if (error) return { data: [], error: error.message }
    return {
      data: (data ?? []).map(r => ({
        id: r.id, keyId: r.key_id, keyPrefix: prefixById.get(r.key_id), endpoint: r.endpoint, statusCode: r.status_code, ts: r.ts,
      })),
      error: null,
    }
  },

  /** Aggregate usage counts for one developer across all their keys —
   *  today, last 7 days, all-time, and a rough error rate so a suspiciously
   *  high failure/rate-limit ratio is visible at a glance. */
  async getUsageStats(developerId: string): Promise<{ data: ApiUsageStats; error: string | null }> {
    const empty: ApiUsageStats = { requestsToday: 0, requests7d: 0, requestsTotal: 0, errorRate7d: 0 }
    const { data: keys } = await supabase.from('api_keys').select('id').eq('developer_id', developerId)
    const keyIds = (keys ?? []).map(k => k.id)
    if (keyIds.length === 0) return { data: empty, error: null }

    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000)

    const [todayRes, weekRes, totalRes, lastRes] = await Promise.all([
      supabase.from('api_request_log').select('*', { count: 'exact', head: true }).in('key_id', keyIds).gte('ts', startOfToday.toISOString()),
      supabase.from('api_request_log').select('status_code').in('key_id', keyIds).gte('ts', sevenDaysAgo.toISOString()),
      supabase.from('api_request_log').select('*', { count: 'exact', head: true }).in('key_id', keyIds),
      supabase.from('api_request_log').select('ts').in('key_id', keyIds).order('ts', { ascending: false }).limit(1).maybeSingle(),
    ])

    const weekRows = (weekRes.data ?? []) as { status_code: number }[]
    const errors7d = weekRows.filter(r => r.status_code >= 400).length

    return {
      data: {
        requestsToday: todayRes.count ?? 0,
        requests7d: weekRows.length,
        requestsTotal: totalRes.count ?? 0,
        lastRequestAt: (lastRes.data as { ts: string } | null)?.ts,
        errorRate7d: weekRows.length > 0 ? Math.round((errors7d / weekRows.length) * 100) : 0,
      },
      error: null,
    }
  },

  async setDeveloperStatus(developerId: string, status: 'active' | 'suspended') {
    const { error } = await supabase.from('api_developers').update({ status }).eq('id', developerId)
    return { error: error?.message ?? null }
  },

  /**
   * Permanent — unlike suspend, there is no reactivate path back from this.
   * Revokes every active key for the developer in the same action, since a
   * terminated developer should lose access immediately, not just be
   * blocked from issuing new keys.
   */
  async terminateDeveloper(developerId: string, reason: string) {
    const { error: devError } = await supabase.from('api_developers').update({
      status: 'terminated', terminated_at: new Date().toISOString(), termination_reason: reason,
    }).eq('id', developerId)
    if (devError) return { error: devError.message }
    const { error: keysError } = await supabase.from('api_keys').update({ status: 'revoked' })
      .eq('developer_id', developerId).eq('status', 'active')
    return { error: keysError?.message ?? null }
  },

  async setCommissionOverride(developerId: string, pct: number | null) {
    const { error } = await supabase.from('api_developers').update({ commission_override_percent: pct }).eq('id', developerId)
    return { error: error?.message ?? null }
  },
}

// ── LOGIN ATTEMPTS ────────────────────────────────────────────────
// Real brute-force signal for System Health — previously that page had
// no security data at all, only DB latency stats.
export const loginAttempts = {
  /** Failed attempts in the last N minutes, grouped by email, for staff-only viewing. */
  async recentFailures(minutes = 15) {
    const since = new Date(Date.now() - minutes * 60000).toISOString()
    const { data, error } = await supabase
      .from('login_attempts').select('email, ts').eq('success', false).gte('ts', since).order('ts', { ascending: false })
    if (error || !data) return { data: [] as { email: string; count: number; lastAttempt: string }[], error: error?.message ?? null }
    const byEmail = new Map<string, { email: string; count: number; lastAttempt: string }>()
    for (const row of data as { email: string; ts: string }[]) {
      const existing = byEmail.get(row.email)
      if (existing) existing.count += 1
      else byEmail.set(row.email, { email: row.email, count: 1, lastAttempt: row.ts })
    }
    return { data: [...byEmail.values()].sort((a, b) => b.count - a.count), error: null }
  },

  /** Real sign-in history for one account — powers Profile > Audit Log,
   *  which used to show hardcoded sample rows regardless of who was
   *  actually logged in or what they'd actually done. */
  async historyFor(email: string, limit = 50): Promise<{ data: { success: boolean; ts: string }[]; error: string | null }> {
    const { data, error } = await supabase
      .from('login_attempts')
      .select('success, ts')
      .eq('email', email.toLowerCase())
      .order('ts', { ascending: false })
      .limit(limit)
    if (error) return { data: [], error: error.message }
    return { data: (data ?? []) as { success: boolean; ts: string }[], error: null }
  },
}

// ── APP SETTINGS ──────────────────────────────────────────────────
// Generic shared key/value settings store (notification config, gateway
// credentials, commission rates, …). Writable by admin/super_admin only
// (enforced by RLS) so a setting one Super Admin configures is what every
// staff browser actually uses, instead of each browser's own localStorage.
export const settings = {
  async get<T>(key: string): Promise<T | null> {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle()
    if (error || !data) return null
    return data.value as T
  },

  async set(key: string, value: unknown): Promise<{ error: string | null }> {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('app_settings')
      .upsert({ key, value, updated_by: user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    return { error: error?.message ?? null }
  },
}

// ── DASHBOARD STATS ──────────────────────────────────────────────
// Dashboard.tsx used to fetch every row of policies/claims/payments/leads/
// fraud_cases (each with embedded client/product/profile joins) just to
// compute a handful of counts and a 5-row "recent" table — the single
// heaviest set of queries in the app, re-run on every dashboard visit.
// This replaces that with count-only queries (near-zero payload) and
// narrow column selects, falling back to the old full-fetch-and-compute
// approach only if the lightweight path fails.

export interface DashboardStats {
  activePolicies: number
  pendingClaims: number
  totalPremiums: number
  newLeads: number
  fraudAlerts: number
  lapseRate: number
  totalClients: number
  productBreakdown: { category: string; count: number }[]
  recentPolicies: Policy[]
  latestClaim: { claimNumber: string; clientName: string; at: string } | null
  latestPayment: { clientName: string; amount: number; at: string } | null
  latestLead: { name: string; source: string; at: string } | null
  latestFraud: { claimNumber: string; fraudScore: number; at: string } | null
  latestClient: { name: string; at: string } | null
}

async function loadDashboardStatsLight(): Promise<DashboardStats | null> {
  const [
    activeRes, pendingRes, leadsRes, fraudRes, lapsedRes, totalRes, premiumsRes, categoryRes, recentRes,
    latestClaimRes, latestPaymentRes, latestLeadRes, latestFraudRes, clientsCountRes, latestClientRes,
  ] = await Promise.all([
    supabase.from('policies').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('claims').select('*', { count: 'exact', head: true }).in('status', ['pending', 'under_review']),
    supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'new'),
    supabase.from('fraud_cases').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('policies').select('*', { count: 'exact', head: true }).eq('status', 'lapsed'),
    supabase.from('policies').select('*', { count: 'exact', head: true }),
    supabase.from('payments').select('amount').eq('status', 'completed').limit(5000),
    supabase.from('policies').select('products!product_id(category)').limit(5000),
    supabase.from('policies').select(POLICY_SELECT).order('created_at', { ascending: false }).limit(5),
    supabase.from('claims').select('claim_number, created_at, policies!policy_id(clients!client_id(name))').order('created_at', { ascending: false }).limit(1),
    supabase.from('payments').select('amount, payment_date, policies!policy_id(clients!client_id(name))').order('payment_date', { ascending: false }).limit(1),
    supabase.from('leads').select('name, source, created_at').order('created_at', { ascending: false }).limit(1),
    supabase.from('fraud_cases').select('fraud_score, created_at, claims!claim_id(claim_number)').order('created_at', { ascending: false }).limit(1),
    supabase.from('clients').select('*', { count: 'exact', head: true }),
    supabase.from('clients').select('name, created_at').order('created_at', { ascending: false }).limit(1),
  ])

  const anyError = activeRes.error || pendingRes.error || leadsRes.error || fraudRes.error
    || lapsedRes.error || totalRes.error || premiumsRes.error || categoryRes.error || recentRes.error
    || latestClaimRes.error || latestPaymentRes.error || latestLeadRes.error || latestFraudRes.error
    || clientsCountRes.error || latestClientRes.error
  if (anyError) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = latestClaimRes.data?.[0] as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = latestPaymentRes.data?.[0] as any
  const l = latestLeadRes.data?.[0] as { name: string; source: string; created_at: string } | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = latestFraudRes.data?.[0] as any
  const cl = latestClientRes.data?.[0] as { name: string; created_at: string } | undefined

  const totalPremiums = ((premiumsRes.data ?? []) as { amount: number }[]).reduce((s, p) => s + p.amount, 0)

  const categoryCounts = new Map<string, number>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (categoryRes.data ?? []) as any[]) {
    const cat = row.products?.category ?? 'other'
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1)
  }

  const total = totalRes.count ?? 0
  const lapsed = lapsedRes.count ?? 0

  return {
    activePolicies: activeRes.count ?? 0,
    pendingClaims: pendingRes.count ?? 0,
    totalPremiums,
    newLeads: leadsRes.count ?? 0,
    fraudAlerts: fraudRes.count ?? 0,
    lapseRate: total > 0 ? Number((lapsed / total * 100).toFixed(1)) : 0,
    totalClients: clientsCountRes.count ?? 0,
    productBreakdown: [...categoryCounts.entries()].map(([category, count]) => ({ category, count })),
    recentPolicies: ((recentRes.data ?? []) as unknown[]).map(toPolicy),
    latestClaim: c ? { claimNumber: c.claim_number, clientName: c.policies?.clients?.name ?? '', at: c.created_at } : null,
    latestPayment: p ? { clientName: p.policies?.clients?.name ?? '', amount: p.amount, at: p.payment_date } : null,
    latestLead: l ? { name: l.name, source: l.source ?? '', at: l.created_at } : null,
    latestFraud: f ? { claimNumber: f.claims?.claim_number ?? '', fraudScore: f.fraud_score, at: f.created_at } : null,
    latestClient: cl ? { name: cl.name, at: cl.created_at } : null,
  }
}

async function loadDashboardStatsFallback(): Promise<DashboardStats> {
  const [{ data: allPolicies }, { data: allClaims }, { data: allPayments }, { data: allLeads }, { data: allFraud }, { data: allClients }] = await Promise.all([
    policies.list(), claims.list(), payments.list(), leads.list(), fraudCases.list(), clients.list(),
  ])
  const pol = allPolicies ?? [], cla = allClaims ?? [], pay = allPayments ?? [], lea = allLeads ?? [], fra = allFraud ?? [], cli = allClients ?? []
  const total = pol.length
  const lapsed = pol.filter(p => p.status === 'lapsed').length
  const categoryCounts = new Map<string, number>()
  // Bucketed by product category, matching the primary query above — this
  // fallback used to bucket by product NAME, so the dashboard's category
  // breakdown listed individual packages as though they were categories.
  for (const p of pol) {
    const cat = p.productCategory ?? 'other'
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1)
  }
  return {
    activePolicies: pol.filter(p => p.status === 'active').length,
    pendingClaims: cla.filter(c => c.status === 'pending' || c.status === 'under_review').length,
    totalPremiums: pay.filter(p => p.status === 'completed').reduce((s, p) => s + p.amount, 0),
    newLeads: lea.filter(l => l.status === 'new').length,
    fraudAlerts: fra.filter(f => f.status === 'open').length,
    lapseRate: total > 0 ? Number((lapsed / total * 100).toFixed(1)) : 0,
    totalClients: cli.length,
    productBreakdown: [...categoryCounts.entries()].map(([category, count]) => ({ category, count })),
    recentPolicies: [...pol].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    latestClaim: cla[0] ? { claimNumber: cla[0].claimNumber, clientName: cla[0].clientName, at: cla[0].dateSubmitted } : null,
    latestPayment: pay[0] ? { clientName: pay[0].clientName, amount: pay[0].amount, at: pay[0].date } : null,
    latestLead: lea[0] ? { name: lea[0].name, source: lea[0].source, at: lea[0].createdAt } : null,
    latestFraud: fra[0] ? { claimNumber: fra[0].claimNumber, fraudScore: fra[0].fraudScore, at: fra[0].createdAt } : null,
    latestClient: cli[0] ? (() => { const c = [...cli].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; return { name: c.name, at: c.createdAt } })() : null,
  }
}

export const dashboardStats = {
  async load(): Promise<{ data: DashboardStats; error: null }> {
    const start = Date.now()
    const light = await loadDashboardStatsLight()
    if (light) {
      health.record({ ts: Date.now(), type: 'read', table: 'dashboard_stats', success: true, duration: Date.now() - start, source: 'supabase' })
      return { data: light, error: null }
    }
    return { data: await loadDashboardStatsFallback(), error: null }
  },
}

// ── SIDEBAR COUNTS ────────────────────────────────────────────────
// The sidebar nav badges used to be hardcoded numbers (e.g. "1,284"
// policies, "892" clients) baked into the nav config — real counts,
// live, cheap COUNT-only queries.
export interface SidebarCounts {
  policies: number
  claimsPending: number
  clients: number
  remindersDue: number
  emailUnread: number
  ticketsOpen: number
  chatQueued: number
}

export const sidebarCounts = {
  async load(): Promise<SidebarCounts> {
    const [pol, claimsRes, cli, rem, mail, tix, chatQ] = await Promise.all([
      supabase.from('policies').select('*', { count: 'exact', head: true }),
      supabase.from('claims').select('*', { count: 'exact', head: true }).in('status', ['pending', 'under_review']),
      supabase.from('clients').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('reminders').select('*', { count: 'exact', head: true }).eq('sent', false),
      supabase.from('emails').select('*', { count: 'exact', head: true }).eq('folder', 'inbox').eq('read', false),
      supabase.from('tickets').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
      supabase.from('chat_sessions').select('*', { count: 'exact', head: true }).eq('status', 'queued'),
    ])
    return {
      policies: pol.count ?? 0,
      claimsPending: claimsRes.count ?? 0,
      clients: cli.count ?? 0,
      remindersDue: rem.count ?? 0,
      emailUnread: mail.count ?? 0,
      ticketsOpen: tix.count ?? 0,
      chatQueued: chatQ.count ?? 0,
    }
  },
}

// ── POLICY CARDS (member IDs + RFID) ──────────────────────────────

function toPolicyCard(r: Record<string, unknown>): PolicyCard {
  return {
    id: r.id as string,
    memberNumber: r.member_number as string,
    policyId: r.policy_id as string,
    policyNumber: r.policy_number as string,
    memberPosition: Number(r.member_position ?? 0),
    memberName: r.member_name as string,
    holderName: r.holder_name as string,
    clientId: (r.client_id as string) ?? '',
    rfidTag: (r.rfid_tag as string) ?? undefined,
    status: r.status as PolicyCard['status'],
    issuedAt: r.issued_at as string,
    issuedByName: (r.profiles as { name?: string } | null)?.name,
    expiresAt: (r.expires_at as string) ?? undefined,
    notes: (r.notes as string) ?? undefined,
    createdAt: r.created_at as string,
  }
}

const POLICY_CARD_SELECT = '*, profiles!issued_by(name)'

export const policyCards = {
  async list() {
    const { ok, data } = await sb('policy_cards', 'read',
      () => supabase.from('policy_cards').select(POLICY_CARD_SELECT).order('created_at', { ascending: false }),
      d => Array.isArray(d),
    )
    if (ok && data) return { data: (data as Record<string, unknown>[]).map(toPolicyCard), error: null }
    return { data: [] as PolicyCard[], error: null }
  },

  /** Issues (or re-issues) the card for one member. The member number is
   *  unique, so re-issuing updates the existing row rather than leaving two
   *  cards claiming to be the same person. */
  async issue(card: Omit<PolicyCard, 'id' | 'createdAt' | 'issuedAt' | 'issuedByName'> & { issuedBy?: string }) {
    const row = {
      member_number: card.memberNumber,
      policy_id: card.policyId,
      policy_number: card.policyNumber,
      member_position: card.memberPosition,
      member_name: card.memberName,
      holder_name: card.holderName,
      client_id: card.clientId || null,
      rfid_tag: card.rfidTag || null,
      status: card.status,
      issued_by: card.issuedBy || null,
      expires_at: card.expiresAt || null,
      notes: card.notes || null,
      issued_at: new Date().toISOString(),
    }
    const { data, error } = await supabase
      .from('policy_cards')
      .upsert(row, { onConflict: 'member_number' })
      .select(POLICY_CARD_SELECT)
      .single()
    if (error) {
      return {
        data: null,
        error: error.code === '23505'
          ? 'That RFID tag is already assigned to another member.'
          : error.message,
      }
    }
    return { data: toPolicyCard(data), error: null }
  },

  async update(id: string, updates: Partial<Pick<PolicyCard, 'rfidTag' | 'status' | 'expiresAt' | 'notes'>>) {
    const row: Record<string, unknown> = {}
    if (updates.rfidTag   !== undefined) row.rfid_tag  = updates.rfidTag || null
    if (updates.status    !== undefined) row.status    = updates.status
    if (updates.expiresAt !== undefined) row.expires_at = updates.expiresAt || null
    if (updates.notes     !== undefined) row.notes     = updates.notes || null
    const { data, error } = await supabase.from('policy_cards').update(row).eq('id', id).select(POLICY_CARD_SELECT).single()
    if (error) {
      return {
        data: null,
        error: error.code === '23505' ? 'That RFID tag is already assigned to another member.' : error.message,
      }
    }
    return { data: toPolicyCard(data), error: null }
  },

  /** What a card reader asks: this tag just presented itself, who is it and
   *  is the card still good? An unknown or non-active tag resolves to
   *  nothing usable, which is the whole point of keeping lost cards on file. */
  async findByRfid(tag: string) {
    const { data, error } = await supabase
      .from('policy_cards').select(POLICY_CARD_SELECT).eq('rfid_tag', tag.trim()).maybeSingle()
    if (error) return { data: null, error: error.message }
    return { data: data ? toPolicyCard(data) : null, error: null }
  },

  async findByMemberNumber(memberNumber: string) {
    const { data, error } = await supabase
      .from('policy_cards').select(POLICY_CARD_SELECT).eq('member_number', memberNumber.trim().toUpperCase()).maybeSingle()
    if (error) return { data: null, error: error.message }
    return { data: data ? toPolicyCard(data) : null, error: null }
  },
}

// ── REALTIME ──────────────────────────────────────────────────────
export function subscribeToTable(table: string, callback: () => void) {
  const channel = supabase
    .channel(`rt:${table}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, callback)
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// ── EXPORT ────────────────────────────────────────────────────────
export const db = {
  policies, clients, products, claims, payments,
  tickets, emails, leads, staff, fraudCases, reminders, cautionFlags, settings, loginAttempts, developerApi,
  customRoles, claimAssessments, policyAssessments, insurers, photoHashes, cropTypes, fraudSignalRules, heroSlides,
  policyCards,
  dashboardStats, sidebarCounts,
  subscribeToTable,
}
