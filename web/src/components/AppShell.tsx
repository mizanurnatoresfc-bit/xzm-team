import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { inMenu, panelLevel, ZONE_ONLY } from '../lib/menu'
import { PulsePopup } from './PulsePopup'
import { UpdateBar } from './UpdateBar'
import { supabase } from '../lib/supabase'
import { isDark, usePrefs } from '../lib/prefs'
import { NodiAvatar } from './NodiAvatar'
import { clearFresh, kindOf, markAllRead, markRead, savePushDevice, startNotices, useNotices, type Notice as LiveNotice } from '../lib/notices'
import { advancedAccessHere, setupPush } from '../lib/native'
import { Icon } from './Icon'
import { BrandName, useBrandText } from './Brand'
import { hrReq } from '../lib/hrreq'
import { getView, type DashView } from '../lib/dashboard'
import { ViewAsBar, ViewAsPicker } from './ViewAs'
import { PersonalMenu, WfCountsHost } from './PersonalMenu'

type Item = { to: string; icon: string; bn: string; en: string; perms: string[] | null; count?: CountKey
  /** 'web' = the website only, 'app' = the Android app only (see advancedAccessHere). */ only?: 'web' | 'app' }
type Sec = { bn: string; en: string; items: Item[] }
type Group = { key: string; icon: string; bn: string; en: string; secs: Sec[]; items: Item[] }
type CountKey = 'apps' | 'leave' | 'sheets' | 'team' | 'hrreq'
const panel = (key: string, icon: string, bn: string, en: string, secs: Sec[]): Group => ({ key, icon, bn, en, secs, items: secs.flatMap(s => s.items) })

export const HOME: Item[] = [
  { to: '/app', icon: 'dash', bn: 'ড্যাশবোর্ড', en: 'Dashboard', perms: null },
  { to: '/app/training', icon: 'book', bn: 'ট্রেনিং সেন্টার', en: 'Training centre', perms: null },
]
/**
 * The whole menu is three panels, lowest first: the staff member's own work, the hub manager's hub, the zonal manager's zone.
 * What a person does goes up: staff input -> manager -> zonal manager. A person sees the panels up to their own level;
 * a page from a higher panel that their role may open is listed in their own top panel (see AppShell).
 */
