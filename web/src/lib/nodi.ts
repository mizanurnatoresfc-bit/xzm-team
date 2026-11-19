import { supabase } from './supabase'

/** নদী AI. The Anthropic key lives only in the Edge Function secret; the browser never sees it. */
export type NodiSettings = { enabled: boolean; model: string; daily_limit: number; max_tokens: number; features?: NodiFeatures }
/** Each part of নদী AI has its own on/off switch (settings page). */
export type NodiFeature = 'chat' | 'teach' | 'office' | 'gaps' | 'followup'
export type NodiFeatures = Record<NodiFeature, boolean>
export const ALL_ON: NodiFeatures = { chat: true, teach: true, office: true, gaps: true, followup: true }
export type NodiUsageRow = { day: string; full_name: string; requests: number; failed: number; input_tokens: number; output_tokens: number }
export type NodiAction = { tool: string; input: unknown; result: unknown }
export type ChatMsg = { role: 'user' | 'assistant'; content: string }

function fail(error: { message: string } | null) { if (error) throw error }
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}
async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('nodi-ai', { body })
  if (error) {
    let b: { message?: string; error?: string } = {}
    const ctx = (error as { context?: Response }).context
    try { if (ctx && typeof ctx.json === 'function') b = await ctx.json() } catch { /* not JSON */ }
    throw new Error(b.message || b.error || error.message)
  }
  return data as T
}

export const nodi = {
  settings: () => rpc<NodiSettings>('nodi_settings'),
  configure: (s: NodiSettings) => rpc<void>('nodi_configure', { p_enabled: s.enabled, p_model: s.model, p_daily_limit: s.daily_limit, p_max_tokens: s.max_tokens }),
  /** Which parts are on for everyone (the main switch included). Before the database knows the switches, every part counts as on. */
  features: () => rpc<NodiFeatures>('nodi_features').then(f => ({ ...ALL_ON, ...f })).catch(() => ALL_ON),
  configureFeatures: (f: Partial<NodiFeatures>) => rpc<void>('nodi_features_configure', { p_features: f }),
  usage: (days = 14) => rpc<NodiUsageRow[]>('nodi_usage_summary', { p_days: days }),
  keyConfigured: () => call<{ configured: boolean }>({ action: 'status' }).then(r => r.configured).catch(() => false),
  chat: (messages: ChatMsg[]) => call<{ text: string; actions?: NodiAction[] }>({ action: 'chat', messages }),
  /** নদী AI হিসাব শিক্ষক: the lesson text is the internal guide; official rules and settings are read by the server itself. */
  teach: (messages: ChatMsg[], module: string, title: string, guide: string) =>
    call<{ text: string }>({ action: 'teach', messages, module, title, guide }),
}

// One read per page load, shared by every component; the settings page refreshes it after a change.
let cached: Promise<NodiFeatures> | null = null
const listeners = new Set<(f: NodiFeatures) => void>()
export function loadNodiFeatures(fresh = false): Promise<NodiFeatures> {
  if (!cached || fresh) { cached = nodi.features(); void cached.then(f => listeners.forEach(l => l(f))) }
  return cached
}
export function subscribeNodiFeatures(l: (f: NodiFeatures) => void) { listeners.add(l); return () => { listeners.delete(l) } }
