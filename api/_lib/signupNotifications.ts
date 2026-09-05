import type { SupabaseClient } from '@supabase/supabase-js'
import { sendViaAfrosoft, afrosoftAccepted, normalizeMsisdn, isValidMsisdn, BRAND_NAME } from './afrosoft.js'

/**
 * The server-side twin of src/lib/signupNotifications.ts, for clients and
 * policies created through the Developer API (api/v1/[...path].ts) --
 * concretely, every enpassentims-website signup.
 *
 * src/lib/signupNotifications.ts's own comment already claimed to cover
 * "an agent in the office, or a self-service checkout on the public site,"
 * but it lives under src/ and is only ever called from Clients.tsx,
 * Policies.tsx and OnlinePaymentModal.tsx -- all staff-browser code that
 * never runs for a Developer API request. A website signup got the policy
 * itself created correctly and silently NO welcome SMS or email, every
 * time, not intermittently -- a structural gap wearing the same symptom
 * ("auto SMS sometimes just doesn't happen") as the client-side reminder
 * engine's browser-must-stay-open problem, but with a different cause and
 * a 100% failure rate for this one channel specifically.
 *
 * Kept deliberately in sync in wording with src/lib/signupNotifications.ts
 * (duplicated rather than imported -- that file pulls in src/lib/db.ts,
 * which reads import.meta.env, a Vite build-time construct with no
 * equivalent in a Vercel Node function). If the message text changes there,
 * change it here too.
 *
 * Awaited by its caller, unlike the browser version: on Vercel, work
 * started after a function has already sent its response is not guaranteed
 * to finish (the invocation can be frozen the moment the response flushes),
 * so "fire and forget" here would just trade one unreliable trigger for
 * another. Every send inside is still individually best-effort and never
 * throws -- a slow or failed text must not fail the signup it describes.
 */

const ADMIN_ALERT_NUMBERS = [
  '+263780086175',
  '+263780086176',
  '+263780086177',
  '+263780086178',
]

function money(amount: number): string {
  return `$${(Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function text(to: string, message: string): Promise<void> {
  if (!isValidMsisdn(to)) return
  try {
    const res = await sendViaAfrosoft(normalizeMsisdn(to), message)
    if (!res.ok || !afrosoftAccepted(res.body)) console.error('signupNotifications: sms not accepted', to, res.status)
  } catch (e) { console.error('signupNotifications: sms failed', to, e) }
}

async function mail(origin: string, to: string, subject: string, body: string): Promise<void> {
  try {
    const res = await fetch(`${origin}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'noreply@enpassent.co.zw', fromName: BRAND_NAME, to, subject, text: body }),
    })
    if (!res.ok) console.error('signupNotifications: email not sent', to, res.status)
  } catch (e) { console.error('signupNotifications: email failed', to, e) }
}

interface ClientInfo { name: string; phone?: string | null; email?: string | null; nationalId?: string | null }

/** A client registered with no policy yet -- e.g. a Developer API partner
 *  that only calls POST /clients before deciding what to sell them. Worded
 *  as "registered", never "covered", same reasoning as the browser version. */
export async function notifyClientRegistered_(origin: string, client: ClientInfo): Promise<void> {
  const jobs: Promise<void>[] = []
  if (client.phone) {
    jobs.push(text(client.phone, `${BRAND_NAME}: Welcome ${client.name.split(' ')[0]}, your details are registered with us. An agent will be in touch to arrange cover.`))
  }
  if (client.email) {
    jobs.push(mail(origin, client.email, `Welcome to ${BRAND_NAME}`,
      `Dear ${client.name},\n\nYour details have been registered with ${BRAND_NAME}.\n\nName:        ${client.name}\nNational ID: ${client.nationalId || 'not given'}\nPhone:       ${client.phone || 'not given'}\n\nPlease note this registration does not itself put any cover in place. One of our agents will contact you to arrange a policy suited to you.`))
  }
  const alert = `${BRAND_NAME}: New client registered via the Developer API. ${client.name}, ${client.phone || 'no phone'}. No policy yet.`
  for (const number of ADMIN_ALERT_NUMBERS) jobs.push(text(number, alert))
  await Promise.all(jobs)
}