export const GROUPS: Group[] = [
  panel('self', 'user', 'স্টাফ প্যানেল', 'Staff panel', [
    { bn: '', en: '', items: [
      { to: '/app/staff', icon: 'grid', bn: 'আমার প্যানেল', en: 'My panel', perms: null },
      { to: '/app/accounts/mine', icon: 'wallet', bn: 'আমার হিসাব', en: 'My accounts', perms: null },
      { to: '/app/workforce/attendance', icon: 'cal', bn: 'আমার উপস্থিতি', en: 'My attendance', perms: null },
      { to: '/app/hr/requests', icon: 'form', bn: 'রিকুয়েস্ট ও আবেদন', en: 'Requests', perms: null, count: 'hrreq' },
      { to: '/app/hr/leave', icon: 'log', bn: 'ছুটি', en: 'Leave', perms: ['hr.leave.view', 'hr.leave.create'], count: 'leave' },
      { to: '/app/issues', icon: 'tasks', bn: 'ইস্যু, হাব গ্রুপ ও অর্ডার', en: 'Issues, hub group & orders', perms: null },
      { to: '/app/fleet/mine', icon: 'truck', bn: 'আমার গাড়ি (ড্রাইভার / হেল্পার)', en: 'My vehicle (crew)', perms: null },
    ] },
  ]),
  panel('hub', 'hub', 'ম্যানেজার প্যানেল', 'Manager panel', [
    { bn: 'আজকের কাজ', en: 'Today', items: [
      { to: '/app/hub/attendance', icon: 'cal', bn: 'আজকের হাজিরা খাতা', en: "Today's attendance", perms: ['hr.attendance.view', 'hr.attendance.create'] },
      { to: '/app/workforce/hub', icon: 'table', bn: 'হাজিরা বই ও দৈনিক রিপোর্ট', en: 'Attendance book & daily report', perms: ['hr.attendance.view', 'ops.staff_daily.view'] },
      { to: '/app/hub/late', icon: 'clock', bn: 'আজকের দেরিতে হাজিরা', en: 'Late today', perms: ['hr.attendance.view', 'hr.attendance.create'] },
      { to: '/app/hub/pickup', icon: 'box', bn: 'আজকের পিকআপ খাতা', en: "Today's pickups", perms: ['ops.pickup.view', 'ops.pickup_as_hub_manager.create', 'ops.pickup_as_pickup_manager.create', 'ops.pickup_as_rider.create'] },
      { to: '/app/hub/tasks', icon: 'tasks', bn: 'আজকের কাজ', en: "Today's tasks", perms: ['zonal.task.view', 'zonal.task.create'] },
      { to: '/app/hub/ops', icon: 'truck', bn: 'আজকের হাব অপারেশন', en: "Today's hub operation", perms: ['zonal.hub_metric.view', 'zonal.hub_metric.create'] },
    ] },
    { bn: 'গাড়ি', en: 'Vehicles', items: [
      { to: '/app/fleet', icon: 'truck', bn: 'গাড়ি: দায়িত্ব, খোরাকি, গ্যারেজ ও অনুমোদন', en: 'Vehicles: crew, allowance, garage & approvals', perms: ['vehicle.vehicle.view', 'vehicle.log.approve', 'vehicle.report.view'] },
    ] },
    { bn: 'হাবের টিম', en: 'Hub team', items: [
      { to: '/app/hub/team', icon: 'users', bn: 'আমার হাব টিম', en: 'My hub team', perms: ['hr.employee.view'], count: 'team' },
      { to: '/app/hub/logins', icon: 'key', bn: 'লগইন সেটআপ', en: 'Logins', perms: ['system.user_hub.create'] },
      { to: '/app/hub/days', icon: 'cal', bn: 'হাজিরার দিন মেলানো', en: 'Attendance days', perms: ['hr.attendance.view', 'hr.attendance.create'] },
      { to: '/app/hub/routes', icon: 'map', bn: 'রাইডার রুট', en: 'Rider routes', perms: ['ops.route.view', 'ops.route.edit'] },
      { to: '/app/manpower', icon: 'users', bn: 'লোক লাগবে', en: 'Manpower needed', perms: ['hr.employee.view', 'hr.request.create', 'hr.request.approve'] },
      { to: '/app/hr/profile-gaps', icon: 'form', bn: 'প্রোফাইল পূর্ণতা (আইডির তথ্য)', en: 'Profile completeness', perms: ['hr.employee.view'] },
    ] },
  ]),
  panel('zone', 'map', 'জোনাল ম্যানেজার প্যানেল', 'Zonal manager panel', [
    { bn: 'জোন ও হাব', en: 'Zone & hubs', items: [
      { to: '/app/zonal', icon: 'dash', bn: 'জোনাল ড্যাশবোর্ড', en: 'Zonal dashboard', perms: ['zonal.dashboard.view'] },
      { to: '/app/workforce/zone', icon: 'chart', bn: 'জোনাল ওয়ার্কফোর্স রিপোর্ট', en: 'Zonal workforce report', perms: ['zonal.dashboard.view'] },
      { to: '/app/zonal/hub-ops', icon: 'chart', bn: 'হাব অপারেশন ড্যাশবোর্ড', en: 'Hub Operations Dashboard', perms: ['zonal.hub_ops.view', 'zonal.hub_ops.create'] },
      { to: '/app/org/hubs', icon: 'map', bn: 'হাব তালিকা ও ম্যাপ', en: 'Hub list & map', perms: ['org.hub.view'] },
      { to: '/app/org', icon: 'org', bn: 'এরিয়া, হাব ও পদ', en: 'Areas, hubs & posts', perms: ['org.zone.view', 'org.hub.view', 'org.department.view'] },
    ] },
    { bn: 'কর্মী ও এইচআর', en: 'Staff & HR', items: [
      { to: '/app/references', icon: 'users', bn: 'রেফারেন্স তালিকা', en: 'Reference list', perms: null },
      { to: '/app/hr/employees', icon: 'users', bn: 'কর্মী', en: 'Employees', perms: ['hr.employee.view', 'hr.application.create'] },
      { to: '/app/zonal/staff', icon: 'users', bn: 'হাব অনুযায়ী কর্মী ও পদ', en: 'Staff & posts by hub', perms: ['hr.employee.view'] },
      { to: '/app/hr/applications', icon: 'form', bn: 'আইডি আবেদন', en: 'ID applications', perms: ['hr.application.view', 'hr.application.create'], count: 'apps' },
      { to: '/app/zonal/files', icon: 'xls', bn: 'জোনাল ফাইল (বদলি/চালু/বন্ধ)', en: 'Zonal files', perms: ['hr.request.create', 'hr.request.approve'] },
      { to: '/app/hr/attendance', icon: 'cal', bn: 'হাজিরা', en: 'Attendance', perms: ['hr.attendance.view', 'hr.attendance.create'] },
      { to: '/app/zonal/assistant', icon: 'cal', bn: 'জোনাল অ্যাসিস্ট্যান্ট (হাজিরার ফাঁকা দিন)', en: 'Zonal assistant (attendance gaps)', perms: ['hr.attendance_gap.view'] },
      { to: '/app/hr/duties', icon: 'tasks', bn: 'কাজের দায়িত্ব', en: 'Duties', perms: ['hr.duty.view', 'hr.duty.edit'] },
      { to: '/app/hr/referrals', icon: 'users', bn: 'রেফারেন্স', en: 'Referrals', perms: ['hr.referral.view'] },
      { to: '/app/rollout', icon: 'key', bn: 'চালু করার অগ্রগতি (লগইন)', en: 'Launch progress (logins)', perms: ['hr.employee.view'] },
    ] },
    { bn: 'শটিং সেন্টার', en: 'Sorting centre', items: [
      { to: '/app/sorting/dashboard', icon: 'dash', bn: 'শটিং ড্যাশবোর্ড', en: 'Sorting dashboard', perms: ['sorting.center.view', 'sorting.report.view'] },
      { to: '/app/sorting/routes', icon: 'map', bn: 'শটিং টু হাব রুট', en: 'Sorting to hub routes', perms: ['sorting.center.view'] },
      { to: '/app/sorting/staff', icon: 'users', bn: 'শটিং সেন্টারের স্টাফ', en: 'Sorting staff', perms: ['sorting.staff.view'] },
      { to: '/app/sorting/fuel', icon: 'receipt', bn: 'তেলের স্লিপ ও খরচ রিকুয়েস্ট', en: 'Fuel slips & expenses', perms: ['sorting.fuel.view', 'sorting.fuel.create'] },
      { to: '/app/sorting/parcels', icon: 'box', bn: 'পার্সেল আদান-প্রদান', en: 'Parcel handovers', perms: ['sorting.parcel.view', 'sorting.parcel.create'] },
      { to: '/app/sorting/drivers', icon: 'truck', bn: 'ড্রাইভার রিপোর্ট', en: 'Driver reports', perms: ['sorting.driver.view', 'sorting.driver.create'] },
      { to: '/app/sorting/reports', icon: 'chart', bn: 'রিপোর্ট: হাব ও শটিং', en: 'Reports: hub & sorting', perms: ['sorting.report.view'] },
      { to: '/app/sorting/centers', icon: 'hub', bn: 'শটিং সেন্টার', en: 'Sorting centers', perms: ['sorting.center.view', 'sorting.center.create'] },
    ] },
    { bn: 'অফিস', en: 'Office', items: [
      { to: '/app/office/overview', icon: 'map', bn: 'অফিস ভিজ্যুয়াল', en: 'Office visual', perms: ['office.property.view'] },
      { to: '/app/office/places', icon: 'home', bn: 'অফিস ও আবাসিক', en: 'Offices & residences', perms: ['office.property.view', 'office.property.create'] },
      { to: '/app/office/rooms', icon: 'grid', bn: 'ফ্ল্যাটের বিবরণ', en: 'Flat details', perms: ['office.property.view'] },
      { to: '/app/office/desks', icon: 'table', bn: 'ডেস্ক ও দায়িত্ব', en: 'Desks & responsibility', perms: ['office.property.view'] },
      { to: '/app/office/assets', icon: 'box', bn: 'অফিসের রিসোর্স', en: 'Office resources', perms: ['office.asset.view', 'office.asset.edit'] },
      { to: '/app/office/rent', icon: 'cash', bn: 'ভাড়া ও চুক্তি', en: 'Rent & contract', perms: ['office.bill.view'] },
      { to: '/app/office/bills', icon: 'receipt', bn: 'বিদ্যুৎ ও ওয়াইফাই বিল', en: 'Electricity & wifi bills', perms: ['office.bill.view'] },
      { to: '/app/office/power', icon: 'sun', bn: 'ইলেকট্রনিক ও বিদ্যুৎ হিসাব', en: 'Devices & power', perms: ['office.asset.view'] },
      { to: '/app/office/security', icon: 'key', bn: 'গাড়ি, তালা, সিসি ও পাসওয়ার্ড', en: 'Vehicles, locks, CCTV & logins', perms: ['office.secret.view'] },
      { to: '/app/office/notices', icon: 'bell', bn: 'নষ্ট / লাগবে রিপোর্ট', en: 'Broken / needed reports', perms: ['office.notice.create', 'office.notice.approve'] },
      { to: '/app/office/zone', icon: 'chart', bn: 'জোনের চিত্র ও AI পরামর্শ', en: 'Zone picture & AI advice', perms: ['office.notice.approve'] },
    ] },
    { bn: 'সেটিং ও অনুমতি', en: 'Settings & permissions', items: [
      { to: '/app/users', icon: 'key', bn: 'ইউজার ও রোল', en: 'Users & roles', perms: ['system.user.view'] },
      { to: '/app/access', icon: 'shield', bn: 'অ্যাডভান্সড রোল ও পারমিশন', en: 'Advanced roles & permissions', perms: ['system.role.view'], only: 'web' },
      { to: '/app/roles', icon: 'shield', bn: 'রোল ও অনুমতি', en: 'Roles & permissions', perms: ['system.role.view'], only: 'app' },
      { to: '/app/role-dashboards', icon: 'chart', bn: 'রোল অনুযায়ী ড্যাশবোর্ড', en: 'Dashboard by role', perms: ['system.role.edit'] },
      { to: '/app/hr/fields', icon: 'form', bn: 'প্রোফাইলের ঘর ও কলাম', en: 'Profile fields', perms: ['hr.profile_field.configure', 'hr.referral.configure'] },
      { to: '/app/hr/import', icon: 'upload', bn: 'কর্মী ইমপোর্ট (এক্সেল)', en: 'Import employees', perms: ['hr.import.create'] },
      { to: '/app/nodi/chat', icon: 'phone', bn: 'নদী AI (চ্যাট ও কণ্ঠ)', en: 'Nodi AI (chat & voice)', perms: ['nodi.assistant.view'] },
      { to: '/app/nodi', icon: 'gear', bn: 'নদী AI (API ও সীমা)', en: 'Nodi AI (API & limits)', perms: ['nodi.settings.configure'] },
      { to: '/app/branding', icon: 'form', bn: 'নাম, লোগো ও রঙ', en: 'Name, logo & colour', perms: ['system.settings.configure'] },
    ] },
  ]),
]
/**
 * হিসাব — a menu of its own (owner, 17 Nov 2026): every SteadFast accounts part one tap away, in the order of the day's work.
 * It is not one of the three level panels: anyone whose role may do accounts work sees it, at the top.
 */
