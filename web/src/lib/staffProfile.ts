// কর্মীর কাজের প্রোফাইল — typed calls to staff_profile_people / staff_profile_get (migration 20261124000300_staff_work_profile).
// The database decides who may see the person and each line; this file only calls it.
import { supabase } from './supabase'
import { HrError } from './hr'
import type { IsoDate } from './workforce'

export type WorkModule = 'morning' | 'attendance' | 'route' | 'daily_ops' | 'hub_ops' | 'sorting' | 'issues' | 'fleet' | 'accounts' | 'other'
export type WorkStatus = 'draft' | 'submitted' | 'approved' | 'cancelled'
export type ProfilePerson = { id: string; code: string | null; name: string; post: string | null; status: string }
export type WorkEvent = { id: string; date: IsoDate; module: WorkModule; activity: string; status: WorkStatus; hub_id: string | null; hub: string | null
  source_id: string; version: number; detail: Record<string, unknown>; server_time: string; link: string | null }
export type ModuleCount = { module: WorkModule; submitted: number; draft: number; cancelled: number; last_at: string | null }
export type AttendanceDay = { date: IsoDate; hub_id: string; hub: string | null; status: string | null; sheet_status: 'draft' | 'submitted'; version: number; late_time: string | null
  absence_reason: string | null; unauthorized: boolean; leave_ref: string | null; leave_applied_on: IsoDate | null; online_marked: boolean | null; online_at: string | null; mode: 'manager' | 'auto' | null }
export type StaffProfile = {
  from: IsoDate; to: IsoDate; today: IsoDate
  person: { id: string; code: string | null; name: string; name_bn: string | null; status: string; joining_date: IsoDate | null; position_id: string | null; position: string | null
    department: string | null; hub_id: string | null; hub: string | null; zone_id: string | null; zone: string | null; manager: string | null; has_login: boolean
    focus: null | { code: string; label: string; color: string } }
  assignments: Array<{ type: string; from: IsoDate; to: IsoDate | null; position: string | null; hub: string | null; zone: string | null; reason: string | null }>
  duties: Array<{ id: string; title: string; details: string | null; frequency: string | null; source: 'person' | 'post' }>
  attendance: { days: AttendanceDay[]; present: number; late: number; absent: number; unauthorized: number; leave: number; off: number; unchecked: number; drafts: number }
  leave: null | Array<{ ref: string; from: IsoDate; to: IsoDate; days: number; status: string; applied_on: IsoDate }>
  routes: Array<{ route_id: string; code: string; name: string; hub: string | null; from: IsoDate; to: IsoDate | null }>
  backup: boolean
  modules: ModuleCount[]; events: WorkEvent[]; connected: WorkModule[]
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

export const staffProfile = {
  people: (hub: string) => rpc<ProfilePerson[]>('staff_profile_people', { p_hub: hub }),
  get: (employee: string, from?: IsoDate | null, to?: IsoDate | null) => rpc<StaffProfile>('staff_profile_get', { p_employee: employee, p_from: from ?? null, p_to: to ?? null }),
}

export const MODULE_LABEL: Record<WorkModule, [string, string]> = {
  morning: ['সকালের জনবল', 'Morning input'], attendance: ['দৈনিক হাজিরা খাতা', 'Daily register'], route: ['রুট প্ল্যান', 'Route plan'],
  daily_ops: ['দৈনিক সংখ্যা (পিকআপ/ডেলিভারি)', 'Daily numbers'], hub_ops: ['হাব অপারেশন', 'Hub operations'], sorting: ['সোর্টিং', 'Sorting'],
  issues: ['সমস্যা কেন্দ্র', 'Problem Center'], fleet: ['গাড়ি / জ্বালানি', 'Vehicle / fuel'], accounts: ['হিসাব', 'Accounts'], other: ['অন্যান্য', 'Other'],
}
export const FIELD_MODULES: WorkModule[] = ['morning', 'route', 'daily_ops', 'hub_ops', 'sorting']
export const FUTURE_MODULES: WorkModule[] = ['issues', 'fleet', 'accounts', 'other']
export const STATUS_LABEL: Record<WorkStatus, [string, string]> = {
  draft: ['খসড়া', 'Draft'], submitted: ['জমা', 'Submitted'], approved: ['অনুমোদিত', 'Approved'], cancelled: ['বাতিল', 'Cancelled'],
}
export const ACTIVITY_LABEL: Record<string, [string, string]> = {
  morning_present: ['সকালে এসেছে', 'Came in the morning'], morning_absent: ['সকালে আসেনি', 'Did not come'], morning_leave: ['অনুমোদিত ছুটি', 'On approved leave'], morning_unknown: ['সকালে যাচাই বাকি', 'Not checked'],
  present: ['উপস্থিত', 'Present'], late: ['দেরিতে', 'Late'], half_day: ['অর্ধদিবস', 'Half day'], absent: ['অনুপস্থিত', 'Absent'], leave: ['ছুটি', 'Leave'], holiday: ['সরকারি ছুটি', 'Holiday'],
  weekly_off: ['সাপ্তাহিক ছুটি', 'Weekly off'], pending_leave: ['ছুটির আবেদন বিচারাধীন', 'Leave request waiting'], unchecked: ['যাচাই বাকি', 'Not checked'],
  route_assigned: ['রুট বরাদ্দ', 'Route assigned'], route_cancelled: ['রুট বরাদ্দ বাতিল', 'Route cancelled'], daily_numbers: ['দৈনিক সংখ্যা', 'Daily numbers'],
  driver_run: ['ড্রাইভারের ট্রিপ', 'Driver run'], handover_hub_to_sorting: ['হাব থেকে সোর্টিংয়ে হস্তান্তর', 'Handover to sorting'], handover_sorting_to_hub: ['সোর্টিং থেকে হাবে হস্তান্তর', 'Handover to hub'],
  drive_hub_to_sorting: ['হাব থেকে সোর্টিংয়ে গাড়ি চালানো', 'Drove to sorting'], drive_sorting_to_hub: ['সোর্টিং থেকে হাবে গাড়ি চালানো', 'Drove to hub'], hub_ops_row: ['হাব অপারেশন রিপোর্টে', 'On the hub report'],
  hub_ops_present: ['হাব রিপোর্টে উপস্থিত', 'Present on the hub report'], hub_ops_absent: ['হাব রিপোর্টে অনুপস্থিত', 'Absent on the hub report'],
  hub_ops_leave_applied: ['হাব রিপোর্টে ছুটি (আবেদনসহ)', 'Leave on the hub report'], hub_ops_leave_not_applied: ['হাব রিপোর্টে ছুটি (আবেদন ছাড়া)', 'Leave, no application'],
}
