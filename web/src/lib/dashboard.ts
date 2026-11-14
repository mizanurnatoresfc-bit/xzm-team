// The home dashboard: which panels a person sees (from their roles) and the numbers in them.
import { supabase } from './supabase'
import { HrError } from './hr'

export type PanelCode = 'my_work' | 'hr_overview' | 'hr_pending' | 'hub_staff' | 'ops_today'
  | 'cash_today' | 'accounts_today' | 'zonal_overview' | 'quick_links'

export type HubStaffRow = { hub_id: string; hub: string; zone: string; total: number; active: number; inactive: number; applicant: number }
export type Home = {
  panels: PanelCode[]
  today: string
  me: { employee_code: string | null; name: string; hub: string | null; zone: string | null; position: string | null } | null
  my_work?: { tasks_open: number; tasks_due: number; tasks_to_check: number; leave_pending: number; marked_today: boolean }
  hr_overview?: { total: number; active: number; inactive: number; applicant: number; joined_30d: number; left_30d: number }
  hr_pending?: { applications: number; leave: number; salary: number; documents: number }
  hub_staff?: HubStaffRow[]
  ops_today?: { at_hub: number; out_for_delivery: number; received_today: number; pickups_waiting: number; deliveries_waiting: number; issues_open: number }
  cash_today?: { handovers_waiting: number; expenses_waiting: number; payments_waiting: number; recons_waiting: number; collected_today: number }
  accounts_today?: { open: number; submitted: number; correction: number; approved: number; hubs: number }
  zonal_overview?: { zones: number; hubs: number; staff: number; tasks_open: number; tasks_overdue: number; claims_waiting: number; metrics_waiting: number }
}
export type RoleDashboard = { role_id: string; code: string; name: string; name_bn: string | null; is_super: boolean; panels: PanelCode[]; user_count: number }

const fail = (e: { message: string; code?: string } | null) => { if (e) throw new HrError(e.message, e.code) }

export const dashboard = {
  home: async (): Promise<Home> => {
    const { data, error } = await supabase.rpc('dashboard_home'); fail(error); return data as Home
  },
  roleLayouts: async (): Promise<RoleDashboard[]> => {
    const { data, error } = await supabase.rpc('role_dashboard_list'); fail(error); return (data ?? []) as RoleDashboard[]
  },
  saveRoleLayout: async (role: string, panels: PanelCode[]) => {
    const { error } = await supabase.rpc('role_dashboard_save', { p_role: role, p_panels: panels }); fail(error)
  },
}

/** Every panel, in the order the dashboard shows them, with what it is for. */
export const PANELS: Array<[PanelCode, bn: string, en: string, note_bn: string, note_en: string]> = [
  ['my_work', 'আমার কাজ', 'My work', 'নিজের দায়িত্ব, ছুটি ও আজকের হাজিরা', 'Your own tasks, leave and today’s attendance'],
  ['hr_overview', 'কর্মীর হিসাব', 'Staff figures', 'মোট, সক্রিয়, নতুন যোগদান, বিদায়', 'Total, active, new joiners, leavers'],
  ['hr_pending', 'HR-এ অপেক্ষায়', 'Waiting in HR', 'আবেদন, ছুটি, বেতন ও ডকুমেন্ট যাচাই', 'Applications, leave, salary and documents'],
  ['hub_staff', 'হাব অনুযায়ী কর্মী', 'Staff by hub', 'প্রতি হাবে কতজন', 'How many in each hub'],
  ['ops_today', 'আজকের অপারেশন', 'Operations today', 'পার্সেল, পিকআপ, ডেলিভারি, সমস্যা', 'Parcels, pickups, deliveries, issues'],
  ['cash_today', 'টাকার হিসাব', 'Cash', 'হ্যান্ডওভার, খরচ, মার্চেন্ট পেমেন্ট', 'Handovers, expenses, merchant payments'],
  ['accounts_today', 'আজকের হিসাব খাতা', 'Daily accounts', 'কোন হাবের খাতা খোলা, জমা বা অনুমোদিত', 'Which hub sheets are open, submitted or approved'],
  ['zonal_overview', 'জোনের চিত্র', 'Zone overview', 'জোন, হাব, কর্মী, দায়িত্ব, দাবি', 'Zones, hubs, staff, tasks, claims'],
  ['quick_links', 'দ্রুত যাওয়া', 'Quick links', 'অনুমতি অনুযায়ী পাতার কার্ড', 'Cards for the pages you may open'],
]

export const panelLabel = (p: string, lang: string) => {
  const hit = PANELS.find(x => x[0] === p)
  return hit ? (lang === 'bn' ? hit[1] : hit[2]) : p
}
export const panelNote = (p: string, lang: string) => {
  const hit = PANELS.find(x => x[0] === p)
  return hit ? (lang === 'bn' ? hit[3] : hit[4]) : ''
}

const BN: Array<[RegExp, string]> = [
  [/Only a Super Admin/i, 'শুধু সুপার অ্যাডমিন রোলের ড্যাশবোর্ড ঠিক করতে পারেন'],
  [/Unknown dashboard panel/i, 'এই নামের কোনো প্যানেল নেই'],
  [/listed twice/i, 'একই প্যানেল দুবার দেওয়া যায় না'],
  [/Role not found/i, 'রোলটি পাওয়া যায়নি'],
  [/not authori[sz]ed|permission denied|42501/i, 'এই কাজের অনুমতি আপনার নেই'],
]
export function dashboardFriendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const hit = BN.find(([re]) => re.test(msg))
  return hit ? `${hit[1]}। (${msg})` : msg
}