interface PolicyInfo {
  policyNumber: string; productName: string; coverAmount: number; premium: number
  category?: string; startDate: string; status: string; insurer?: string | null; paymentMethod: string
}

/** Period label matching src/lib/productUtils.ts's premiumPeriodLabel:
 *  agriculture is billed once a year, everything else monthly. */
function periodLabel(category?: string): string {
  return category === 'agriculture' ? '/year' : '/month'
}

export async function notifyPolicyRegistered_(
  admin: SupabaseClient, origin: string, policy: PolicyInfo, client: ClientInfo,
): Promise<void> {
  const cover = money(policy.coverAmount)
  const premium = `${money(policy.premium)}${periodLabel(policy.category)}`
  const jobs: Promise<void>[] = []

  if (client.phone) {
    const waiting = policy.status === 'waiting_period'
      ? ' Your waiting period has started; we will confirm when cover is active.'
      : ' Your cover is active.'
    jobs.push(text(client.phone,
      `${BRAND_NAME}: Welcome ${client.name.split(' ')[0]}. Policy ${policy.policyNumber} (${policy.productName}) is registered, cover ${cover}.${waiting}`))
  }

  if (client.email) {
    jobs.push(mail(origin, client.email, `Policy ${policy.policyNumber} registered: welcome to ${BRAND_NAME}`,
      `Dear ${client.name},\n\nThank you for choosing ${BRAND_NAME}. Your policy has been registered.\n\n`
      + `Policy Number:  ${policy.policyNumber}\nProduct:        ${policy.productName}${policy.insurer ? `\nInsurer:        ${policy.insurer}` : ''}\n`
      + `Cover Amount:   ${cover}\nPremium:        ${premium}\nStart Date:     ${policy.startDate}\nStatus:         ${policy.status.replace('_', ' ').toUpperCase()}\n\n`
      + `${policy.status === 'waiting_period' ? 'Your policy is in its waiting period. We will let you know as soon as cover becomes active.' : 'Your cover is active from the start date shown above.'}\n\n`
      + `Keep this email for your records. If any detail above is wrong, contact us and we will correct it.`))
  }

  const alert = `${BRAND_NAME}: New policy ${policy.policyNumber} registered via the Developer API. ${client.name}, ${policy.productName}, cover ${cover}, premium ${premium}. Contact ${client.phone || 'not given'}.`
  for (const number of ADMIN_ALERT_NUMBERS) jobs.push(text(number, alert))

  let insurerRecipient: string | undefined
  if (policy.insurer) {
    try {
      const { data } = await admin.from('insurers').select('contact_email').eq('name', policy.insurer).maybeSingle()
      if (data?.contact_email) insurerRecipient = data.contact_email as string
    } catch (e) { console.error('signupNotifications: insurer lookup failed', e) }
  }
  if (insurerRecipient) {
    jobs.push(mail(origin, insurerRecipient, `[New Policy] ${policy.policyNumber}: ${client.name}`,
      `A new policy has been registered.\n\nPolicy Number:  ${policy.policyNumber}\nClient:         ${client.name}\n`
      + `National ID:    ${client.nationalId || 'not given'}\nPhone:          ${client.phone || 'not given'}\nEmail:          ${client.email || 'not given'}\n`
      + `Product:        ${policy.productName}\nInsurer:        ${policy.insurer || 'not chosen yet'}\nCover Amount:   ${cover}\nPremium:        ${premium}\n`
      + `Start Date:     ${policy.startDate}\nStatus:         ${policy.status.replace('_', ' ').toUpperCase()}\nPayment Method: ${policy.paymentMethod}\n`
      + `Registered through the public website.`))
  }

  await Promise.all(jobs)
}
