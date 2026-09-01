/**
 * A genuine read-through cache of real server data, for screens that must
 * keep working with real records (not fake demo data) while offline — e.g.
 * an assessor's policy list on a farm visit with no signal. Deliberately
 * separate from localStore.ts, which seeds itself from static mock data:
 * mixing the two would mean an assessor offline could be shown a fake
 * demo policy and unknowingly record a real site visit against it.
 *
 * Only ever populated from a genuine successful server fetch (see callers
 * in db.ts) — never from mock data, and never treated as writable/synced.
 */

const PFX = 'tqfy_cache_'

export function cacheSet<T>(key: string, data: T[]): void {
  try { localStorage.setItem(PFX + key, JSON.stringify({ data, cachedAt: Date.now() })) } catch { /* storage full — best effort */ }
}

export function cacheGet<T>(key: string): { data: T[]; cachedAt: number } | null {
  try {
    const raw = localStorage.getItem(PFX + key)
    if (!raw) return null
    return JSON.parse(raw) as { data: T[]; cachedAt: number }
  } catch {
    return null
  }
}
