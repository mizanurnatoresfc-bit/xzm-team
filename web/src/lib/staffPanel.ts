// স্টাফ প্যানেল (/app/staff): its sections, and the per-role order the Super Admin sets (role_dashboards.staff_sections).
import { supabase } from './supabase'
import { HrError } from './hr'

export type StaffSection = 'accounts' | 'work' | 'attendance' | 'bill' | 'route' | 'complaint' | 'issues' | 'people'

/** The standard page, in its standard order: [key, name bn, name en, what it holds bn, en]. */
export const STAFF_SECTIONS: Array<[StaffSection, string, string, string, string]> = [
  ['accounts', 'আমার হিসাব', 'My accounts', 'আজকের হিসাব খাতায় উঠেছে কিনা; আগের হিসাব', "Whether today's line is on the sheet; earlier accounts"],
  ['work', 'পিকআপ ও ডেলিভারি খাতা', 'Pickup & delivery khata', 'পিকআপ, মার্চেন্টকে রিটার্ন, ডেলিভারি, ডেলিভারি রিটার্ন ও টাকা — ম্যানেজারের খাতায়', "Pickup, returns to merchants, delivery, delivery return and money — to the manager's khata"],
  ['attendance', 'আজকের হাজিরা', "Today's attendance", 'হাজিরা দেওয়া, আজ আসব না, ছুটির আবেদন', 'Give attendance, not coming, apply for leave'],
  ['bill', 'আমার বিল', 'My bill', 'খরচের বিল দেওয়া ও বিলের অবস্থা', 'Put up a bill and see where it is'],
  ['route', 'আমার রুট ও দায়িত্ব', 'My route & duties', 'রুটের এলাকা, দায়িত্ব, আমার গাড়ি', 'Route areas, duties, my vehicle'],
  ['complaint', 'আমার অভিযোগ', 'My complaint', 'অভিযোগ জানানো ও আগের অভিযোগ', 'Make a complaint and see earlier ones'],
  ['issues', 'ইস্যু ও যোগাযোগ', 'Issues & contact', 'আমাকে দেওয়া ইস্যু, হাব গ্রুপ, জোন', 'Issues given to me, hub group, zone'],
  ['people', 'আমার লোক', 'My people', 'হাতে লোক আছে, আমি যাদের দিয়েছি', 'People in hand, people I brought'],
]
export const STAFF_DEFAULT: StaffSection[] = STAFF_SECTIONS.map(s => s[0])
export const staffSectionName = (k: StaffSection, lang: string) => { const s = STAFF_SECTIONS.find(x => x[0] === k); return s ? (lang === 'bn' ? s[1] : s[2]) : k }

const fail = (e: { message: string; code?: string } | null) => { if (e) throw new HrError(e.message, e.code) }

export const staffPanel = {
  /** The signed-in person's sections, or null for the standard page. */
  mine: async (): Promise<StaffSection[] | null> => {
    const { data, error } = await supabase.rpc('staff_panel_sections')
    if (error) return null   // never block the page on this: fall back to the standard one
    const l = (data ?? null) as StaffSection[] | null
    return l && l.length ? l.filter(k => STAFF_DEFAULT.includes(k)) : null
  },
  /** Every role's setting (null = standard). Read straight from the table, which everyone with a role may read. */
  byRole: async (): Promise<Record<string, StaffSection[] | null>> => {
    const { data, error } = await supabase.from('role_dashboards').select('role_id, staff_sections'); fail(error)
    return Object.fromEntries(((data ?? []) as Array<{ role_id: string; staff_sections: StaffSection[] | null }>).map(r => [r.role_id, r.staff_sections ? r.staff_sections.filter(k => STAFF_DEFAULT.includes(k)) : null]))
  },
  /** Super Admin: set a role's sections, or null to go back to the standard page. */
  save: async (role: string, sections: StaffSection[] | null) => {
    const { error } = await supabase.rpc('role_staff_sections_save', { p_role: role, p_sections: sections }); fail(error)
  },
}
