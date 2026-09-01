/**
 * Best-effort reverse geocoding (GPS coordinates -> a human place name) via
 * OpenStreetMap's free Nominatim API — no API key required. Never throws;
 * callers get the raw coordinates regardless of whether this succeeds.
 */

const CACHE_KEY = 'tqfy_geocode_cache'
const cacheKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`

function readCache(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') } catch { return {} }
}

function writeCache(cache: Record<string, string>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch { /**/ }
}

/** Resolves to a short place label (e.g. "Chegutu, Mashonaland West") or null if unavailable. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = cacheKey(lat, lng)
  const cache = readCache()
  if (key in cache) return cache[key] || null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' }, signal: controller.signal },
    )
    clearTimeout(timeout)
    if (!res.ok) return null
    const data = await res.json() as { address?: Record<string, string> }
    const addr = data.address ?? {}
    const place = addr.village || addr.town || addr.city || addr.suburb || addr.hamlet || addr.county
    const region = addr.state || addr.region
    const label = [place, region].filter(Boolean).join(', ') || null

    cache[key] = label ?? ''
    writeCache(cache)
    return label
  } catch {
    return null
  }
}
