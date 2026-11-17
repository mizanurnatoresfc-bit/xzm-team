// ঘণ্টা লাইভ: one shared store of the signed-in person's notifications.
// New rows arrive through Supabase Realtime (the table's RLS sends each person only their own);
// a slow poll and a refresh when the app comes back to the screen cover a dropped connection.
import { useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Notice = { id: string; title: string; body: string | null; link: string | null; kind: string | null; created_at: string; read_at: string | null }
type State = { user: string | null; list: Notice[]; unread: number; live: boolean; fresh: Notice | null }

const COLS = 'id,title,body,link,kind,created_at,read_at'
let state: State = { user: null, list: [], unread: 0, live: false, fresh: null }
const subs = new Set<() => void>()
const emit = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach(f => f()) }
let channel: RealtimeChannel | null = null
let timer: number | null = null

async function load() {
  if (!state.user) return
  const [l, c] = await Promise.all([
    supabase.from('notifications').select(COLS).order('created_at', { ascending: false }).limit(30),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
  ])
  if (!l.error) emit({ list: (l.data ?? []) as Notice[], unread: c.count ?? (l.data ?? []).filter(x => !x.read_at).length })
}
const onShow = () => { if (document.visibilityState === 'visible') void load() }

/** Start listening for this person (once; later calls with the same user do nothing). */
export function startNotices(user: string | null) {
  if (user === state.user) return
  stopNotices()
  if (!user) return
  state = { user, list: [], unread: 0, live: false, fresh: null }
  void load()
  channel = supabase.channel(`notices-${user}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${user}` }, p => {
      const n = p.new as Notice
      if (state.list.some(x => x.id === n.id)) return
      emit({ list: [n, ...state.list].slice(0, 30), unread: state.unread + 1, fresh: n })
      try { if ('vibrate' in navigator) navigator.vibrate?.(60) } catch { /* not allowed */ }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `profile_id=eq.${user}` }, () => { void load() })
    .subscribe(s => emit({ live: s === 'SUBSCRIBED' }))
  timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 90000)
  document.addEventListener('visibilitychange', onShow)
  window.addEventListener('focus', onShow)
}
export function stopNotices() {
  if (channel) { void supabase.removeChannel(channel); channel = null }
  if (timer) { window.clearInterval(timer); timer = null }
  document.removeEventListener('visibilitychange', onShow)
  window.removeEventListener('focus', onShow)
  state = { user: null, list: [], unread: 0, live: false, fresh: null }; subs.forEach(f => f())
}
export const refreshNotices = () => load()
export const clearFresh = () => emit({ fresh: null })

export async function markRead(ids: string[]) {
  const open = ids.filter(id => state.list.find(x => x.id === id && !x.read_at) || !state.list.some(x => x.id === id))
  if (!open.length) return
  const at = new Date().toISOString()
  emit({ list: state.list.map(x => open.includes(x.id) ? { ...x, read_at: x.read_at ?? at } : x), unread: Math.max(0, state.unread - open.filter(id => state.list.some(x => x.id === id && !x.read_at)).length) })
  await supabase.from('notifications').update({ read_at: at }).in('id', open).is('read_at', null)
}
export async function markAllRead() {
  const at = new Date().toISOString()
  emit({ list: state.list.map(x => ({ ...x, read_at: x.read_at ?? at })), unread: 0 })
  await supabase.from('notifications').update({ read_at: at }).is('read_at', null)
}
/** A page of the person's notifications for the full list. */
export async function noticePage(offset: number, size: number, unreadOnly: boolean, kind: string | null) {
  let q = supabase.from('notifications').select(COLS).order('created_at', { ascending: false }).range(offset, offset + size - 1)
  if (unreadOnly) q = q.is('read_at', null)
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q; if (error) throw error
  return (data ?? []) as Notice[]
}

export function useNotices(): State {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => state, () => state)
}

/** [বাংলা, English, icon] for each kind of notification. */
export const NOTICE_KIND: Record<string, [string, string, string]> = {
  hr_request: ['এইচআর রিকুয়েস্ট', 'HR requests', 'form'], issue: ['ইস্যু ও কাজ', 'Issues & tasks', 'tasks'], vehicle: ['গাড়ি', 'Vehicles', 'truck'],
  office: ['অফিস', 'Office', 'home'], attendance: ['হাজিরা', 'Attendance', 'cal'], manpower: ['লোক লাগবে', 'Manpower', 'users'],
  da_reminder: ['হিসাব খাতা', 'Daily sheet', 'ledger'], nodi: ['নদী AI', 'Nodi AI', 'bell'],
}
export const kindOf = (k: string | null) => NOTICE_KIND[k ?? ''] ?? ['অন্যান্য', 'Other', 'bell']

/** Phone push: save this phone for the signed-in person (the app calls it after sign-in). */
export const savePushDevice = async (token: string) => {
  const v = (window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ ?? null
  const { error } = await supabase.rpc('push_device_save', { p_token: token, p_platform: 'android', p_version: v }); if (error) throw error
}
export const removePushDevice = async (token: string | null) => { if (token) await supabase.rpc('push_device_remove', { p_token: token }) }
