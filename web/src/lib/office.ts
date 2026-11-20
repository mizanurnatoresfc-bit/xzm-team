// Office Management: offices and residences, rooms (with direction), desks (with the person
// responsible), and the resources in them (monitor, PC, fan, cylinder …).
import { supabase } from './supabase'

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}

export type PlaceKind = 'office' | 'residence' | 'garage' | 'auto_garage'
export type Property = { id: string; code: string; name: string; kind: PlaceKind; zone_id: string; hub_id: string | null
  sorting_center_id: string | null; address: string | null; floor_note: string | null; owner_name: string | null; owner_phone: string | null
  rent: number | null; front_direction: string | null; note: string | null; status: string
  advance: number | null; contract_from: string | null; contract_to: string | null; contract_file: string | null; rent_due_day: number | null
  meter_no: string | null; unit_rate: number | null; wifi_provider: string | null; wifi_bill: number | null; capacity: number | null }
/** [বাংলা, English, emoji] */
export const PLACE_KIND: Record<PlaceKind, [string, string, string]> = {
  office: ['অফিস', 'Office', '🏢'], residence: ['আবাসিক ফ্ল্যাট', 'Residence', '🏠'], garage: ['গ্যারেজ', 'Garage', '🚚'], auto_garage: ['অটো গ্যারেজ', 'Auto garage', '🛺'],
}
export type Room = { id: string; property_id: string; name: string; kind: string; direction: string; floor: number; responsible_id: string | null; note: string | null; sort: number }
export type Desk = { id: string; property_id: string; room_id: string | null; code: string; name: string; responsible_id: string | null; duty: string | null; note: string | null; sort: number }
export type Asset = { id: string; property_id: string; room_id: string | null; desk_id: string | null; kind: string; name: string; brand: string | null
  serial_no: string | null; quantity: number; condition: 'good' | 'repair' | 'broken' | 'lost'; holder_id: string | null
  purchase_date: string | null; price: number | null; note: string | null
  watt: number | null; hours_per_day: number | null; spec: string | null; vehicle_id: string | null }

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
  monitor: ['মনিটর', 'Monitor', 'a_monitor'], pc: ['পিসি', 'PC', 'a_pc'], keyboard: ['কিবোর্ড', 'Keyboard', 'a_keyboard'], mouse: ['মাউস', 'Mouse', 'a_mouse'],
  printer: ['জি-প্রিন্টার', 'G-printer', 'a_printer'], laptop: ['ল্যাপটপ', 'Laptop', 'a_laptop'], ups: ['UPS', 'UPS', 'a_ups'], router: ['রাউটার', 'Router', 'a_router'],
  scanner: ['স্ক্যানার', 'Scanner', 'a_scanner'], chair: ['চেয়ার', 'Chair', 'a_chair'], chair_plastic: ['প্লাস্টিক চেয়ার', 'Plastic chair', 'a_chair'],
  chair_exec: ['এক্সিকিউটিভ চেয়ার', 'Executive chair', 'a_chair_exec'], table: ['টেবিল', 'Table', 'a_table'],
  weight_machine: ['ওয়েট মেশিন', 'Weight machine', 'a_weight'], mobile: ['মোবাইল ফোন', 'Mobile phone', 'a_mobile'], ip_phone: ['আইপি ফোন', 'IP phone', 'a_ipphone'],
  lock: ['তালা', 'Lock', 'a_lock'], dvr: ['DVR', 'DVR', 'a_dvr'], cable: ['তার (গজ)', 'Cable (yards)', 'a_cable'],
  light: ['লাইট', 'Light', 'a_light'], fan: ['ফ্যান', 'Fan', 'a_fan'], bedding: ['বেডিং', 'Bedding', 'a_bedding'], stove: ['চুলা', 'Stove', 'a_stove'],
  cylinder: ['গ্যাস সিলিন্ডার', 'Gas cylinder', 'a_cylinder'], ac: ['এসি', 'AC', 'a_ac'], cctv: ['সিসিটিভি', 'CCTV', 'a_cctv'], other: ['অন্যান্য', 'Other', 'form'],
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
  createHubOffices: async (zone: string | null) => { const { data, error } = await supabase.rpc('office_create_hub_offices', { p_zone: zone }); fail(error); return (data ?? 0) as number },
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

/**
 * "আমার অফিস" — the office menu of its own, arranged by what the database keeps (owner, 19 Nov 2026).
 * One list for the side menu and the tabs of the office page; `perms` are the ones the page itself checks.
 */
