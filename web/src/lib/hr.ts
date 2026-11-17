// Organisation + HR data access. Reads go through RLS-protected tables (each user only
// sees their own zone/hub); every change of state goes through a database function that
// checks permission, keeps history and writes the audit log.
import { supabase } from './supabase'

export class HrError extends Error {
  code?: string
  constructor(message: string, code?: string) { super(message); this.code = code }
}
function fail(error: { message: string; code?: string } | null): void {
  if (error) throw new HrError(error.message, error.code)
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args); fail(error); return data as T
}

// ---------- types ----------
export type Org = { id: string; code: string; name: string; name_bn: string | null; phone: string | null; head_office_address: string | null }
export type Zone = { id: string; organization_id: string; code: string; name: string; name_bn: string | null; phone: string | null; address: string | null; status: string; archived_at: string | null; region_id?: string | null }
export type Hub = { id: string; zone_id: string; sorting_center_id?: string | null; code: string; name: string; name_bn: string | null; phone: string | null; address: string | null; status: string; archived_at: string | null
  latitude?: number | string | null; longitude?: number | string | null; hub_type?: string | null; ops_zone?: string | null }
/** A hub as people know it: name + its number code ("Natore #80"). Text codes are not shown. */
/** Codes are only typed for hubs; everywhere else the system makes one from the name (unique, never shown). */
export function autoCode(name: string, keep?: string | null): string {
  if (keep) return keep
  const base = (name || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 10) || 'X'
  return `${base}-${Date.now().toString(36).slice(-4).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`
}
export function hubLabel(h: { name: string; code?: string | null }): string {
  return h.code && /^\d+$/.test(String(h.code).trim()) ? `${h.name} #${String(h.code).trim()}` : h.name
}
export type Department = { id: string; organization_id: string; code: string; name: string; name_bn: string | null; status: string; archived_at: string | null }
export type Position = { id: string; department_id: string; code: string; name: string; name_bn: string | null; status: string; archived_at: string | null; level?: 'hub' | 'zone' | 'head_office'; focus_options?: WorkFocus[]
  /** The role a login made for this post gets. */ default_role_id?: string | null }
export type WorkFocus = { code: string; label: string; label_bn: string; color: string }
export type EmployeeStatus = 'applicant' | 'active' | 'inactive' | 'resigned' | 'terminated' | 'rejected'
export type Employee = {
  id: string; employee_code: string | null; full_name: string; full_name_bn: string | null; mobile: string | null; email: string | null
  emergency_contact_name: string | null; emergency_contact_phone: string | null; emergency_contact_relation: string | null; reference_info: string | null
  department_id: string | null; position_id: string | null; zone_id: string | null; hub_id: string | null; reporting_manager_id: string | null
  joining_date: string | null; work_focus?: string | null; status: EmployeeStatus; status_since: string | null; archived_at: string | null; profile_id: string | null; created_at: string; updated_at: string
}
export type Application = { id: string; employee_id: string; status: 'draft' | 'submitted' | 'returned' | 'approved' | 'rejected'
  submitted_at: string | null; reviewed_at: string | null; review_note: string | null; created_at: string; created_by: string | null }
export type Assignment = { id: string; change_type: string; department_id: string | null; position_id: string | null; zone_id: string | null; hub_id: string | null
  effective_from: string; effective_to: string | null; reason: string | null }
export type StatusChange = { id: string; from_status: string | null; to_status: string; effective_date: string; reason: string | null }
export type LeaveType = { id: string; code: string; name: string; name_bn: string | null; is_paid: boolean; annual_quota: number; status: string }
export type LeaveRequest = { id: string; employee_id: string; leave_type_id: string; from_date: string; to_date: string; days: number; reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; decision_note: string | null; decided_at: string | null; created_at: string }
export type AttendanceStatus = 'present' | 'late' | 'half_day' | 'absent' | 'leave' | 'holiday' | 'weekly_off'
export type AttendanceRow = { id: string; employee_id: string; work_date: string; status: AttendanceStatus; note: string | null; source: string }
export type AttendanceSummary = { employee_id: string; employee_code: string; full_name: string; present: number; late: number; half_day: number
  absent: number; leave: number; holiday: number; weekly_off: number; not_recorded: number }
export type HrDashboard = Record<string, number | Record<string, number>>

