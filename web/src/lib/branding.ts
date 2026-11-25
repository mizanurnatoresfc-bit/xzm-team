// The name, mark, colour and pictures of this system. Anyone may read them, even
// before signing in; only someone with system.settings.configure may change them.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Branding = {
  company_name: string
  name_bn: string
  short_name: string
  tagline: { bn: string; en: string }
  /** Data URLs. Always rendered through an <img>, never injected as markup. */
  logo: string | null
  favicon: string | null
  theme: { primary: string; primaryDark: string }
  system_title: string
}

export const DEFAULT_BRANDING: Branding = {
  company_name: 'XZM TEAM', name_bn: 'XZM TEAM', short_name: 'X',
  tagline: { bn: 'নিজের কাজের জন্য নিজের টুল', en: 'My own tool for my own work' },
  logo: null, favicon: null,
  theme: { primary: '#15803D', primaryDark: '#14532D' },
  system_title: 'XZM TEAM',
}

const cleanPicture = (v: unknown): string | null =>
  typeof v === 'string' && /^data:image\/(svg\+xml|png|jpeg|webp)[,;]/.test(v) && v.length <= 262144 ? v : null

function shape(raw: Record<string, unknown> | null): Branding {
  const d = DEFAULT_BRANDING
  if (!raw) return d
  const text = (k: keyof Branding, fallback: string) => typeof raw[k] === 'string' && (raw[k] as string).trim() ? (raw[k] as string).trim() : fallback
  const tag = raw.tagline as { bn?: string; en?: string } | undefined
  const th = raw.theme as { primary?: string; primaryDark?: string } | undefined
  const colour = (v: string | undefined, fallback: string) => v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback
  return {
    company_name: text('company_name', d.company_name),
    name_bn: text('name_bn', text('company_name', d.name_bn)),
    short_name: text('short_name', d.short_name).slice(0, 3),
    tagline: { bn: tag?.bn?.trim() || d.tagline.bn, en: tag?.en?.trim() || d.tagline.en },
    logo: cleanPicture(raw.logo),
    favicon: cleanPicture(raw.favicon) ?? cleanPicture(raw.logo),
    theme: { primary: colour(th?.primary, d.theme.primary), primaryDark: colour(th?.primaryDark, d.theme.primaryDark) },
    system_title: text('system_title', text('company_name', d.system_title)),
  }
}

export async function loadBranding(): Promise<Branding> {
  const { data, error } = await supabase.rpc('branding')
  if (error) throw new Error(error.message)
  return shape(data as Record<string, unknown> | null)
}

export async function saveBranding(values: Partial<Record<string, unknown>>) {
  const { error } = await supabase.rpc('branding_save', { p_values: values })
  if (error) throw new Error(error.message)
}

/** Puts the branding on the page itself: tab title, tab icon and the main colour. */
export function applyBranding(b: Branding) {
  if (typeof document === 'undefined') return
  document.title = b.system_title
  const root = document.documentElement
  // The brand colour feeds --primary in light mode only (theme.css). Setting --primary itself inline would beat the
  // dark-mode palette and leave dark-green text on dark backgrounds.
  root.style.removeProperty('--primary'); root.style.removeProperty('--primary-dark')
  root.style.setProperty('--brand-primary', b.theme.primary)
  root.style.setProperty('--brand-primary-dark', b.theme.primaryDark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', b.theme.primary)
  const icon = b.favicon ?? b.logo
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
  if (icon) { link.type = icon.startsWith('data:image/svg') ? 'image/svg+xml' : 'image/png'; link.href = icon }
}

/** Read once per page load, then shared by every part of the screen. */
let cached: Branding | null = null
let inFlight: Promise<Branding> | null = null
const listeners = new Set<(b: Branding) => void>()

export function useBranding(): Branding {
  const [b, setB] = useState<Branding>(cached ?? DEFAULT_BRANDING)
  useEffect(() => {
    listeners.add(setB)
    if (cached) { setB(cached); applyBranding(cached) }
    else {
      inFlight = inFlight ?? loadBranding().catch(() => DEFAULT_BRANDING)
      void inFlight.then(v => { cached = v; applyBranding(v); listeners.forEach(f => f(v)) })
    }
    return () => { listeners.delete(setB) }
  }, [])
  return b
}

/** After a save, so the name and mark change everywhere at once. */
export function forgetBranding(next?: Branding) {
  cached = next ?? null
  inFlight = next ? Promise.resolve(next) : null
  if (next) { applyBranding(next); listeners.forEach(f => f(next)) }
}

const BN: Array<[RegExp, string]> = [
  [/not allowed to change the branding/i, 'ব্র্যান্ডিং বদলানোর অনুমতি আপনার নেই'],
  [/can run, so it cannot be used/i, 'এই ছবির ভেতরে এমন কিছু আছে যা চলতে পারে — এটি ব্যবহার করা যাবে না'],
  [/too large/i, 'ছবিটি অনেক বড় — ২৫৬ কিলোবাইটের মধ্যে রাখুন'],
  [/Only an SVG, PNG/i, 'শুধু SVG, PNG, JPEG বা WebP ছবি দেওয়া যাবে'],
  [/Unknown branding setting/i, 'এই নামের কোনো সেটিং নেই'],
  [/permission denied|42501/i, 'এই কাজের অনুমতি আপনার নেই'],
]
export function brandingFriendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const hit = BN.find(([re]) => re.test(msg))
  return hit ? `${hit[1]}। (${msg})` : msg
}