const DA = ['da.sheet.view', 'da.sheet.create']
export const ACCOUNTS: Group = panel('accounts', 'ledger', 'হিসাব ও নদী শিক্ষক', 'Accounts & Nodi teacher', [
  { bn: 'প্রতিদিনের হিসাব', en: 'Every day', items: [
    { to: '/app/accounts/khata', icon: 'form', bn: 'আজকের হিসাব খাতা (আমার)', en: 'My sheet today', perms: ['da.sheet.create'] },
    { to: '/app/accounts/daily', icon: 'ledger', bn: 'হাবের দৈনিক হিসাব খাতা', en: 'Hub daily sheets', perms: DA, count: 'sheets' },
    { to: '/app/accounts/center', icon: 'chart', bn: 'হিসাব কেন্দ্র (সব হাবের চিত্র)', en: 'Accounts centre', perms: DA },
  ] },
  { bn: 'হিসাবের অংশ', en: 'Accounts parts', items: [
    { to: '/app/accounts/center?tab=reports', icon: 'doc', bn: 'দৈনিক রিপোর্ট', en: 'Daily report', perms: DA },
    { to: '/app/accounts/center?tab=expenses', icon: 'receipt', bn: 'হাবের খরচ', en: 'Hub expense', perms: DA },
    { to: '/app/accounts/center?tab=merchant', icon: 'cash', bn: 'মার্চেন্ট ক্যাশ পেমেন্ট', en: 'Merchant cash payment', perms: DA },
    { to: '/app/accounts/center?tab=bank', icon: 'wallet', bn: 'ব্যাংকে জমা', en: 'Bank deposit', perms: DA },
    { to: '/app/accounts/center?tab=due', icon: 'ledger', bn: 'হাবের বকেয়া / ফান্ড', en: 'Hub due / add funds', perms: DA },
    { to: '/app/accounts/center?tab=staff', icon: 'users', bn: 'স্টাফ খরচ', en: 'Staff expense', perms: DA },
    { to: '/app/accounts/center?tab=transport', icon: 'truck', bn: 'যাতায়াত বিল', en: 'Transport bill', perms: DA },
  ] },
  { bn: 'ভাউচার', en: 'Vouchers', items: [
    { to: '/app/accounts/center?tab=new', icon: 'plus', bn: 'নতুন ভাউচার', en: 'New voucher', perms: ['da.sheet.create'] },
    { to: '/app/accounts/center?tab=vouchers', icon: 'file', bn: 'ভাউচার ম্যানেজমেন্ট', en: 'Voucher management', perms: DA },
    { to: '/app/accounts/center?tab=missing', icon: 'alert', bn: 'ভাউচার জমা হয়নি', en: 'Missing voucher', perms: DA },
  ] },
  { bn: 'ইতিহাস ও রিপোর্ট', en: 'History & reports', items: [
    { to: '/app/accounts/center?tab=history', icon: 'log', bn: 'হিসাবের ইতিহাস', en: 'Accounts history', perms: DA },
    { to: '/app/accounts/reports', icon: 'chart', bn: 'হিসাবের রিপোর্ট', en: 'Accounts reports', perms: ['da.report.view'] },
    { to: '/app/accounts/settings', icon: 'gear', bn: 'হিসাব সেটিংস', en: 'Accounts settings', perms: ['da.settings.configure'] },
  ] },
  { bn: 'শেখা', en: 'Learning', items: [
    { to: '/app/accounts/learn', icon: 'book', bn: 'বাংলা শেখার কেন্দ্র', en: 'Bangla learning centre', perms: DA },
    { to: '/app/accounts/learn?p=practice', icon: 'play', bn: 'অনুশীলন (নমুনা হিসাব)', en: 'Practice (sample data)', perms: DA },
    { to: '/app/accounts/learn?p=ask', icon: 'sms', bn: 'নদী AI হিসাব শিক্ষক', en: 'Nodi AI accounts teacher', perms: DA },
  ] },
])

