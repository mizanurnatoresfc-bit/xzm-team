// Office Management: offices and residences, rooms (with direction), desks (with the person
// responsible), and the resources in them (monitor, PC, fan, cylinder …).
import { supabase } from './supabase'

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}

export type Property = { id: string; code: string; name: string; kind: 'office' | 'residence'; zone_id: string; hub_id: string | null
  sorting_center_id: string | null; address: string | null; floor_note: string | null; owner_name: string | null; owner_phone: string | null
  rent: number | null; front_direction: string | null; note: string | null; status: string }
export type Room = { id: string; property_id: string; name: string; kind: string; direction: string; floor: number; responsible_id: string | null; note: string | null; sort: number }
export type Desk = { id: string; property_id: string; room_id: string | null; code: string; name: string; responsible_id: string | null; duty: string | null; note: string | null; sort: number }
export type Asset = { id: string; property_id: string; room_id: string | null; desk_id: string | null; kind: string; name: string; brand: string | null
  serial_no: string | null; quantity: number; condition: 'good' | 'repair' | 'broken' | 'lost'; holder_id: string | null
  purchase_date: string | null; price: number | null; note: string | null }

export const ROOM_KIND: Record<string, [string, string, string]> = {
  office_room: ['অফিস রুম', 'Office room', 'grid'], room: ['রুম', 'Room', 'home'], garage: ['গ্যারেজ', 'Garage', 'truck'],
  kitchen: ['রান্নাঘর', 'Kitchen', 'box'], bathroom: ['বাথরুম', 'Bathroom', 'note'], store: ['স্টোর', 'Store', 'box'],
  dining: ['ডাইনিং', 'Dining', 'users'], veranda: ['বারান্দা', 'Veranda', 'sun'], meeting: ['মিটিং রুম', 'Meeting room', 'users'], other: ['অন্যান্য', 'Other', 'form'],
}
export const DIR: Record<string, [string, string]> = {
  n: ['উত্তর', 'North'], ne: ['উত্তর-পূর্ব', 'North-east'], e: ['পূর্ব', 'East'], se: ['দক্ষিণ-পূর্ব', 'South-east'],
  s: ['দক্ষিণ', 'South'], sw: ['দক্ষিণ-পশ্চিম', 'South-west'], w: ['পশ্চিম', 'West'], nw: ['উত্তর-পশ্চিম', 'North-west'], c: ['মাঝখানে', 'Centre'],
}
/** Compass grid, top row = north. */
export const DIR_GRID = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se']
export const ASSET_KIND: Record<string, [string, string, string]> = {
  monitor: ['মনিটর', 'Monitor', 'grid'], pc: ['পিসি', 'PC', 'box'], keyboard: ['কিবোর্ড', 'Keyboard', 'table'], mouse: ['মাউস', 'Mouse', 'user'],
  printer: ['জি-প্রিন্টার', 'G-printer', 'print'], laptop: ['ল্যাপটপ', 'Laptop', 'grid'], ups: ['UPS', 'UPS', 'box'], router: ['রাউটার', 'Router', 'globe'],
  scanner: ['স্ক্যানার', 'Scanner', 'scan'], chair: ['চেয়ার', 'Chair', 'user'], table: ['টেবিল', 'Table', 'table'],
  light: ['লাইট', 'Light', 'sun'], fan: ['ফ্যান', 'Fan', 'gear'], bedding: ['বেডিং', 'Bedding', 'home'], stove: ['চুলা', 'Stove', 'alert'],
  cylinder: ['গ্যাস সিলিন্ডার', 'Gas cylinder', 'alert'], ac: ['এসি', 'AC', 'sun'], cctv: ['সিসিটিভি', 'CCTV', 'eye'], other: ['অন্যান্য', 'Other', 'form'],
}
export const CONDITION: Record<Asset['condition'], [string, string, 'ok' | 'warn' | 'bad' | 'neutral']> = {
  good: ['ভালো', 'Good', 'ok'], repair: ['মেরামত লাগবে', 'Needs repair', 'warn'], broken: ['নষ্ট', 'Broken', 'bad'], lost: ['হারানো', 'Lost', 'neutral'],
}
/** One click fills the usual items. */
export const DESK_DEFAULT = ['monitor', 'pc', 'keyboard', 'mouse', 'printer']
export const ROOM_DEFAULT: Record<string, string[]> = {
  garage: ['light', 'fan', 'bedding'], room: ['light', 'fan'], kitchen: ['light', 'fan', 'stove', 'cylinder'], bathroom: ['light'],
  office_room: ['light', 'fan'], meeting: ['light', 'fan', 'chair', 'table'], dining: ['light', 'fan', 'table'], store: ['light'], veranda: ['light'], other: [],
}

const archive = (table: string) => async (id: string, reason: string) => {
  const { error } = await supabase.from(table).update({ archived_at: new Date().toISOString(), archive_reason: reason }).eq('id', id); fail(error)
}
const save = (table: string) => async (row: Record<string, unknown>, id?: string) => {
  if (id) { const { error } = await supabase.from(table).update(row).eq('id', id); fail(error); return id }
  const { data, error } = await supabase.from(table).insert(row).select('id').single(); fail(error); return (data as { id: string }).id
}

export const office = {
  properties: async () => {
    const { data, error } = await supabase.from('office_properties').select('*').is('archived_at', null).order('kind').order('name'); fail(error)
    return (data ?? []) as Property[]
  },
  rooms: async (p: string) => {
    const { data, error } = await supabase.from('office_rooms').select('*').eq('property_id', p).is('archived_at', null).order('floor').order('sort').order('name'); fail(error)
    return (data ?? []) as Room[]
  },
  desks: async (p: string) => {
    const { data, error } = await supabase.from('office_desks').select('*').eq('property_id', p).is('archived_at', null).order('sort').order('code'); fail(error)
    return (data ?? []) as Desk[]
  },
  assets: async (p: string) => {
    const { data, error } = await supabase.from('office_assets').select('*').eq('property_id', p).is('archived_at', null).order('kind').order('name'); fail(error)
    return (data ?? []) as Asset[]
  },
  saveProperty: save('office_properties'), saveRoom: save('office_rooms'), saveDesk: save('office_desks'), saveAsset: save('office_assets'),
  archiveProperty: archive('office_properties'), archiveRoom: archive('office_rooms'), archiveDesk: archive('office_desks'), archiveAsset: archive('office_assets'),
  /** Add the usual items of a room kind or a desk in one go. */
  addDefaults: async (property: string, kinds: string[], at: { room_id?: string | null; desk_id?: string | null; holder_id?: string | null }) => {
    if (!kinds.length) return
    const rows = kinds.map(k => ({ property_id: property, room_id: at.room_id ?? null, desk_id: at.desk_id ?? null, holder_id: at.holder_id ?? null,
      kind: k, name: ASSET_KIND[k]?.[0] ?? k, quantity: 1, condition: 'good' }))
    const { error } = await supabase.from('office_assets').insert(rows); fail(error)
  },
}
