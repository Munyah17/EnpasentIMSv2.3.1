export interface Coordinates {
  lat: number
  lng: number
}

function attemptFix(options: PositionOptions): Promise<Coordinates | null> {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      options,
    )
  })
}

/** Wraps the browser Geolocation API in a promise. Resolves null (never
 *  throws) if permission is denied or the device has no GPS — coordinates
 *  are always optional on the assessment forms that use this.
 *
 *  GPS coordinates on this app are ALWAYS live-captured this way, never
 *  typed in manually — a cold satellite fix with no cellular assistance
 *  (a farm visit with poor/no network, exactly where this matters most)
 *  can genuinely take 20-30+ seconds, so a short timeout here reads as
 *  "no GPS available" when the device chip was actually still acquiring.
 *  Tries a high-accuracy fix first, then falls back to a faster
 *  lower-accuracy fix (still a real device reading) if that doesn't lock
 *  on — better than forcing the assessor to keep retapping the button. */
export async function getCurrentCoordinates(): Promise<Coordinates | null> {
  const precise = await attemptFix({ enableHighAccuracy: true, timeout: 30000, maximumAge: 0 })
  if (precise) return precise
  return attemptFix({ enableHighAccuracy: false, timeout: 15000, maximumAge: 0 })
}