/**
 * Pages taken off the menu because another page does the same job. The pages still open by their address;
 * they are to be removed for good once nobody misses them.
 *   /app/hub/accounts        -> /app/accounts/daily (the hub's sheets for today)
 *   /app/hr                  -> the home page's staff panels
 *   /app/issues?tab=orders   -> a tab inside /app/issues
 */
export const HIDDEN_PAGES = ['/app/hub/accounts', '/app/hr', '/app/issues?tab=orders']

// ---- small caches so the frame does not refetch on every page ----
type MyRole = { code: string; name: string; scope_type: string; zone: string | null; hub: string | null }
let rolesCache: { user: string; at: number; p: Promise<MyRole[]> } | null = null
let countCache: { key: string; at: number; p: Promise<Record<CountKey, number>> } | null = null
function myRoles(user: string): Promise<MyRole[]> {
  if (rolesCache && rolesCache.user === user && Date.now() - rolesCache.at < 300_000) return rolesCache.p
  const p = (async () => {
    const { data } = await supabase.from('user_roles').select('scope_type, zone_id, hub_id, revoked_at, roles(code, name), zones(name), hubs(name)').eq('user_id', user).is('revoked_at', null)
    return ((data ?? []) as Array<Record<string, unknown>>).map(r => {
      const role = (r.roles ?? {}) as { code?: string; name?: string }
      return { code: role.code ?? '', name: role.name ?? '', scope_type: String(r.scope_type ?? ''),
        zone: ((r.zones ?? null) as { name?: string } | null)?.name ?? null, hub: ((r.hubs ?? null) as { name?: string } | null)?.name ?? null }
    })
  })().catch(() => [])
  rolesCache = { user, at: Date.now(), p }; return p
}
async function countOf(table: string, col: string, val: string): Promise<number> {
  const res = await supabase.from(table).select('id', { count: 'exact', head: true }).eq(col, val) as { count?: number | null; data?: unknown[] | null; error?: unknown }
  if (res.error) return 0
  return res.count ?? (Array.isArray(res.data) ? res.data.length : 0)
}
async function teamCount(hub: string): Promise<number> {
  if (!hub) return 0
  const res = await supabase.from('employees').select('id', { count: 'exact', head: true }).eq('hub_id', hub).eq('status', 'active').is('archived_at', null)
  return res.error ? 0 : res.count ?? 0
}
const selectedHub = () => { try { return sessionStorage.getItem('xzm_hub') || '' } catch { return '' } }
function counts(user: string, can: (p: string) => boolean): Promise<Record<CountKey, number>> {
  const hub = can('hr.employee.view') ? selectedHub() : ''
  const key = [user, can('hr.application.approve'), can('hr.leave.approve'), can('da.sheet.approve'), can('hr.request.approve'), hub].join('|')
  if (countCache && countCache.key === key && Date.now() - countCache.at < 60_000) return countCache.p
  const p = Promise.all([
    can('hr.application.approve') ? countOf('employee_applications', 'status', 'submitted') : 0,
    can('hr.leave.approve') ? countOf('leave_requests', 'status', 'pending') : 0,
    can('da.sheet.approve') ? countOf('da_sessions', 'status', 'submitted') : 0,
    teamCount(hub),
    can('hr.request.approve') ? hrReq.openCount() : 0,
  ]).then(([apps, leave, sheets, team, hrreq]) => ({ apps, leave, sheets, team, hrreq })).catch(() => ({ apps: 0, leave: 0, sheets: 0, team: 0, hrreq: 0 }))
  countCache = { key, at: Date.now(), p }; return p
}
export function refreshShellCounts() { countCache = null }

// The signed-in person's own photo (an employee "photo" document), cached for 50 minutes.
let photoCache: { user: string; at: number; p: Promise<string | null> } | null = null
function myPhoto(user: string): Promise<string | null> {
  if (photoCache && photoCache.user === user && Date.now() - photoCache.at < 3_000_000) return photoCache.p
  const p = (async () => {
    const { data: emp } = await supabase.rpc('my_employee_id')
    if (!emp) return null
    const { data } = await supabase.from('employee_documents').select('storage_path').eq('employee_id', emp as string).eq('doc_type', 'photo')
      .is('archived_at', null).order('created_at', { ascending: false }).limit(1)
    const path = (data?.[0] as { storage_path?: string } | undefined)?.storage_path
    if (!path) return null
    const { data: url } = await supabase.storage.from('employee-docs').createSignedUrl(path, 3600)
    return url?.signedUrl ?? null
  })().catch(() => null)
  photoCache = { user, at: Date.now(), p }; return p
}
export function refreshMyPhoto() { photoCache = null }
/** The signed-in person's photo URL: undefined while loading, null when there is none. */
export function useMyPhoto(): string | null | undefined {
  const { session } = useAuth()
  const user = session?.user.id ?? ''
  const [p, setP] = useState<string | null | undefined>(undefined)
  useEffect(() => { if (user) void myPhoto(user).then(setP) }, [user])
  return p
}