// ---------- labels ----------
export const EMP_STATUS: Record<EmployeeStatus, [string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = {
  applicant: ['আবেদনকারী', 'info'], active: ['সক্রিয়', 'ok'], inactive: ['নিষ্ক্রিয়', 'warn'],
  resigned: ['চাকরি ছেড়েছেন', 'neutral'], terminated: ['অব্যাহতি', 'bad'], rejected: ['আবেদন বাতিল', 'neutral'],
}
export const APP_STATUS: Record<Application['status'], [string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = {
  draft: ['খসড়া', 'neutral'], submitted: ['যাচাইয়ের অপেক্ষায়', 'warn'], returned: ['সংশোধনে ফেরত', 'info'],
  approved: ['অনুমোদিত', 'ok'], rejected: ['বাতিল', 'bad'],
}
export const LEAVE_STATUS: Record<LeaveRequest['status'], [string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = {
  pending: ['অপেক্ষমাণ', 'warn'], approved: ['অনুমোদিত', 'ok'], rejected: ['বাতিল', 'bad'], cancelled: ['প্রত্যাহার', 'neutral'],
}
export const ATT_STATUS: Record<AttendanceStatus, string> = {
  present: 'উপস্থিত', late: 'দেরিতে', half_day: 'অর্ধদিবস', absent: 'অনুপস্থিত', leave: 'ছুটি', holiday: 'ছুটির দিন', weekly_off: 'সাপ্তাহিক ছুটি',
}
export const CHANGE_TYPE: Record<string, string> = { joining: 'যোগদান', transfer: 'বদলি', promotion: 'পদোন্নতি', correction: 'সংশোধন', exit: 'বিদায়' }
export const MISSING: Record<string, string> = {
  full_name: 'পূর্ণ নাম', mobile: 'মোবাইল', hub: 'হাব', hub_id: 'হাব', department: 'বিভাগ', department_id: 'বিভাগ', position: 'পদবি', position_id: 'পদবি',
  joining_date: 'যোগদানের তারিখ', nid: 'এনআইডি', nid_number: 'এনআইডি', date_of_birth: 'জন্মতারিখ', photo: 'ছবি', emergency_contact: 'জরুরি যোগাযোগ',
  emergency_contact_name: 'জরুরি যোগাযোগের নাম', emergency_contact_phone: 'জরুরি যোগাযোগের নম্বর', present_address: 'বর্তমান ঠিকানা',
  permanent_address: 'স্থায়ী ঠিকানা', email: 'Gmail (অ্যাডমিন পদ)', reference: 'রেফারেন্স (নাম ও আইডি)', basic_salary: 'বেতন (Basic)',
  'field:alt_mobile': 'বিকল্প মোবাইল', 'field:blood_group': 'রক্তের গ্রুপ',
  'document:photo': 'কর্মীর ছবি', 'document:nid_front': 'এনআইডি সামনের ছবি', 'document:nid_back': 'এনআইডি পেছনের ছবি',
}
export type ProfileGap = { employee_id: string; employee_code: string | null; full_name: string; status: string; hub_id: string | null
  hub_name: string | null; position_name: string | null; position_name_bn: string | null; missing: string[]; total_checks: number }

const BN: Array<[RegExp, string]> = [
  [/not authori[sz]ed|permission denied|42501|row-level security/i, 'এই কাজের অনুমতি আপনার নেই'],
  [/duplicate key|already exists|unique/i, 'এই তথ্য আগে থেকেই আছে (একই কোড/আইডি দুবার দেওয়া যায় না)'],
  [/Employee ID|employee_code|pattern/i, 'এমপ্লয়ি আইডি সঠিক নয় — ১ থেকে শুরু হওয়া সংখ্যা দিন (যেমন ১৪)'],
  [/mobile/i, 'মোবাইল নম্বর সঠিক নয় (যেমন 01711000000)'],
  [/future date/i, 'ভবিষ্যতের তারিখ দেওয়া যাবে না'],
  [/cannot be archived/i, 'সক্রিয় কর্মী বা খোলা আবেদন সরানো যায় না — আগে “চাকরি ছেড়েছেন” বা “অব্যাহতি” করুন'],
  [/already marked/i, 'সেই দিনের হাজিরা আগে থেকেই দেওয়া আছে — আগে হাজিরার পাতায় ঠিক করুন'],
  [/pending salary proposal/i, 'এই কর্মীর একটি বেতন প্রস্তাব আগে থেকেই অপেক্ষমাণ'],
  [/missing|required|cannot be submitted/i, 'প্রয়োজনীয় তথ্য বাকি আছে'],
  [/reason|note/i, 'কারণ/নোট লিখুন'],
  [/overlap/i, 'এই সময়ের সাথে আরেকটি অনুরোধ মিলে যাচ্ছে'],
  [/maker|checker|own/i, 'নিজের তৈরি অনুরোধ নিজে অনুমোদন করা যায় না'],
  [/locked/i, 'এটি লক করা — আর পরিবর্তন করা যাবে না'],
]
export function hrFriendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  const hit = BN.find(([re]) => re.test(msg))
  return hit ? `${hit[1]}। (${msg})` : msg
}

// ---------- organisation ----------
async function list<T>(table: string, order = 'name', archived = false): Promise<T[]> {
  let q = supabase.from(table).select('*').order(order)
  if (!archived) q = q.is('archived_at', null)
  const { data, error } = await q; fail(error); return (data ?? []) as T[]
}
export const org = {
  organizations: () => list<Org>('organizations'),
  zones: (archived = false) => list<Zone>('zones', 'name', archived),
  hubs: (archived = false) => list<Hub>('hubs', 'name', archived),
  departments: (archived = false) => list<Department>('departments', 'name', archived),
  positions: (archived = false) => list<Position>('positions', 'sort_order', archived),
  insert: async (table: 'organizations' | 'regions' | 'zones' | 'hubs' | 'departments' | 'positions', row: Record<string, unknown>) => {
    const { error } = await supabase.from(table).insert(row); fail(error)
  },
  update: async (table: 'organizations' | 'regions' | 'zones' | 'hubs' | 'departments' | 'positions', id: string, row: Record<string, unknown>) => {
    const { error } = await supabase.from(table).update(row).eq('id', id); fail(error)
  },
  archive: (table: 'regions' | 'zones' | 'hubs' | 'departments' | 'positions', id: string, reason: string) =>
    rpc<void>('archive_org_unit', { p_table: table, p_id: id, p_reason: reason }),
}

// ---------- employees ----------
export const hr = {
  setWorkFocus: (employee: string, focus: string | null) => rpc<void>('hr_set_work_focus', { p_employee: employee, p_focus: focus ?? '' }),
  dashboard: (from: string, to: string, zone?: string | null, hub?: string | null) =>
    rpc<HrDashboard>('hr_dashboard', { p_from: from, p_to: to, p_zone: zone ?? null, p_hub: hub ?? null }),
  employees: async (opts: { q?: string; hub?: string; status?: string; limit?: number } = {}) => {
    let q = supabase.from('employees').select('*').is('archived_at', null).order('created_at', { ascending: false }).limit(opts.limit ?? 500)
    if (opts.hub) q = q.eq('hub_id', opts.hub)
    if (opts.status) q = q.eq('status', opts.status)
    if (opts.q) {
      const s = opts.q.replace(/[%,()]/g, ' ').trim()
      if (s) q = q.or(`full_name.ilike.%${s}%,employee_code.ilike.%${s}%,mobile.ilike.%${s}%`)
    }
    const { data, error } = await q; fail(error); return (data ?? []) as Employee[]
  },
  employee: async (id: string) => {
    const { data, error } = await supabase.from('employees').select('*').eq('id', id).maybeSingle(); fail(error); return data as Employee | null
  },
  updateEmployee: async (id: string, row: Partial<Employee>) => {
    const { error } = await supabase.from('employees').update(row).eq('id', id); fail(error)
  },
  sensitive: async (id: string) => {
    const { data, error } = await supabase.from('employee_sensitive').select('*').eq('employee_id', id).maybeSingle(); fail(error)
    return data as { nid_number: string | null; date_of_birth: string | null; father_name: string | null; mother_name: string | null; present_address: string | null; permanent_address: string | null } | null
  },
  saveSensitive: async (id: string, row: Record<string, unknown>) => {
    const { error } = await supabase.from('employee_sensitive').upsert({ employee_id: id, ...row }); fail(error)
  },
  assignments: async (id: string) => {
    const { data, error } = await supabase.from('employee_assignments').select('*').eq('employee_id', id).order('effective_from', { ascending: false }); fail(error)
    return (data ?? []) as Assignment[]
  },
  statusHistory: async (id: string) => {
    const { data, error } = await supabase.from('employee_status_history').select('*').eq('employee_id', id).order('effective_date', { ascending: false }); fail(error)
    return (data ?? []) as StatusChange[]
  },
  maskedNid: (id: string) => rpc<string | null>('hr_masked_nid', { p_employee: id }),
  reveal: (id: string, reason: string) => rpc<Array<Record<string, string | null>>>('hr_reveal_sensitive', { p_employee: id, p_reason: reason }),
  changeStatus: (id: string, status: string, effective: string, reason: string) =>
    rpc<void>('hr_change_status', { p_employee: id, p_status: status, p_effective: effective, p_reason: reason }),
  transfer: (id: string, a: { hub: string; department: string | null; position: string | null; manager: string | null; effective: string; reason: string; type: string }) =>
    rpc<void>('hr_transfer_employee', { p_employee: id, p_hub: a.hub, p_department: a.department, p_position: a.position, p_manager: a.manager,
      p_effective: a.effective, p_reason: a.reason, p_change_type: a.type }),
  archive: (id: string, reason: string) => rpc<void>('hr_archive_employee', { p_employee: id, p_reason: reason }),
  /** A record entered by mistake: leaves every list, frees its ID and mobile. Nothing is destroyed. */
  removeWrongEntry: (id: string, reason: string) => rpc<void>('hr_remove_wrong_entry', { p_employee: id, p_reason: reason }),
  /** The right person with the wrong Employee ID. */
  correctCode: (id: string, code: string, reason: string) => rpc<string>('hr_correct_employee_code', { p_employee: id, p_code: code, p_reason: reason }),
  /** IDs of the people on approved leave today. */
  onLeaveToday: async (): Promise<string[]> => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
    const { data, error } = await supabase.from('leave_requests').select('employee_id').eq('status', 'approved').lte('from_date', today).gte('to_date', today); fail(error)
    return [...new Set(((data ?? []) as Array<{ employee_id: string }>).map(r => r.employee_id))]
  },
  leaveBalance: (id: string, year: number) =>
    rpc<Array<{ leave_type: string; quota: number; used: number; pending: number; remaining: number }>>('hr_leave_balance', { p_employee: id, p_year: year }),

  // applications
  startApplication: (a: { name: string; mobile: string; hub: string; department: string | null; position: string | null }) =>
    rpc<string>('hr_start_application', { p_full_name: a.name, p_mobile: a.mobile, p_hub: a.hub, p_department: a.department, p_position: a.position }),
  applications: async (status?: string) => {
    let q = supabase.from('employee_applications').select('*').order('created_at', { ascending: false }).limit(500)
    if (status) q = q.eq('status', status)
    const { data, error } = await q; fail(error); return (data ?? []) as Application[]
  },
  applicationOf: async (employee: string) => {
    const { data, error } = await supabase.from('employee_applications').select('*').eq('employee_id', employee).order('created_at', { ascending: false }).limit(1)
    fail(error); return ((data ?? [])[0] ?? null) as Application | null
  },
  missingFields: (id: string) => rpc<string[]>('hr_application_missing_fields', { p_employee: id }),
  /** Everyone the caller may see, with what their profile still lacks for an ID (the ID-create format). */
  profileGaps: (zone: string | null = null, hub: string | null = null) => rpc<ProfileGap[]>('hr_profile_gaps', { p_zone: zone, p_hub: hub }),
  submitApplication: (id: string) => rpc<void>('hr_submit_application', { p_employee: id }),
  approveApplication: (id: string, code: string, note: string | null) =>
    rpc<void>('hr_approve_application', { p_employee: id, p_employee_code: code, p_note: note }),
  returnApplication: (id: string, note: string) => rpc<void>('hr_return_application', { p_employee: id, p_note: note }),
  rejectApplication: (id: string, reason: string) => rpc<void>('hr_reject_application', { p_employee: id, p_reason: reason }),
  nextCode: () => rpc<string>('hr_next_employee_code'),

  // leave
  leaveTypes: async () => {
    const { data, error } = await supabase.from('leave_types').select('*').eq('status', 'active').order('name'); fail(error); return (data ?? []) as LeaveType[]
  },
  leaveRequests: async (status?: string) => {
    let q = supabase.from('leave_requests').select('*').order('from_date', { ascending: false }).limit(500)
    if (status) q = q.eq('status', status)
    const { data, error } = await q; fail(error); return (data ?? []) as LeaveRequest[]
  },
  requestLeave: async (r: { employee_id: string; leave_type_id: string; from_date: string; to_date: string; reason: string }) => {
    const { error } = await supabase.from('leave_requests').insert({ ...r, status: 'pending' }); fail(error)
  },
  decideLeave: (id: string, approve: boolean, note: string | null) => rpc<void>('hr_decide_leave', { p_request: id, p_approve: approve, p_note: note }),
  cancelLeave: (id: string, reason: string) => rpc<void>('hr_cancel_leave', { p_request: id, p_reason: reason }),

  // attendance
  attendanceSummary: (month: string, hub?: string | null) => rpc<AttendanceSummary[]>('hr_attendance_summary', { p_month: month, p_hub: hub ?? null }),
  attendanceDay: async (date: string, employees: string[]) => {
    if (!employees.length) return [] as AttendanceRow[]
    const { data, error } = await supabase.from('attendance_records').select('*').eq('work_date', date).in('employee_id', employees); fail(error)
    return (data ?? []) as AttendanceRow[]
  },
  markAttendance: async (employee: string, date: string, status: AttendanceStatus, existing?: AttendanceRow, note?: string) => {
    if (existing) {
      const { error } = await supabase.from('attendance_records').update({ status, note: note || 'Corrected on the attendance page' }).eq('id', existing.id); fail(error)
    } else {
      const { error } = await supabase.from('attendance_records').insert({ employee_id: employee, work_date: date, status, source: 'manual', note: note || null }); fail(error)
    }
  },
}

// ---------- documents & salary ----------
export type EmpDocument = { id: string; doc_type: string; title: string | null; storage_path: string; file_name: string; mime_type: string; size_bytes: number
  verified_at: string | null; archived_at: string | null; created_at: string }
export const DOC_TYPE: Record<string, string> = { nid_front: 'এনআইডি (সামনে)', nid_back: 'এনআইডি (পেছনে)', photo: 'ছবি', signature: 'স্বাক্ষর', cv: 'সিভি',
  experience_certificate: 'অভিজ্ঞতার সনদ', education: 'শিক্ষাগত সনদ', other: 'অন্যান্য' }
export type Compensation = { id: string; effective_from: string; effective_to: string | null; basic_salary: number; transport_allowance: number; commission: number
  status: string; reason: string | null }
async function sha256(file: File) {
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}
export const docs = {
  list: async (employee: string) => {
    const { data, error } = await supabase.from('employee_documents').select('*').eq('employee_id', employee).is('archived_at', null).order('created_at', { ascending: false })
    fail(error); return (data ?? []) as EmpDocument[]
  },
  upload: async (employee: string, docType: string, file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) throw new HrError('শুধু JPG, PNG, WEBP বা পিডিএফ ফাইল')
    if (file.size > 10 * 1024 * 1024) throw new HrError('ফাইল ১০ MB-এর বেশি')
    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
    const path = `employee/${employee}/${crypto.randomUUID()}-${safe}`
    const up = await supabase.storage.from('employee-docs').upload(path, file, { contentType: file.type, upsert: false })
    if (up.error) throw new HrError(up.error.message)
    const { error } = await supabase.from('employee_documents').insert({ employee_id: employee, doc_type: docType, storage_path: path,
      file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size, sha256: await sha256(file) })
    fail(error)
  },
  url: async (path: string) => {
    const { data, error } = await supabase.storage.from('employee-docs').createSignedUrl(path, 120)
    if (error) throw new HrError(error.message); return data.signedUrl
  },
}
export const pay = {
  list: async (employee: string) => {
    const { data, error } = await supabase.from('employee_compensation').select('*').eq('employee_id', employee).order('effective_from', { ascending: false })
    fail(error); return (data ?? []) as Compensation[]
  },
  propose: (employee: string, effective: string, basic: number, transport: number, commission: number, reason: string) =>
    rpc<string>('hr_propose_compensation', { p_employee: employee, p_effective_from: effective, p_basic: basic, p_transport: transport,
      p_commission: commission, p_reason: reason }),
}

// ---------- helpers ----------
export const todayDhaka = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())
export const dmy = (s: string | null | undefined) => { if (!s) return '—'; const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
export const bn = (v: number | string | null | undefined) => v === null || v === undefined ? '—' : String(v).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[+d])
export function nameMap<T extends { id: string; name: string }>(rows: T[] | null | undefined): Record<string, string> {
  return Object.fromEntries((rows ?? []).map(r => [r.id, r.name]))
}
