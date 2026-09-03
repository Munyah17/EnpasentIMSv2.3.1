/**
 * USSD Interaction Mapping Layer
 *
 * Translates USSD menu flows → API calls → DB actions.
 *
 * Endpoint: POST /api/v1/mno/ussd/action
 * Request:  { sessionId, msisdn, input, serviceCode, networkCode, partnerCode }
 * Response: { text: "CON ..." } — session continues
 *           { text: "END ..." } — session terminates
 *
 * CON = Continue (show input prompt again)
 * END = End session
 */
import type { UssdActionPayload, UssdSession, ApiGatewayResponse } from '../../types/mno'
import { localStore } from '../localStore'
import { generatePolicyNumber } from '../originTag'
import { mnoStore } from './mnoStore'
import { runGatewayAuth, okResponse, logApiRequest } from './gateway'
import { emitEvent } from './webhooks'

function uid() { return `loc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }
function shortDate() { return new Date().toISOString().split('T')[0] }
function now() { return new Date().toISOString() }

// ── Menu Text Templates ────────────────────────────────────────────────
const MENUS = {
  MAIN: (name?: string) =>
    `CON Welcome to Enpasent Multiple Agent${name ? `, ${name}` : ''}\n1. Buy Insurance\n2. My Policies\n3. Pay Premium\n4. File a Claim\n5. Check Claim Status\n0. Exit`,

  PRODUCTS: (products: Array<{ name: string; premium: number }>) => {
    const lines = products.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} - $${p.premium}/mo`)
    return `CON Select Insurance:\n${lines.join('\n')}\n0. Back`
  },

  CONFIRM_REGISTER: (name: string, product: string, premium: number) =>
    `CON Confirm Registration:\nName: ${name}\nProduct: ${product}\nPremium: $${premium}/month\n\n1. Confirm\n2. Cancel`,

  MY_POLICIES: (policies: Array<{ policyNumber: string; productName: string; status: string; premium: number }>) => {
    if (!policies.length) return 'END No active policies found for your number.'
    const lines = policies.slice(0, 4).map((p, i) => `${i + 1}. ${p.policyNumber} - ${p.productName} ($${p.premium}/mo) [${p.status}]`)
    return `CON Your Policies:\n${lines.join('\n')}\n0. Back`
  },

  PAY_POLICY: (policies: Array<{ policyNumber: string; premium: number; nextPaymentDate?: string | null }>) => {
    const lines = policies.slice(0, 4).map((p, i) => `${i + 1}. ${p.policyNumber} - $${p.premium} due ${p.nextPaymentDate ?? 'now'}`)
    return `CON Select policy to pay:\n${lines.join('\n')}\n0. Back`
  },

  CONFIRM_PAY: (policyNumber: string, amount: number) =>
    `CON Confirm Payment\nPolicy: ${policyNumber}\nAmount: $${amount}\n\n1. Pay via OneMoney\n2. Cancel`,

  CLAIM_TYPES: () =>
    `CON Select Claim Type:\n1. Death Claim\n2. Accident/Injury\n3. Motor Damage\n4. Hospitalisation\n5. Property Loss\n0. Back`,

  CLAIM_CONFIRM: (claimType: string, policyNumber: string) =>
    `CON File ${claimType} Claim\nPolicy: ${policyNumber}\n\n1. Confirm & Submit\n2. Cancel`,
}

// ── Context (in-memory session state, beyond what's stored) ──────────
const SESSION_CTX = new Map<string, {
  step: string
  products?: Array<{ id: string; name: string; premium: number; coverAmount: number }>
  selectedProductIdx?: number
  nationalId?: string
  clientId?: string
  policies?: Array<{ id: string; policyNumber: string; productName: string; premium: number; status: string; nextPaymentDate?: string | null; clientId: string }>
  selectedPolicyIdx?: number
  claimType?: string
}>()

