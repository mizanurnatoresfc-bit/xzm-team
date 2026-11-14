// Roles and permissions ("who sees what"). Only the Super Admin can save; the database checks it.
import { supabase } from './supabase'
import { HrError } from './hr'

export type RoleRow = { id: string; code: string; name: string; name_bn: string | null; description: string | null
  is_system: boolean; is_super: boolean; status: string; archived_at: string | null
  permission_count: number; user_count: number; permissions: string[] }
export type Permission = { code: string; module: string; resource: string; action: string; description: string | null }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

export const roles = {
  list: () => rpc<RoleRow[]>('role_admin_list'),
  permissions: async (): Promise<Permission[]> => {
    const { data, error } = await supabase.from('permissions').select('code, module, resource, action, description').order('code')
    if (error) throw new HrError(error.message, error.code)
    return (data ?? []) as Permission[]
  },
  save: (id: string | null, name: string, nameBn: string, description: string, permissions: string[]) =>
    rpc<string>('role_admin_save', { p_id: id, p_name: name, p_name_bn: nameBn, p_description: description, p_permissions: permissions }),
  archive: (id: string, reason: string) => rpc<void>('role_admin_archive', { p_id: id, p_reason: reason }),
}

export const MODULE_LABEL: Record<string, [string, string]> = {
  org: ['প্রতিষ্ঠান ও জোন/হাব', 'Organisation, zones & hubs'],
  hr: ['স্টাফ / HR', 'Staff / HR'],
  da: ['দৈনিক হিসাব', 'Daily accounts'],
  ops: ['কুরিয়ার অপারেশন', 'Courier operations'],
  zonal: ['জোনাল ম্যানেজমেন্ট', 'Zonal management'],
  system: ['সিস্টেম ও ইউজার', 'System & users'],
  sorting: ['শটিং সেন্টার', 'Sorting center'],
  office: ['অফিস ম্যানেজমেন্ট', 'Office management'],
}
export const ACTION_LABEL: Record<string, [string, string]> = {
  view: ['দেখা', 'View'], create: ['তৈরি / জমা', 'Create'], edit: ['সম্পাদনা', 'Edit'], archive: ['আর্কাইভ', 'Archive'],
  delete: ['মুছে ফেলা', 'Delete'], approve: ['অনুমোদন', 'Approve'], reject: ['বাতিল', 'Reject'], export: ['এক্সপোর্ট', 'Export'],
  print: ['প্রিন্ট', 'Print'], share: ['শেয়ার', 'Share'], configure: ['সেটিংস', 'Configure'],
}
export const ACTIONS = ['view', 'create', 'edit', 'approve', 'reject', 'archive', 'export', 'print', 'configure', 'share', 'delete']
export const RESOURCE_LABEL: Record<string, string> = {
  'org.organization': 'কোম্পানির তথ্য', 'org.zone': 'জোন', 'org.hub': 'হাব', 'org.department': 'বিভাগ', 'org.position': 'পদবি',
  'hr.application': 'আইডি আবেদন', 'hr.attendance': 'হাজিরা', 'hr.compensation': 'বেতন / ভাতা', 'hr.document': 'কর্মীর ডকুমেন্ট',
  'hr.employee': 'কর্মী', 'hr.employee_sensitive': 'NID ও গোপন তথ্য', 'hr.import': 'কর্মী ইমপোর্ট (Excel)', 'hr.leave': 'ছুটি',
  'hr.profile_field': 'প্রোফাইলের ঘর (কাস্টম)', 'hr.salary_sheet': 'বেতন শিট', 'hr.referral': 'রেফারেন্স',
  'da.correction': 'হিসাব সংশোধনে খোলা', 'da.report': 'হিসাবের রিপোর্ট', 'da.settings': 'হিসাব সেটিংস', 'da.sheet': 'দৈনিক হিসাব খাতা',
  'ops.assignment': 'হাব/জোন দায়িত্ব বণ্টন', 'ops.cash': 'হাবের নগদ টাকা', 'ops.delivery': 'ডেলিভারি', 'ops.expense': 'অপারেশন খরচ',
  'ops.handover': 'টাকা হস্তান্তর', 'ops.hub_handover': 'হাব থেকে টাকা গ্রহণ', 'ops.issue': 'পার্সেল সমস্যা', 'ops.merchant': 'মার্চেন্ট',
  'ops.merchant_payment': 'মার্চেন্ট পেমেন্ট', 'ops.parcel': 'পার্সেল', 'ops.pickup': 'পিকআপ অনুমোদন',
  'ops.pickup_as_hub_manager': 'পিকআপ জমা (হাব ম্যানেজার)', 'ops.pickup_as_pickup_manager': 'পিকআপ জমা (পিকআপ ম্যানেজার)',
  'ops.pickup_as_rider': 'নিজের পিকআপ জমা (রাইডার)', 'ops.pickup_verification': 'পিকআপ যাচাই', 'ops.reconciliation': 'দৈনিক নগদ মিলানো',
  'ops.report': 'অপারেশন রিপোর্ট', 'ops.rider_handover': 'রাইডার থেকে টাকা গ্রহণ',
  'system.admin_portal': 'অ্যাডমিন পোর্টাল', 'system.audit': 'অডিট লগ', 'system.role': 'রোল', 'system.settings': 'সিস্টেম সেটিংস',
  'system.user': 'ইউজার অ্যাকাউন্ট', 'system.user_role': 'ইউজারকে রোল দেওয়া',
  'zonal.claim': 'যাতায়াত বিল', 'zonal.dashboard': 'জোনাল ড্যাশবোর্ড', 'zonal.hub_metric': 'হাবের দৈনিক হিসাব', 'zonal.planning': 'জনবল পরিকল্পনা',
  'sorting.center': 'শটিং সেন্টার ও রুট', 'sorting.staff': 'শটিং স্টাফ', 'sorting.fuel': 'তেলের স্লিপ ও খরচ',
  'sorting.hub_charge': 'গাড়ি খরচ হাবের খাতায়', 'sorting.parcel': 'পার্সেল আদান-প্রদান', 'sorting.driver': 'ড্রাইভার রিপোর্ট', 'sorting.report': 'শটিং রিপোর্ট',
  'office.property': 'অফিস, রুম ও ডেস্ক', 'office.asset': 'অফিসের রিসোর্স',
  'hr.duty': 'কাজের দায়িত্ব', 'ops.route': 'রাইডার রুট',
  'zonal.report': 'জোনাল রিপোর্ট', 'zonal.task': 'কাজ (টাস্ক)', 'zonal.visit': 'হাব ভিজিট',
}
