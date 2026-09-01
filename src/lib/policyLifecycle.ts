import type { Policy } from '../types'

/**
 * When a policy actually starts: capture date (today, when staff register
 * it) is not the same as the billing start date. Registering before the
 * 10th of the month starts cover on the 1st of THIS month; on/after the
 * 10th starts it on the 1st of NEXT month, so every policy's billing cycle
 * aligns to the 1st regardless of when it was written up. Super Admin/Admin
 * can still override this manually (see NewPolicyModal).
 */
export function computeAssignedStartDate(registrationDate: Date = new Date()): string {
  const day = registrationDate.getDate()
  const year = registrationDate.getFullYear()
  const month = registrationDate.getMonth()
  const assigned = day < 10 ? new Date(year, month, 1) : new Date(year, month + 1, 1)
  return assigned.toISOString().split('T')[0]
}

export type PaymentCurrencyStatus = 'current' | 'arrears' | 'prepaid'

/** Derived purely from nextPaymentDate vs today — no separate stored field.
 *  More than ~10 days past due counts as arrears (matches the reminder
 *  engine's own R4/caution-flag threshold); more than one cycle ahead
 *  counts as prepaid (covers the "pay several months/years in advance"
 *  case from the multi-period Pay Online option). */
export function paymentCurrencyStatus(policy: Policy): PaymentCurrencyStatus {
  if (!policy.nextPaymentDate) return 'current'
  const diffDays = (new Date(policy.nextPaymentDate).getTime() - Date.now()) / 86400000
  if (diffDays < 0) return 'arrears'
  if (diffDays > 40) return 'prepaid'
  return 'current'
}

export const PAYMENT_CURRENCY_LABEL: Record<PaymentCurrencyStatus, string> = {
  current: 'Up to Date',
  arrears: 'In Arrears',
  prepaid: 'Prepaid',
}

export const PAYMENT_CURRENCY_CLASS: Record<PaymentCurrencyStatus, string> = {
  current: 'pill-active',
  arrears: 'pill-lapsed',
  prepaid: 'pill-caution',
}