// ── Main Handler ──────────────────────────────────────────────────────
export async function handleUssdAction(
  keyPrefix: string,
  ip: string,
  payload: UssdActionPayload,
): Promise<ApiGatewayResponse> {
  const start = Date.now()
  const auth = runGatewayAuth(keyPrefix, ip, 'ussd:interact')
  if (!auth.ok) return auth.response
  const { ctx } = auth

  const sessions = mnoStore.ussdSessions.list()
  let session = sessions.find(s => s.sessionId === payload.sessionId && s.status === 'active')

  // New session
  if (!session) {
    session = mnoStore.ussdSessions.create({
      id: uid(),
      sessionId: payload.sessionId,
      msisdn: payload.msisdn,
      partnerId: ctx.partnerId,
      partnerName: ctx.apiKey.partnerName,
      currentStep: 0,
      currentMenu: 'MAIN',
      flowType: undefined,
      steps: [],
      status: 'active',
      startedAt: now(),
      updatedAt: now(),
    })
    SESSION_CTX.set(payload.sessionId, { step: 'MAIN' })
    await emitEvent('ussd.session.started', ctx.partnerId, { sessionId: payload.sessionId, msisdn: payload.msisdn })

    const text = MENUS.MAIN()
    logUssd(ctx, payload, start, text)
    return okResponse({ text }, ctx.requestId)
  }

  const sctx = SESSION_CTX.get(payload.sessionId) ?? { step: 'MAIN' }
  const input = payload.input.trim()
  let responseText = 'END An error occurred. Please try again.'

  // ── MAIN MENU ────────────────────────────────────────────────────────
  if (sctx.step === 'MAIN') {
    if (input === '0') { responseText = 'END Thank you for using Enpasent Multiple Agent. Goodbye!'; endSession(session, 'cancelled') }
    else if (input === '1') {
      sctx.step = 'PRODUCTS'
      const prods = localStore.products.list().filter(p => p.active)
      sctx.products = prods
      responseText = MENUS.PRODUCTS(prods)
      updateSession(session, 'PRODUCTS', input, 'register')
    } else if (input === '2') {
      sctx.step = 'MY_POLICIES_SHOW'
      const client = findClientByMsisdn(payload.msisdn)
      if (!client) { responseText = 'END No account found for this number. Dial *233*1# to register.'; endSession(session, 'completed') }
      else {
        const pols = localStore.policies.list().filter(p => p.clientId === client.id)
        sctx.policies = pols
        sctx.clientId = client.id
        responseText = MENUS.MY_POLICIES(pols)
        updateSession(session, 'MY_POLICIES_SHOW', input, 'check_policy')
      }
    } else if (input === '3') {
      sctx.step = 'PAY_SELECT'
      const client = findClientByMsisdn(payload.msisdn)
      if (!client) { responseText = 'END No account found for this number.'; endSession(session, 'completed') }
      else {
        const pols = localStore.policies.list().filter(p => p.clientId === client.id && p.status === 'active')
        sctx.policies = pols
        responseText = pols.length ? MENUS.PAY_POLICY(pols) : 'END No active policies to pay. Dial *233*1# to buy insurance.'
        if (!pols.length) endSession(session, 'completed')
        else updateSession(session, 'PAY_SELECT', input, 'pay_premium')
      }
    } else if (input === '4') {
      sctx.step = 'CLAIM_ID'
      responseText = 'CON Enter your Policy Number:\n(e.g. POL2024001234)\n0. Back'
      updateSession(session, 'CLAIM_ID', input, 'claim')
    } else if (input === '5') {
      sctx.step = 'CLAIM_STATUS_NO'
      responseText = 'CON Enter your Claim Number:\n(e.g. CLM2024123456)\n0. Back'
      updateSession(session, 'CLAIM_STATUS_NO', input, 'enquiry')
    } else {
      responseText = MENUS.MAIN()
    }

  // ── PRODUCT SELECTION ────────────────────────────────────────────────
  } else if (sctx.step === 'PRODUCTS') {
    if (input === '0') { sctx.step = 'MAIN'; responseText = MENUS.MAIN() }
    else {
      const idx = parseInt(input) - 1
      const prod = sctx.products?.[idx]
      if (!prod) { responseText = MENUS.PRODUCTS(sctx.products ?? []) }
      else {
        sctx.selectedProductIdx = idx
        sctx.step = 'REGISTER_ID'
        responseText = `CON You selected: ${prod.name} - $${prod.premium}/month\n\nPlease enter your National ID Number:\n(e.g. 12345678A90)\n0. Back`
        updateSession(session, 'REGISTER_ID', input)
      }
    }

  // ── REGISTRATION: NATIONAL ID ────────────────────────────────────────
  } else if (sctx.step === 'REGISTER_ID') {
    if (input === '0') { sctx.step = 'PRODUCTS'; responseText = MENUS.PRODUCTS(sctx.products ?? []) }
    else if (input.length < 6) { responseText = 'CON Invalid ID format. Enter your National ID:\n(e.g. 12345678A90)\n0. Back' }
    else {
      sctx.nationalId = input
      sctx.step = 'REGISTER_CONFIRM'
      const prod = sctx.products?.[sctx.selectedProductIdx ?? 0]
      const client = findClientByMsisdn(payload.msisdn)
      const name = client?.name ?? 'Customer'
      responseText = MENUS.CONFIRM_REGISTER(name, prod?.name ?? 'Insurance', prod?.premium ?? 0)
      updateSession(session, 'REGISTER_CONFIRM', input)
    }

  // ── REGISTRATION: CONFIRM ────────────────────────────────────────────
  } else if (sctx.step === 'REGISTER_CONFIRM') {
    if (input === '2' || input === '0') { responseText = 'END Registration cancelled.'; endSession(session, 'cancelled') }
    else if (input === '1') {
      const prod = sctx.products?.[sctx.selectedProductIdx ?? 0]
      let client = findClientByMsisdn(payload.msisdn)
      if (!client) {
        client = localStore.clients.create({
          id: uid(), name: `Customer ${payload.msisdn.slice(-4)}`,
          email: `${payload.msisdn.replace('+', '')}@mno.zw`,
          phone: payload.msisdn, nationalId: sctx.nationalId ?? 'UNKNOWN',
          dob: '', address: 'Zimbabwe', occupation: 'Unknown',
          createdAt: shortDate(), policyCount: 0, status: 'active',
        })
      }
      if (prod) {
        const policyNumber = generatePolicyNumber()
        const policy = localStore.policies.create({
          id: uid(), policyNumber, clientId: client.id, clientName: client.name,
          productId: prod.id, productName: prod.name, premium: prod.premium,
          coverAmount: prod.coverAmount, startDate: shortDate(),
          endDate: `${new Date().getFullYear() + 1}-${shortDate().slice(5)}`,
          status: 'active', dependants: [], paymentMethod: 'OneMoney',
          createdAt: shortDate(),
        })
        mnoStore.ussdSessions.update(session.id, { policyId: policy.id, customerId: client.id, outcome: `Policy ${policyNumber} created` })
        await emitEvent('policy.created', ctx.partnerId, { policyNumber, msisdn: payload.msisdn, productName: prod.name, premium: prod.premium })
        responseText = `END Registration Successful!\nPolicy: ${policyNumber}\nProduct: ${prod.name}\nPremium: $${prod.premium}/month\nStatus: ACTIVE\n\nWelcome to Enpasent Multiple Agent!`
      } else {
        responseText = 'END Error: Product not found. Please try again.'
      }
      endSession(session, 'completed')
    } else {
      const prod = sctx.products?.[sctx.selectedProductIdx ?? 0]
      const client = findClientByMsisdn(payload.msisdn)
      responseText = MENUS.CONFIRM_REGISTER(client?.name ?? 'Customer', prod?.name ?? 'Insurance', prod?.premium ?? 0)
    }

  // ── PAY: SELECT POLICY ───────────────────────────────────────────────
  } else if (sctx.step === 'PAY_SELECT') {
    if (input === '0') { sctx.step = 'MAIN'; responseText = MENUS.MAIN() }
    else {
      const idx = parseInt(input) - 1
      const pol = sctx.policies?.[idx]
      if (!pol) { responseText = MENUS.PAY_POLICY(sctx.policies ?? []) }
      else {
        sctx.selectedPolicyIdx = idx
        sctx.step = 'PAY_CONFIRM'
        responseText = MENUS.CONFIRM_PAY(pol.policyNumber, pol.premium)
        updateSession(session, 'PAY_CONFIRM', input)
      }
    }

  // ── PAY: CONFIRM ─────────────────────────────────────────────────────
  } else if (sctx.step === 'PAY_CONFIRM') {
    if (input === '2' || input === '0') { responseText = 'END Payment cancelled.'; endSession(session, 'cancelled') }
    else if (input === '1') {
      const pol = sctx.policies?.[sctx.selectedPolicyIdx ?? 0]
      if (pol) {
        const txRef = `TXN${Math.random().toString(36).slice(2, 10).toUpperCase()}`
        localStore.payments.create({
          id: uid(), reference: txRef,
          policyId: pol.id, policyNumber: pol.policyNumber,
          clientName: '',
          amount: pol.premium, method: 'OneMoney',
          status: 'completed', date: shortDate(),
        })
        await emitEvent('payment.received', ctx.partnerId, { transactionRef: txRef, policyNumber: pol.policyNumber, amount: pol.premium })
        responseText = `END Payment Confirmed!\nRef: ${txRef}\nPolicy: ${pol.policyNumber}\nAmount: $${pol.premium}\nPaid via OneMoney\n\nThank you!`
        mnoStore.ussdSessions.update(session.id, { outcome: `Payment $${pol.premium} for ${pol.policyNumber}` })
      } else { responseText = 'END Error processing payment. Please call 0800 EAZYBET.' }
      endSession(session, 'completed')
    }

  // ── CLAIM: ENTER POLICY NUMBER ───────────────────────────────────────
  } else if (sctx.step === 'CLAIM_ID') {
    if (input === '0') { sctx.step = 'MAIN'; responseText = MENUS.MAIN() }
    else {
      const pol = localStore.policies.list().find(p => p.policyNumber === input)
      if (!pol) { responseText = `CON Policy "${input}" not found.\nPlease check and re-enter:\n0. Back` }
      else {
        sctx.policies = [pol]
        sctx.step = 'CLAIM_TYPE'
        responseText = MENUS.CLAIM_TYPES()
        updateSession(session, 'CLAIM_TYPE', input)
      }
    }

  // ── CLAIM: TYPE SELECTION ────────────────────────────────────────────
  } else if (sctx.step === 'CLAIM_TYPE') {
    if (input === '0') { sctx.step = 'MAIN'; responseText = MENUS.MAIN() }
    else {
      const types = ['Death', 'Accident/Injury', 'Motor Damage', 'Hospitalisation', 'Property Loss']
      const ct = types[parseInt(input) - 1]
      if (!ct) { responseText = MENUS.CLAIM_TYPES() }
      else {
        sctx.claimType = ct
        sctx.step = 'CLAIM_CONFIRM'
        const pol = sctx.policies?.[0]
        responseText = MENUS.CLAIM_CONFIRM(ct, pol?.policyNumber ?? '')
        updateSession(session, 'CLAIM_CONFIRM', input)
      }
    }

  // ── CLAIM: CONFIRM ───────────────────────────────────────────────────
  } else if (sctx.step === 'CLAIM_CONFIRM') {
    if (input === '2' || input === '0') { responseText = 'END Claim cancelled.'; endSession(session, 'cancelled') }
    else if (input === '1') {
      const pol = sctx.policies?.[0]
      if (pol) {
        const claimNumber = `CLM${new Date().getFullYear()}${Math.floor(Math.random() * 900000 + 100000)}`
        localStore.claims.create({
          id: uid(), claimNumber, policyId: pol.id, policyNumber: pol.policyNumber,
          clientId: pol.clientId, clientName: '',
          productName: pol.productName,
          claimType: sctx.claimType ?? 'General', amount: 0, status: 'pending', stage: 'intake',
          dateOfEvent: shortDate(), dateSubmitted: shortDate(),
          description: `${sctx.claimType} claim, submitted via USSD`,
          fraudScore: Math.floor(Math.random() * 25),
          documents: [],
          notes: `Submitted via MNO USSD (${ctx.apiKey.partnerName})`,
        })
        await emitEvent('claim.initiated', ctx.partnerId, { claimNumber, policyNumber: pol.policyNumber, claimType: sctx.claimType })
        responseText = `END Claim Submitted!\nRef: ${claimNumber}\nType: ${sctx.claimType}\nPolicy: ${pol.policyNumber}\nStatus: Under Review\n\nExpected resolution: 7 days`
        mnoStore.ussdSessions.update(session.id, { outcome: `Claim ${claimNumber} submitted` })
      } else { responseText = 'END Error submitting claim. Please call 0800 EAZYBET.' }
      endSession(session, 'completed')
    }

  // ── CLAIM STATUS ─────────────────────────────────────────────────────
  } else if (sctx.step === 'CLAIM_STATUS_NO') {
    if (input === '0') { sctx.step = 'MAIN'; responseText = MENUS.MAIN() }
    else {
      const claim = localStore.claims.list().find(c => c.claimNumber === input)
      if (!claim) { responseText = `CON Claim "${input}" not found.\nEnter Claim Number:\n0. Back` }
      else {
        responseText = `END Claim: ${claim.claimNumber}\nType: ${claim.claimType}\nStatus: ${claim.status.toUpperCase()}\nSubmitted: ${claim.dateSubmitted}\n${claim.resolvedAt ? `Resolved: ${claim.resolvedAt}` : 'Expected: Within 7 days'}`
        endSession(session, 'completed')
      }
    }
  }

  SESSION_CTX.set(payload.sessionId, sctx)

  logUssd(ctx, payload, start, responseText)
  return okResponse({ text: responseText }, ctx.requestId)
}