// Mobile: bottom tabs (first four the role may open) and the quick-add sheet.
const TABS: Array<{ to: string; icon: string; bn: string; en: string; perms: string[] | null; match: string }> = [
  { to: '/app', icon: 'grid', bn: 'হোম', en: 'Home', perms: null, match: '/app$' },
  { to: '/app/hub/attendance', icon: 'hub', bn: 'হাব', en: 'Hub', perms: ['hr.attendance.view', 'hr.attendance.create', 'ops.pickup.view', 'hr.employee.view'], match: '/app/hub' },
  { to: '/app/sorting/parcels', icon: 'truck', bn: 'ট্রিপ', en: 'Trips', perms: ['sorting.parcel.view', 'sorting.parcel.create', 'sorting.center.view'], match: '/app/sorting' },
  { to: '/app/accounts/daily', icon: 'ledger', bn: 'হিসাব', en: 'Accounts', perms: null, match: '/app/accounts' },
  { to: '/app/hr/employees', icon: 'users', bn: 'কর্মী', en: 'Staff', perms: ['hr.employee.view'], match: '/app/hr' },
]
// The tab bar follows the home view: a staff member's own app, a hub manager's hub app, or the full zone app.
type Tab = { to: string; icon: string; bn: string; en: string; perms: string[] | null; match: string }
const HOME_TAB: Tab = { to: '/app', icon: 'grid', bn: 'হোম', en: 'Home', perms: null, match: '/app$' }
/** A staff member's home already is the staff panel, so their tab bar has the profile in its place. */
const PROFILE_TAB: Tab = { to: '/app/me', icon: 'user', bn: 'প্রোফাইল', en: 'Profile', perms: null, match: '/app/me' }
const VIEW_TABS: Record<DashView, Tab[]> = {
  self: [HOME_TAB,
    { to: '/app/staff', icon: 'user', bn: 'আমার প্যানেল', en: 'My panel', perms: null, match: '/app/staff' },
    { to: '/app/accounts/mine', icon: 'wallet', bn: 'আমার হিসাব', en: 'My accounts', perms: null, match: '/app/accounts' },
    { to: '/app/hr/requests', icon: 'form', bn: 'রিকুয়েস্ট', en: 'Requests', perms: null, match: '/app/hr/requests' },
  ],
  hub: [HOME_TAB,
    { to: '/app/hub/attendance', icon: 'hub', bn: 'হাব', en: 'Hub', perms: ['hr.attendance.view', 'hr.attendance.create', 'ops.pickup.view', 'hr.employee.view'], match: '/app/hub/(?!team)' },
    { to: '/app/hub/team', icon: 'users', bn: 'টিম', en: 'Team', perms: ['hr.employee.view'], match: '/app/hub/team' },
    { to: '/app/accounts/daily', icon: 'ledger', bn: 'হিসাব', en: 'Accounts', perms: null, match: '/app/accounts' },
    { to: '/app/hr/requests', icon: 'form', bn: 'রিকুয়েস্ট', en: 'Requests', perms: null, match: '/app/hr/requests' }],
  zone: TABS,
}
const QUICK: Array<{ to: string; icon: string; bn: string; en: string; perms: string[] | null; tone: string }> = [
  { to: '/app/issues?new=1', icon: 'scan', bn: 'লেবেল দিয়ে ইস্যু', en: 'Issue from label', perms: null, tone: 'r' },
  { to: '/app/issues?order=store', icon: 'box', bn: 'স্টোর / আইটি অর্ডার', en: 'Store / IT order', perms: null, tone: 'b' },
  { to: '/app/hub/attendance', icon: 'cal', bn: 'হাজিরা দিন', en: 'Attendance', perms: ['hr.attendance.create'], tone: 'g' },
  { to: '/app/hub/late', icon: 'clock', bn: 'দেরি লিখুন', en: 'Late', perms: ['hr.attendance.create'], tone: 'o' },
  { to: '/app/hub/pickup', icon: 'box', bn: 'পিকআপ যোগ', en: 'Pickup', perms: ['ops.pickup_as_hub_manager.create', 'ops.pickup_as_pickup_manager.create', 'ops.pickup_as_rider.create'], tone: 'b' },
  { to: '/app/hub/tasks', icon: 'tasks', bn: 'নতুন কাজ', en: 'New task', perms: ['zonal.task.create'], tone: 'p' },
  { to: '/app/accounts/khata', icon: 'ledger', bn: 'আজকের খাতা', en: 'My sheet today', perms: ['da.sheet.create'], tone: 'g' },
  { to: '/app/fleet?tab=approve', icon: 'truck', bn: 'গাড়ির অনুমোদন', en: 'Vehicle approvals', perms: ['vehicle.log.approve'], tone: 'o' },
  { to: '/app/accounts/mine?bill=1', icon: 'receipt', bn: 'আমার বিল', en: 'My bill', perms: null, tone: 'o' },
  { to: '/app/sorting/parcels', icon: 'truck', bn: 'পার্সেল এন্ট্রি', en: 'Parcels', perms: ['sorting.parcel.create'], tone: 'b' },
  { to: '/app/sorting/fuel', icon: 'cash', bn: 'তেলের রিকুয়েস্ট', en: 'Fuel request', perms: ['sorting.fuel.create'], tone: 'r' },
  { to: '/app/zonal/staff', icon: 'user', bn: 'নতুন কর্মী', en: 'New staff', perms: ['hr.application.create'], tone: 'p' },
  { to: '/app/office/assets', icon: 'grid', bn: 'অফিস রিসোর্স', en: 'Office item', perms: ['office.asset.edit'], tone: 'b' },
]

function roleClass(code: string) {
  if (code === 'super_admin' || code === 'admin') return 'rb-super'
  if (/zonal|zone|head_office|operations/.test(code)) return 'rb-zone'
  if (/hub|pickup|delivery/.test(code)) return 'rb-hub'
  if (/account|auditor/.test(code)) return 'rb-acct'
  return 'rb-self'
}