export type OfficeSec = 'overview' | 'places' | 'rooms' | 'desks' | 'people' | 'assets' | 'power' | 'rent' | 'bills' | 'security' | 'notices' | 'zone'
/** `more`: shown in the page's tab bar but not in the side menu (kept so nothing already written becomes unreachable). */
export type OfficePart = { key: OfficeSec; icon: string; bn: string; en: string; perms: string[]; more?: boolean }
export const OFFICE_GROUPS: Array<{ bn: string; en: string; parts: OfficePart[] }> = [
  { bn: 'এক নজরে', en: 'At a glance', parts: [
    { key: 'overview', icon: 'map', bn: 'অফিসের সারসংক্ষেপ', en: 'Office overview', perms: ['office.property.view'] },
    { key: 'zone', icon: 'chart', bn: 'জোনের চিত্র ও AI পরামর্শ', en: 'Zone picture & AI advice', perms: ['office.asset.view'] },
  ] },
  // office_properties · office_rooms · office_desks · office_residents
  { bn: 'জায়গা ও মানুষ', en: 'Places & people', parts: [
    { key: 'places', icon: 'home', bn: 'অফিস ও আবাসিক', en: 'Offices & residences', perms: ['office.property.view', 'office.property.create'] },
    { key: 'rooms', icon: 'grid', bn: 'ফ্ল্যাটের বিবরণ (রুম ও দিক)', en: 'Flat details (rooms & direction)', perms: ['office.property.view'] },
    { key: 'desks', icon: 'table', bn: 'ডেস্ক ও দায়িত্ব', en: 'Desks & responsibility', perms: ['office.property.view'] },
    { key: 'people', icon: 'users', bn: 'কারা থাকেন', en: 'Who lives here', perms: ['office.property.view'] },
  ] },
  // office_assets · office_asset_loans
  { bn: 'জিনিসপত্র', en: 'Things', parts: [
    { key: 'assets', icon: 'box', bn: 'অফিসের রিসোর্স ও ধার', en: 'Office resources & loans', perms: ['office.asset.view', 'office.asset.edit'] },
    { key: 'power', icon: 'sun', bn: 'ইলেকট্রনিক ও বিদ্যুৎ হিসাব', en: 'Devices & power', perms: ['office.asset.view'] },
  ] },
  // rent and contract on office_properties · office_bills
  { bn: 'ভাড়া ও বিল', en: 'Rent & bills', parts: [
    { key: 'rent', icon: 'cash', bn: 'ভাড়া ও চুক্তি', en: 'Rent & contract', perms: ['office.bill.view', 'office.property.edit'] },
    { key: 'bills', icon: 'receipt', bn: 'বিদ্যুৎ ও ওয়াইফাই বিল', en: 'Electricity & wifi bills', perms: ['office.bill.view'] },
  ] },
  // office_secrets · office_notices
  { bn: 'নিরাপত্তা ও রিপোর্ট', en: 'Security & reports', parts: [
    { key: 'security', icon: 'key', bn: 'গাড়ি, তালা, সিসি ও পাসওয়ার্ড', en: 'Vehicles, locks, CCTV & logins', perms: ['office.asset.view', 'office.secret.view'] },
    { key: 'notices', icon: 'bell', bn: 'নষ্ট / লাগবে রিপোর্ট', en: 'Broken / needed reports', perms: ['office.notice.create', 'office.notice.approve'] },
  ] },
]
export const OFFICE_PARTS: OfficePart[] = OFFICE_GROUPS.flatMap(g => g.parts)

/**
 * আবাসিক (Residential) — the same tables seen only for residences (kind = 'residence'), under /app/office/residential/….
 * Nothing is stored apart: a flat is an office_properties row, its rooms office_rooms, its people office_residents, its bills office_bills.
 * Each page has the same key and permissions as its twin under /app/office/…, so a role limited to the office page may open this one too (lib/menu.ts).
 */
export type OfficeScope = 'office' | 'residential'
export const RESIDENTIAL_BASE = '/app/office/residential'
export const RESIDENTIAL_PARTS: OfficePart[] = [
  { key: 'overview', icon: 'map', bn: 'আবাসিকের সারসংক্ষেপ', en: 'Residential overview', perms: ['office.property.view'] },
  { key: 'places', icon: 'home', bn: 'আবাসিক ফ্ল্যাটের তালিকা', en: 'Residential list', perms: ['office.property.view', 'office.property.create'] },
  { key: 'rooms', icon: 'grid', bn: 'ফ্ল্যাট ও রুম', en: 'Flats & rooms', perms: ['office.property.view'] },
  { key: 'people', icon: 'users', bn: 'ফ্ল্যাটে কারা থাকেন', en: 'Residents', perms: ['office.property.view'] },
  { key: 'rent', icon: 'cash', bn: 'ফ্ল্যাটের ভাড়া ও চুক্তি', en: 'Flat rent & contracts', perms: ['office.bill.view', 'office.property.edit'] },
  { key: 'bills', icon: 'receipt', bn: 'ফ্ল্যাটের বিদ্যুৎ ও অন্য বিল', en: 'Flat utility bills', perms: ['office.bill.view'] },
  { key: 'assets', icon: 'box', bn: 'ফ্ল্যাটের জিনিসপত্র', en: 'Flat items', perms: ['office.asset.view', 'office.asset.edit'] },
  // Before the split these pages also served residences; they stay reachable from the page's tabs.
  { key: 'power', icon: 'sun', bn: 'বিদ্যুৎ হিসাব', en: 'Power', perms: ['office.asset.view'], more: true },
  { key: 'security', icon: 'key', bn: 'তালা, সিসি ও পাসওয়ার্ড', en: 'Locks, CCTV & logins', perms: ['office.asset.view', 'office.secret.view'], more: true },
  { key: 'notices', icon: 'bell', bn: 'নষ্ট / লাগবে', en: 'Broken / needed', perms: ['office.notice.create', 'office.notice.approve'], more: true },
  { key: 'desks', icon: 'table', bn: 'ডেস্ক', en: 'Desks', perms: ['office.property.view'], more: true },
]
export const RESIDENTIAL_GROUP = { bn: 'আবাসিক', en: 'Residential', parts: RESIDENTIAL_PARTS.filter(p => !p.more) }
/** Which side a place belongs to: residences are Residential, everything else (office, garage, auto garage) is Office. */
export const inScope = (scope: OfficeScope, p: Pick<Property, 'kind'>) => (p.kind === 'residence') === (scope === 'residential')
export const scopePath = (scope: OfficeScope, key: string) => scope === 'residential' ? `${RESIDENTIAL_BASE}/${key}` : `/app/office/${key}`
