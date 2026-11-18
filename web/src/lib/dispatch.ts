import { supabase } from './supabase'

/** রুট থেকে পাঠাচ্ছি: a route's person sends parcels and items to another hub or the sorting centre; the receiver confirms. */
export type DispatchCtx = {
  employee: { id: string; name: string; hub_id: string; hub: string | null }
  routes: Array<{ id: string; name: string; areas: string[] }>
  hubs: Array<{ id: string; name: string }>
  centers: Array<{ id: string; name: string }>
  sorting_items: string[]
  assets: Array<{ id: string; name: string; quantity: number }>
}
export type DispatchItemIn = { kind: 'asset' | 'sorting_item'; name: string; qty: number; asset_id?: string }
export type DispatchRow = {
  id: string; no: number; date: string; route: string | null; from_hub: string | null; to_kind: 'hub' | 'sorting'; to: string | null
  parcels: number; bags: number | null; note: string | null; status: 'sent' | 'received' | 'disputed'; sender: string | null
  received_by: string | null; received_at: string | null; received_parcels: number | null; receive_note: string | null
  mine: boolean; can_receive: boolean; items: Array<{ kind: string; name: string; qty: number }>
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export const DISPATCH_STATUS: Record<DispatchRow['status'], [bn: string, en: string, tone: 'ok' | 'warn' | 'bad']> = {
  sent: ['বুঝে নেওয়ার অপেক্ষায়', 'Waiting to be received', 'warn'], received: ['বুঝে নেওয়া হয়েছে', 'Received', 'ok'], disputed: ['আপত্তি আছে', 'Disputed', 'bad'] }

export const dispatch = {
  context: () => rpc<DispatchCtx>('dispatch_context'),
  send: (a: { route: string | null; toKind: 'hub' | 'sorting'; to: string; parcels: number; bags: number | null; items: DispatchItemIn[]; note: string }) =>
    rpc<string>('dispatch_send', { p_route: a.route, p_to_kind: a.toKind, p_to: a.to, p_parcels: a.parcels, p_bags: a.bags, p_items: a.items, p_note: a.note || null }),
  list: (scope: 'mine' | 'incoming', days = 30) => rpc<DispatchRow[]>('dispatch_list', { p_scope: scope, p_days: days }),
  receive: (id: string, ok: boolean, received: number | null, note: string) => rpc<void>('dispatch_receive', { p_id: id, p_ok: ok, p_received: received, p_note: note || null }),
}