/** Page frame for every signed-in screen: grouped icon menu, top bar (search, alerts, language, theme, profile), title row. */
export function AppShell({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const { can, signOut, session, isSuperAdmin, menu } = useAuth()
  const { L, n, lang, setLang, theme, setTheme, nodiFab } = usePrefs()
  const [asRole, setAsRole] = useState(false)
  const nav = useNavigate()
  const user = session?.user.id ?? ''
  const name = (session?.user.user_metadata?.full_name as string | undefined) || session?.user.email || ''
  const [open, setOpen] = useState(false)
  // Sidebar size: phone = slide-in drawer; tablet = icon rail (opens on hover); PC = full, can be folded to a rail.
  const [sidePref, setSidePref] = useState<'full' | 'mini' | null>(() => { try { const v = localStorage.getItem('xzm_side'); return v === 'full' || v === 'mini' ? v : null } catch { return null } })
  const [tablet, setTablet] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(min-width:961px) and (max-width:1280px)').matches)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const m = matchMedia('(min-width:961px) and (max-width:1280px)'); const f = () => setTablet(m.matches)
    m.addEventListener?.('change', f); return () => m.removeEventListener?.('change', f)
  }, [])
  const mini = sidePref === 'mini' || (sidePref === null && tablet)
  const toggleMini = () => { const v = mini ? 'full' : 'mini'; setSidePref(v); try { localStorage.setItem('xzm_side', v) } catch { /* ignore */ } }
  // Drawer on phones: Esc closes, page behind does not scroll, swipe left closes.
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', k)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [open])
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const [q, setQ] = useState('')
  const [menuQ, setMenuQ] = useState('')
  const [pop, setPop] = useState<'bell' | 'me' | null>(null)
  const [quick, setQuick] = useState(false)
  const [mSearch, setMSearch] = useState(false)
  const [roles, setRoles] = useState<MyRole[]>([])
  const [photo, setPhoto] = useState<string | null>(null)
  const [cnt, setCnt] = useState<Record<CountKey, number>>({ apps: 0, leave: 0, sheets: 0, team: 0, hrreq: 0 })
  const nt = useNotices()
  const notes = nt.list
  const [dview, setDview] = useState<DashView | null>(getView())
  useEffect(() => {
    const f = (e: Event) => setDview((e as CustomEvent<DashView>).detail)
    window.addEventListener('xzm-view', f); return () => window.removeEventListener('xzm-view', f)
  }, [])
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(sessionStorage.getItem('xzm_ng') || '{}') } catch { return {} } })
  const popRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (user) { void myRoles(user).then(setRoles); void counts(user, can).then(setCnt) } }, [user, can])
  useEffect(() => { if (user) void myPhoto(user).then(setPhoto) }, [user])
  useEffect(() => { startNotices(user || null) }, [user])
  // Inside the app: phone push (needs the Firebase build of the APK; elsewhere nothing happens).
  useEffect(() => { if (user) void setupPush(savePushDevice, link => nav(link)) }, [user])
  // A new notification while the page is open: a short banner the person can tap.
  useEffect(() => { if (!nt.fresh) return; const t = window.setTimeout(clearFresh, 6000); return () => window.clearTimeout(t) }, [nt.fresh])
  useEffect(() => {
    if (!pop) return
    const f = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setPop(null) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null) }
    document.addEventListener('mousedown', f); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k) }
  }, [pop])
  const brand = useBrandText()
  useEffect(() => { document.title = `${title} · ${brand.name}` }, [title, brand.name])

  const loc = useLocation()
  const allowed = (p: string[] | null) => !p || p.some(x => can(x))
  const forMe = (i: Item) => allowed(i.perms) && inMenu(menu, i.to) && (panelLevel(can) === 2 || !ZONE_ONLY.includes(i.to)) && (!i.only || (i.only === 'web') === advancedAccessHere())
  const here = typeof location !== 'undefined' ? location.pathname : ''
  const mq = menuQ.trim().toLowerCase()
  const hit = (i: Item) => !mq || `${i.bn} ${i.en}`.toLowerCase().includes(mq)
  const top = roles[0]
  const scopeText = roles.length ? roles.map(r => `${r.name}${r.hub ? ` · ${r.hub}` : r.zone ? ` · ${r.zone}` : ''}`).join(' · ') : L('কোনো রোল নেই', 'No role')
  const alerts: Array<[string, number, string, string]> = ([
    ['/app/hr/applications', cnt.apps, L('আইডি আবেদন যাচাইয়ের অপেক্ষায়', 'ID applications waiting for review'), 'form'],
    ['/app/hr/leave', cnt.leave, L('ছুটির অনুরোধ অপেক্ষমাণ', 'Leave requests waiting'), 'log'],
    ['/app/accounts/daily', cnt.sheets, L('হিসাব খাতা যাচাইয়ের অপেক্ষায়', 'Daily sheets waiting for verification'), 'ledger'],
    ['/app/hr/requests?tab=list', cnt.hrreq, L('এইচআর রিকুয়েস্ট অপেক্ষমাণ', 'HR requests waiting'), 'form'],
  ] as Array<[string, number, string, string]>).filter(a => a[1] > 0)
  const unreadN = nt.unread
  const totalAlerts = alerts.reduce((a, x) => a + x[1], 0) + unreadN
  function openNotice(x: LiveNotice) {
    setPop(null); clearFresh(); void markRead([x.id])
    if (x.link) nav(x.link)
  }
  // Three panels, lowest first. A person sees the panels up to their own level; pages from a higher panel that their role
  // may open are listed in their own top panel, so a rider never gets a "manager" heading for one page.
  const level = panelLevel(can)
  const shown = GROUPS.map(g => ({ g, secs: g.secs.map(x => ({ ...x, items: x.items.filter(i => forMe(i)
    && (hit(i) || `${g.bn} ${g.en} ${x.bn} ${x.en}`.toLowerCase().includes(mq))) })).filter(x => x.items.length) }))
  for (let i = level + 1; i < shown.length; i++) { shown[level].secs.push(...shown[i].secs); shown[i].secs = [] }
  const accSecs = ACCOUNTS.secs.map(x => ({ ...x, items: x.items.filter(i => forMe(i) && (hit(i) || `${ACCOUNTS.bn} ${ACCOUNTS.en} ${x.bn} ${x.en}`.toLowerCase().includes(mq))) })).filter(x => x.items.length)
  const toggleGroup = (k: string, v: boolean) => { const g = { ...groupOpen, [k]: v }; setGroupOpen(g); try { sessionStorage.setItem('xzm_ng', JSON.stringify(g)) } catch { /* ignore */ } }
  // a link with ?tab=… / ?p=… is "on" only for that part; the page itself only when no part is picked
  const onLink = (to: string) => { const [p, q] = to.split('?'); if (loc.pathname !== p) return false
    const want = new URLSearchParams(q ?? ''), cur = new URLSearchParams(loc.search)
    return q ? [...want].every(([k, v]) => cur.get(k) === v) : !cur.get('tab') && !cur.get('p') }
  const link = (i: Item) => <NavLink key={i.to} to={i.to} end className={({ isActive }) => ((i.to.includes('?') || i.to.startsWith('/app/accounts/') ? onLink(i.to) : isActive) ? 'nl active' : 'nl')} title={L(i.bn, i.en)} onClick={() => setOpen(false)}><Icon name={i.icon} size={16} /><span className="t">{L(i.bn, i.en)}</span>
    {i.count && cnt[i.count] ? <span className="count">{n(cnt[i.count])}</span> : null}</NavLink>

  return <div className={`app-frame${mini ? ' side-mini' : ''}`}>
    <WfCountsHost />
    <aside className={`side no-print${open ? ' open' : ''}${mq ? ' searching' : ''}`} aria-label={L('মূল মেনু', 'Main menu')}
      onTouchStart={e => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
      onTouchEnd={e => { const s0 = swipe.current; swipe.current = null; if (!s0) return
        const dx = e.changedTouches[0].clientX - s0.x, dy = e.changedTouches[0].clientY - s0.y
        if (dx < -60 && Math.abs(dx) > Math.abs(dy) * 1.5) setOpen(false) }}>
      <div className="side-head">
        <Link to="/app" className="logo" onClick={() => setOpen(false)}><BrandName /></Link>
        <button type="button" className="side-fold" aria-label={mini ? L('মেনু বড় করুন', 'Expand menu') : L('মেনু ছোট করুন', 'Collapse menu')} title={mini ? L('মেনু বড় করুন', 'Expand menu') : L('মেনু ছোট করুন', 'Collapse menu')} onClick={e => { toggleMini(); e.currentTarget.blur() }}>
          <Icon name="chev" size={16} /></button>
        <button type="button" className="side-close" aria-label={L('মেনু বন্ধ', 'Close menu')} onClick={() => setOpen(false)}><Icon name="x" size={20} /></button>
      </div>
      <div className="side-user"><span className="avatar" aria-hidden="true">{(name || '?').slice(0, 2)}</span>
        <div style={{ minWidth: 0 }}><b>{name}</b><div style={{ marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {roles.slice(0, 2).map((r, i) => <span key={i} className={`rb ${roleClass(r.code)}`}><Icon name="shield" size={12} />{r.name}</span>)}</div></div></div>
      <PersonalMenu variant="side" onNavigate={() => setOpen(false)} />
      <input className="side-search" type="search" value={menuQ} onChange={e => setMenuQ(e.target.value)} placeholder={L('মেনু খুঁজুন…', 'Search menu…')} aria-label={L('মেনু খুঁজুন', 'Search menu')} />
      {HOME.filter(i => forMe(i) && hit(i)).map(link)}
      {[{ g: ACCOUNTS, secs: accSecs }, ...shown].map(({ g, secs }) => {
        const vis = secs.flatMap(x => x.items)
        if (!vis.length) return null
        const has = vis.some(i => i.to.split('?')[0] === here)
        const isOpen = groupOpen[g.key] ?? true
        const badge = vis.reduce((a, i) => a + (i.count && i.count !== 'team' ? cnt[i.count] : 0), 0)
        return <div key={g.key} className={`ngrp${isOpen ? ' open' : ''}${has ? ' has-on' : ''}`} data-panel={g.key}>
          <button type="button" className="ngh" aria-expanded={isOpen} title={L(g.bn, g.en)} onClick={() => toggleGroup(g.key, !isOpen)}>
            <span className="gi"><Icon name={g.icon} size={16} />{badge > 0 && !isOpen ? <span className="gdot">{n(badge)}</span> : null}</span>
            <span className="t">{L(g.bn, g.en)}</span><span className="chev"><Icon name="chev" size={14} /></span></button>
          <div className="ngi" onClick={() => setOpen(false)}>{secs.map((x, i) => <Fragment key={i}>
            {x.bn && <div className="nsec t">{L(x.bn, x.en)}</div>}{x.items.map(link)}</Fragment>)}</div>
        </div>
      })}
      <div className="side-foot">{L('এই রোল যা খুলতে পারে মেনুতে শুধু সেটাই দেখায়।', 'The menu shows only what your role may open.')}</div>
    </aside>
    <div className={`side-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
    <div className="app-main">
      <ViewAsBar onChange={() => setAsRole(true)} />
      <UpdateBar />
      <header className="top no-print">
        <button className="icon menu-btn" aria-label={L('মেনু', 'Menu')} aria-expanded={open} onClick={() => setOpen(o => !o)}><Icon name="menu" /></button>
        {here !== '/app' && <button className="icon back-btn" aria-label={L('পেছনে', 'Back')} onClick={() => history.length > 1 ? nav(-1) : nav('/app')}><Icon name="back" /></button>}
        <div className="top-title"><b>{title}</b>{subtitle && <span>{subtitle}</span>}</div>
        <form className={`search${mSearch ? ' m-open' : ''}`} role="search" onSubmit={e => { e.preventDefault(); if (q.trim()) { setMSearch(false); nav(`/app/hr/employees?q=${encodeURIComponent(q.trim())}`) } }}>
          <Icon name="search" size={16} /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('কর্মীর নাম, আইডি বা মোবাইল খুঁজুন…', 'Search employee name, ID or mobile…')} aria-label={L('খুঁজুন', 'Search')} />
        </form>
        <span className="spacer" />
        <button className="quick-btn" aria-label={L('দ্রুত যোগ করুন', 'Quick add')} onClick={() => setQuick(true)}><Icon name="plus" size={22} /></button>
        <button className="icon search-btn" aria-label={L('খুঁজুন', 'Search')} onClick={() => setMSearch(v => !v)}><Icon name="search" /></button>
        <div className="rel" ref={pop === 'bell' ? popRef : undefined}>
          <button className="icon" aria-label={L('নোটিফিকেশন', 'Notifications')} onClick={() => setPop(pop === 'bell' ? null : 'bell')}><Icon name="bell" />
            {totalAlerts > 0 && <span className="dotn">{n(totalAlerts)}</span>}</button>
          {pop === 'bell' && <div className="top-pop" role="menu"><div className="hd">{L('অপেক্ষমাণ কাজ', 'Waiting for you')}</div>
            {alerts.length ? alerts.map(([to, c, t, ic]) => <Link key={to} to={to} onClick={() => setPop(null)}><Icon name={ic} size={16} /><span style={{ flex: 1 }}>{t}</span><span className="count">{n(c)}</span></Link>)
              : <div className="muted small" style={{ padding: '6px 10px' }}>{L('এখন কিছু অপেক্ষমাণ নেই', 'Nothing waiting right now')}</div>}
            <><div className="hd nt-hd">{L('নোটিফিকেশন', 'Notifications')}{nt.live && <span className="nt-live" title={L('লাইভ', 'Live')} />}
              {unreadN > 0 && <button className="link small" onClick={() => void markAllRead()}>{L('সব পড়া হয়েছে', 'Mark all read')}</button>}</div>
              {!notes.length && <div className="muted small" style={{ padding: '6px 10px' }}>{L('কোনো নোটিফিকেশন নেই', 'No notifications')}</div>}
              <div className="nt-list">{notes.slice(0, 8).map(x => <button key={x.id} className={`nt-item${x.read_at ? '' : ' new'}`} onClick={() => openNotice(x)}>
                <span className="nt-ic"><Icon name={kindOf(x.kind)[2]} size={15} /></span><span style={{ flex: 1, minWidth: 0 }}><b>{x.title}</b>{x.body && <small>{x.body}</small>}
                <small className="muted">{new Date(x.created_at).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></span>{!x.read_at && <span className="nt-dot" />}</button>)}</div>
              <Link to="/app/notifications" className="nt-all" onClick={() => setPop(null)}>{L('সব নোটিফিকেশন দেখুন', 'See all notifications')} →</Link></>
          </div>}
        </div>
        <button className="secondary sm hide-sm" onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')} aria-label="Language"><Icon name="globe" size={15} />{lang === 'bn' ? 'English' : 'বাংলা'}</button>
        <button className="icon hide-sm" aria-label={L('ডার্ক / লাইট মোড', 'Dark / light mode')} onClick={() => setTheme(isDark(theme) ? 'light' : 'dark')}><Icon name="sun" /></button>
        <div className="rel" ref={pop === 'me' ? popRef : undefined}>
          <button className={`avatar-btn${pop === 'me' ? ' on' : ''}`} aria-label={L('প্রোফাইল মেনু', 'Profile menu')} aria-haspopup="menu" aria-expanded={pop === 'me'} onClick={() => setPop(pop === 'me' ? null : 'me')}>
            {photo ? <img src={photo} alt="" onError={() => setPhoto(null)} /> : <span>{(name || '?').slice(0, 2).toUpperCase()}</span>}</button>
          {pop === 'me' && <div className="top-pop me-pop" role="menu">
            <div className="me-head"><span className="me-av">{photo ? <img src={photo} alt="" /> : (name || '?').slice(0, 2).toUpperCase()}</span>
              <div style={{ minWidth: 0 }}><b>{name}</b><div className="muted small">{top ? scopeText : L('কোনো রোল নেই', 'No role')}</div></div></div>
            <Link to="/app/me" role="menuitem" onClick={() => setPop(null)}><Icon name="user" size={20} />{L('প্রোফাইল', 'Profile')}</Link>
            <Link to="/app/me/permissions" role="menuitem" onClick={() => setPop(null)}><Icon name="key" size={20} />{L('আমার অনুমতি', 'My Permissions')}</Link>
            <Link to="/app/settings" role="menuitem" onClick={() => setPop(null)}><Icon name="gear" size={20} />{L('সেটিং', 'Setting')}</Link>
            {isSuperAdmin && <button className="mi" role="menuitem" onClick={() => { setPop(null); setAsRole(true) }}><Icon name="shield" size={20} />{L('রোল হিসেবে দেখুন', 'View as a role')}</button>}
            <hr />
            <button className="mi" role="menuitem" onClick={() => void signOut()}><Icon name="out" size={20} />{L('লগআউট', 'Logout')}</button>
          </div>}
        </div>
      </header>
      <div className="scope-bar no-print"><strong>{L('কাজ করছেন:', 'Acting as:')}</strong> {scopeText} <span className="muted">— {L('এর বাইরের তথ্য দেখানো হয় না', 'data outside this scope is not shown')}</span></div>
      <main className="da-main">
        <PulsePopup user={user} />
        <div className="da-head"><div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
          {actions && <div className="da-actions no-print">{actions}</div>}</div>
        {children}
      </main>
    </div>
    {nt.fresh && <button type="button" className="nt-toast no-print" onClick={() => openNotice(nt.fresh!)} aria-live="polite">
      <span className="nt-ic"><Icon name={kindOf(nt.fresh.kind)[2]} size={18} /></span>
      <span className="nt-toast-t"><b>{nt.fresh.title}</b>{nt.fresh.body && <small>{nt.fresh.body}</small>}</span>
      <span className="nt-x" role="button" aria-label={L('বন্ধ', 'Close')} onClick={e => { e.stopPropagation(); clearFresh() }}><Icon name="x" size={14} /></span></button>}
    {nodiFab && can('nodi.assistant.view') && level === 2 && !/^\/app\/nodi\/chat/.test(here) && <NavLink to="/app/nodi/chat" className="nodi-fab no-print" aria-label="নদী AI" title="নদী AI"><NodiAvatar size={52} /></NavLink>}
    <nav className="bottom-nav no-print" aria-label={L('প্রধান মেনু', 'Main tabs')}>
      {(dview ? VIEW_TABS[dview] : TABS).map(t => level === 0 && t.to === '/app/staff' ? PROFILE_TAB : t).filter(t => allowed(t.perms) && inMenu(menu, t.to)).slice(0, 4).map(t => <NavLink key={t.to} to={t.to} end={t.to === '/app'}
        className={() => new RegExp('^' + t.match).test(here) ? 'bn-item on' : 'bn-item'}><Icon name={t.icon} size={22} /><span>{L(t.bn, t.en)}</span></NavLink>)}
      <button type="button" className={`bn-item${open ? ' on' : ''}`} onClick={() => setOpen(true)}><span className="rel"><Icon name="menu" size={22} />{totalAlerts > 0 && <span className="bn-dot" />}</span><span>{L('আরও', 'More')}</span></button>
    </nav>
    {asRole && <ViewAsPicker onClose={() => setAsRole(false)} />}
    {quick && <div className="sheet-bg no-print" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setQuick(false) }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={L('দ্রুত যোগ করুন', 'Quick add')}>
        <div className="sheet-grab" /><div className="sheet-hd"><b>{L('দ্রুত কাজ', 'Quick actions')}</b><button className="icon" aria-label={L('বন্ধ', 'Close')} onClick={() => setQuick(false)}><Icon name="x" /></button></div>
        <div className="quick-grid">{QUICK.filter(x => allowed(x.perms) && inMenu(menu, x.to)).map(x => <Link key={x.to + x.bn} to={x.to} className={`quick-tile t-${x.tone}`} onClick={() => setQuick(false)}>
          <span className="qi"><Icon name={x.icon} size={24} /></span><span>{L(x.bn, x.en)}</span></Link>)}</div>
      </div>
    </div>}
  </div>
}
