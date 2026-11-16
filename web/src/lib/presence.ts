// "হাবে আছেন কিনা": the phone's location (on Wi-Fi or mobile data) against the hub's GPS, and whether the request
// comes from the hub's saved Wi-Fi. Information for the manager only — it never blocks anything.
import { supabase } from './supabase'
import { HrError } from './hr'

export type PlaceStatus = 'at_hub' | 'near' | 'far' | 'no_gps' | 'hub_no_gps'
export type Presence = { hub_id: string; hub_name: string; distance_m: number | null; status: PlaceStatus; radius_m: number
  accuracy_m: number | null; wifi: boolean; hub_has_gps: boolean; hub_has_wifi: boolean }
export type HubPlace = { hub_id: string; latitude: number | null; longitude: number | null; radius_m: number; wifi_count: number
  on_hub_wifi: boolean; have_ip: boolean; can_edit_gps: boolean }
export type Fix = { lat: number; lng: number; accuracy: number }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

/** The phone's location, or null when it is off, refused or slow. Never throws. */
export function getFix(timeout = 12000): Promise<Fix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise(res => {
    const done = (v: Fix | null) => { clearTimeout(t); res(v) }
    const t = setTimeout(() => res(null), timeout + 1000)
    navigator.geolocation.getCurrentPosition(
      p => done({ lat: +p.coords.latitude.toFixed(7), lng: +p.coords.longitude.toFixed(7), accuracy: Math.round(p.coords.accuracy) }),
      () => done(null), { enableHighAccuracy: true, timeout, maximumAge: 60000 })
  })
}

export const distText = (m: number | null | undefined, L: (bn: string, en: string) => string, n: (x: number) => string) =>
  m == null ? '' : m < 1000 ? L(`${n(m)} মিটার`, `${m} m`) : L(`${n(Math.round(m / 100) / 10)} কিমি`, `${Math.round(m / 100) / 10} km`)

/** Words and colour for a place verdict. */
export const PLACE: Record<PlaceStatus, [bn: string, en: string, tone: 'ok' | 'warn' | 'bad' | 'neutral']> = {
  at_hub: ['হাবে আছেন', 'At the hub', 'ok'], near: ['হাবের কাছে', 'Near the hub', 'warn'], far: ['হাব থেকে দূরে', 'Far from the hub', 'bad'],
  no_gps: ['লোকেশন দেননি', 'No location given', 'neutral'], hub_no_gps: ['হাবের লোকেশন সেট নেই', 'Hub has no GPS', 'neutral'],
}

export const presence = {
  check: (f: Fix | null) => rpc<Presence | null>('hub_presence_check', { p_lat: f?.lat ?? null, p_lng: f?.lng ?? null, p_accuracy: f?.accuracy ?? null }),
  hubInfo: (hub: string) => rpc<HubPlace>('hub_place_info', { p_hub: hub }),
  wifi: (hub: string, action: 'add' | 'clear') => rpc<HubPlace>('hub_place_save', { p_hub: hub, p_wifi: action }),
  setGps: (hub: string, f: Fix | null, radius: number | null) =>
    rpc<HubPlace>('hub_place_save', { p_hub: hub, p_lat: f?.lat ?? null, p_lng: f?.lng ?? null, p_radius: radius }),
}
