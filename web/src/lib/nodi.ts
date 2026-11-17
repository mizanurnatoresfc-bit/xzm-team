import { supabase } from './supabase'

/** নদী AI. The Anthropic key lives only in the Edge Function secret; the browser never sees it. */
export type NodiSettings = { enabled: boolean; model: string; daily_limit: number; max_tokens: number }
export type NodiRole = { code: string; name: string; name_bn: string | null; enabled: boolean; locked: boolean }
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
  roles: () => rpc<NodiRole[]>('nodi_roles'),
  setRoles: (codes: string[]) => rpc<void>('nodi_set_roles', { p_codes: codes }),
  usage: (days = 14) => rpc<NodiUsageRow[]>('nodi_usage_summary', { p_days: days }),
  keyConfigured: () => call<{ configured: boolean }>({ action: 'status' }).then(r => r.configured).catch(() => false),
  chat: (messages: ChatMsg[]) => call<{ text: string; actions?: NodiAction[] }>({ action: 'chat', messages }),
  /** নদী AI হিসাব শিক্ষক: the lesson text is the internal guide; official rules and settings are read by the server itself. */
  teach: (messages: ChatMsg[], module: string, title: string, guide: string) =>
    call<{ text: string }>({ action: 'teach', messages, module, title, guide }),
}