// ── Helpers ───────────────────────────────────────────────────────────
function findClientByMsisdn(msisdn: string) {
  return localStore.clients.list().find(c => c.phone === msisdn || c.phone === msisdn.replace('+263', '0'))
}

function updateSession(
  session: UssdSession,
  menu: string,
  input: string,
  flowType?: UssdSession['flowType'],
) {
  mnoStore.ussdSessions.update(session.id, {
    currentMenu: menu,
    currentStep: session.currentStep + 1,
    updatedAt: now(),
    flowType: flowType ?? session.flowType,
    steps: [
      ...session.steps,
      { step: session.currentStep + 1, input, menuShown: menu, ts: now() },
    ],
  })
}

function endSession(session: UssdSession, status: 'completed' | 'cancelled' | 'timeout') {
  mnoStore.ussdSessions.update(session.id, { status, completedAt: now(), updatedAt: now() })
}

function logUssd(
  ctx: { partnerId: string; apiKey: { partnerName: string }; requestId: string },
  payload: UssdActionPayload,
  start: number,
  responseText: string,
) {
  logApiRequest({
    ts: Date.now(), method: 'POST', endpoint: '/api/v1/mno/ussd/action',
    direction: 'inbound', partnerId: ctx.partnerId, partnerName: ctx.apiKey.partnerName,
    statusCode: 200, duration: Date.now() - start, success: true,
    requestSize: JSON.stringify(payload).length, responseSize: responseText.length,
    requestId: ctx.requestId,
  })
}

// ── Simulate a full USSD registration flow (for demo) ────────────────
export async function simulateUssdRegistration(
  keyPrefix: string,
  partnerId: string,
  msisdn: string,
): Promise<string[]> {
  const ip = partnerId === 'mno-001' ? '196.43.113.10' : '196.43.112.44'
  const sessionId = `SIM${Date.now().toString(36).toUpperCase()}`
  const responses: string[] = []

  const base: Omit<UssdActionPayload, 'input'> = {
    sessionId, msisdn, serviceCode: '*233#', networkCode: partnerId, partnerCode: partnerId,
  }

  const steps = ['', '1', '1', '12345678A90', '1']
  for (const input of steps) {
    const res = await handleUssdAction(keyPrefix, ip, { ...base, input })
    if (res.data) responses.push((res.data as { text: string }).text)
    await new Promise(r => setTimeout(r, 100))
  }
  return responses
}
