import type { EmailMessage } from '../types'
import { db } from './db'

export interface NotifSettings {
  insurerName: string
  insurerEmail: string
  insurerPhone: string
  netoneEmail: string
  netonePhone: string
  fromAddress: string
  fromName: string
  /** Where replies to outgoing notification emails should land — the sending
   *  address is typically a noreply mailbox, so replies need somewhere real
   *  to go instead of bouncing or vanishing. */
  replyTo: string
  smsEnabled: boolean
  signature: string
  /** Receives an SMS at every claims-workflow stage transition (intake,
   *  assessment, final decision) — set once by Super Admin, on top of the
   *  client and whichever staff member is picking the claim up next. */
  superAdminPhone: string
  /** Shown in the Policy Report/Certificate PDF header (Head Office block)
   *  — confirmed real values, editable from Settings -> Notifications if
   *  the office ever moves. */
  companyAddress: string
  companyPhone: string
  companyEmail: string
}

export const DEFAULT_NOTIF_SETTINGS: NotifSettings = {
  // NOTE: a single global insurerName/insurerEmail cannot really represent a
  // broker that places business with almost every insurer in Zimbabwe --
  // whoever underwrites a given policy is on the policy itself
  // (Policy.insurer), not here. This pair is left in place because
  // Settings/BillingReminders still read it, but it should not be trusted as
  // "the" insurer for any one policy. Defaulted to Enpassent, the entity the
  // client actually deals with, rather than silently naming the house
  // insurer as if it were the only one.
  insurerName: 'Enpassent Multiple Agent',
  insurerEmail: 'info@enpassent.co.zw',
  insurerPhone: '+263242000000',
  // NetOne partnership is suspended for now — kept here (rather than
  // deleted) purely so Settings has something to show/restore; nothing
  // in the notification pipeline sends to it while suspended (see
  // NETONE_SUSPENDED in claimNotifications.ts and reminderEngine.ts).
  netoneEmail: 'insurance@netone.co.zw',
  netonePhone: '+263712001234',
  fromAddress: 'noreply@enpassent.co.zw',
  fromName: 'Enpassent Multiple Agent',
  replyTo: 'admin@enpassent.co.zw',
  smsEnabled: false,
  signature: 'Regards,\nEnpassent Multiple Agent',
  superAdminPhone: '',
  companyAddress: '24 Midlothian Avenue, Eastlea, Harare, Zimbabwe',
  companyPhone: '+263 780 086 175 / +263 780 086 176 / +263 780 086 177 / +263 780 086 178',
  companyEmail: 'info@enpassent.co.zw',
}

export function getNotifSettings(): NotifSettings {
  try {
    const raw = localStorage.getItem('tqfy_notif_settings')
    if (raw) return { ...DEFAULT_NOTIF_SETTINGS, ...JSON.parse(raw) }
  } catch { /**/ }
  return { ...DEFAULT_NOTIF_SETTINGS }
}

/** Writes through to the shared app_settings table (admin/super_admin only,
 *  enforced by RLS) as well as the local cache, so every staff browser
 *  converges on whatever a Super Admin configured instead of each browser
 *  quietly keeping its own copy. */
export function saveNotifSettings(settings: NotifSettings): void {
  try { localStorage.setItem('tqfy_notif_settings', JSON.stringify(settings)) } catch { /**/ }
  void db.settings.set('notif_settings', settings)
}

/** Call once at app startup: pulls the shared settings down into the local
 *  cache so getNotifSettings() (synchronous, used all over the app) reflects
 *  whatever was last saved by a Super Admin rather than this browser's own
 *  possibly-stale localStorage copy. */
export async function initNotifSettings(): Promise<void> {
  const remote = await db.settings.get<NotifSettings>('notif_settings')
  if (remote) {
    try { localStorage.setItem('tqfy_notif_settings', JSON.stringify({ ...DEFAULT_NOTIF_SETTINGS, ...remote })) } catch { /**/ }
  }
}

export interface SendEmailOptions {
  from?: string
  fromName?: string
  replyTo?: string
  to: string
  cc?: string
  subject: string
  body: string
  folder?: EmailMessage['folder']
  linkedTo?: string
  /** Base64 payload (no data: URI prefix) — e.g. from getPolicyReportPdfBase64(). */
  attachmentBase64?: string
  attachmentFilename?: string
}

export interface SendEmailResult {
  email: EmailMessage
  /** True only if the message was actually handed off to the email provider (not just recorded). */
  delivered: boolean
  error?: string
}

/**
 * Records the message (via the Supabase-backed db layer, so it shows up in
 * Sent/history) and attempts real delivery through the Netlify email proxy
 * (see netlify/functions/send-email.ts). If the proxy isn't deployed or
 * RESEND_API_KEY isn't configured, the message is still recorded but
 * `delivered` comes back false with an explanatory `error`.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const cfg = getNotifSettings()
  const from = opts.from ?? cfg.fromAddress
  const fromName = opts.fromName ?? cfg.fromName
  const replyTo = opts.replyTo ?? cfg.replyTo

  const { data: saved } = await db.emails.create({
    from, fromName, to: opts.to, cc: opts.cc, subject: opts.subject, body: opts.body,
    read: true, folder: opts.folder ?? 'sent', linkedTo: opts.linkedTo, starred: false, attachments: [],
  })
  const email: EmailMessage = saved ?? {
    id: `em-local-${Date.now()}`, from, fromName, to: opts.to, cc: opts.cc,
    subject: opts.subject, body: opts.body, timestamp: new Date().toISOString(),
    read: true, starred: false, folder: opts.folder ?? 'sent', linkedTo: opts.linkedTo, attachments: [],
  }

  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: opts.to, cc: opts.cc, subject: opts.subject, text: opts.body, from, fromName, replyTo,
        attachmentBase64: opts.attachmentBase64, attachmentFilename: opts.attachmentFilename,
      }),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      return { email, delivered: false, error: detail?.error ?? `Email service error (HTTP ${res.status})` }
    }
    const result = await res.json().catch(() => ({}))
    if (result?.simulated) {
      return { email, delivered: false, error: 'Email sending is not configured yet; message recorded but not actually sent.' }
    }
    return { email, delivered: true }
  } catch (e) {
    return { email, delivered: false, error: `Could not reach email service: ${e}` }
  }
}

export async function sendSystemEmail(opts: Omit<SendEmailOptions, 'folder'>): Promise<SendEmailResult> {
  return sendEmail({ ...opts, folder: 'sent' })
}
