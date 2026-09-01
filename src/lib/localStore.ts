import type {
  AppUser, Client, Product, Policy, Claim, Payment,
  Ticket, EmailMessage, Lead, FraudCase, Reminder,
} from '../types'
import {
  USERS, CLIENTS, PRODUCTS, POLICIES, CLAIMS,
  PAYMENTS, TICKETS, EMAILS, LEADS, FRAUD_CASES, REMINDERS,
} from '../data/mockData'

const PFX = 'tqfy_'

function load<T>(key: string, seed: T[]): T[] {
  try {
    const raw = localStorage.getItem(PFX + key)
    if (raw) return JSON.parse(raw) as T[]
  } catch { /**/ }
  const copy = structuredClone(seed)
  try { localStorage.setItem(PFX + key, JSON.stringify(copy)) } catch { /**/ }
  return copy
}

function save<T>(key: string, data: T[]): void {
  try { localStorage.setItem(PFX + key, JSON.stringify(data)) } catch { /**/ }
}

function makeStore<T extends { id: string }>(key: string, seed: T[]) {
  return {
    list: (): T[] => load<T>(key, seed),

    create: (item: T): T => {
      const rows = load<T>(key, seed)
      rows.unshift(item)
      save(key, rows)
      return item
    },

    update: (id: string, patch: Partial<T>): T | null => {
      const rows = load<T>(key, seed)
      const i = rows.findIndex(r => r.id === id)
      if (i === -1) return null
      rows[i] = { ...rows[i], ...patch }
      save(key, rows)
      return rows[i]
    },

    delete: (id: string): void => {
      save(key, load<T>(key, seed).filter(r => r.id !== id))
    },

    upsert: (item: T): T => {
      const rows = load<T>(key, seed)
      const i = rows.findIndex(r => r.id === item.id)
      if (i === -1) rows.unshift(item)
      else rows[i] = item
      save(key, rows)
      return item
    },
  }
}

const STAFF_SEED = USERS.filter(u => u.role !== 'policyholder')

export const localStore = {
  policies:   makeStore<Policy>('policies', POLICIES),
  clients:    makeStore<Client>('clients', CLIENTS),
  products:   makeStore<Product>('products', PRODUCTS),
  claims:     makeStore<Claim>('claims', CLAIMS),
  payments:   makeStore<Payment>('payments', PAYMENTS),
  tickets:    makeStore<Ticket>('tickets', TICKETS),
  emails:     makeStore<EmailMessage>('emails', EMAILS),
  leads:      makeStore<Lead>('leads', LEADS),
  staff:      makeStore<AppUser>('staff', STAFF_SEED),
  fraudCases: makeStore<FraudCase>('fraudCases', FRAUD_CASES),
  reminders:  makeStore<Reminder>('reminders', REMINDERS),

  reset(): void {
    Object.keys(localStorage)
      .filter(k => k.startsWith(PFX))
      .forEach(k => localStorage.removeItem(k))
  },
}
