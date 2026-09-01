import type { MnoPartner, ApiKey, ApiLog, IntegrationEvent, UssdSession, ExternalTransaction } from '../../types/mno'
import { MNO_PARTNERS, API_KEYS, API_LOGS, INTEGRATION_EVENTS, USSD_SESSIONS, EXTERNAL_TRANSACTIONS } from '../../data/mnoData'

const PFX = 'tqfy_mno_'
const DATA_VERSION = 'v3-netone-only'

// Clear stale data if seeded with a previous version (removes Econet/Telecel)
function ensureFreshSeed() {
  if (localStorage.getItem('tqfy_mno_version') !== DATA_VERSION) {
    ['partners', 'apiKeys', 'apiLogs', 'events', 'ussdSessions', 'extTxns'].forEach(k => {
      localStorage.removeItem(PFX + k)
    })
    localStorage.setItem('tqfy_mno_version', DATA_VERSION)
  }
}
ensureFreshSeed()

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
  }
}

export const mnoStore = {
  partners:      makeStore<MnoPartner>('partners', MNO_PARTNERS),
  apiKeys:       makeStore<ApiKey>('apiKeys', API_KEYS),
  apiLogs:       makeStore<ApiLog>('apiLogs', API_LOGS),
  events:        makeStore<IntegrationEvent>('events', INTEGRATION_EVENTS),
  ussdSessions:  makeStore<UssdSession>('ussdSessions', USSD_SESSIONS),
  extTxns:       makeStore<ExternalTransaction>('extTxns', EXTERNAL_TRANSACTIONS),
}
