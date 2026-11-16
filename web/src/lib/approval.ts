// Approval rules: for each kind of input, whether it waits for approval, is accepted on submit, or is only viewed from above.
import { supabase } from './supabase'
import { HrError } from './hr'

export type Mode = 'approve' | 'auto' | 'view'
export type Rule = { kind: string; wired: boolean; all_mode: Mode; zone_mode: Mode | null; mode: Mode; set_by_name: string | null; set_at: string | null }

const fail = (e: { message: string; code?: string } | null) => { if (e) throw new HrError(e.message, e.code) }

export const approval = {
  list: async (zone: string | null): Promise<Rule[]> => {
    const { data, error } = await supabase.rpc('approval_rules_list', { p_zone: zone }); fail(error); return (data ?? []) as Rule[]
  },
  /** mode null on a zone = follow the rule for all zones again. */
  save: async (kind: string, zone: string | null, mode: Mode | null) => {
    const { error } = await supabase.rpc('approval_rule_save', { p_kind: kind, p_zone: zone, p_mode: mode }); fail(error)
  },
  /** What applies at this hub; "approve" when it cannot be read. */
  modeAt: async (kind: string, hub: string): Promise<Mode> => {
    const { data, error } = await supabase.rpc('approval_mode_at', { p_kind: kind, p_hub: hub })
    return !error && (data === 'auto' || data === 'view') ? data : 'approve'
  },
}

export const MODES: Array<[Mode, bn: string, note: string, tone: string]> = [
  ['approve', 'অনুমোদন লাগবে', 'উপরের জন গ্রহণ না করা পর্যন্ত অপেক্ষায় থাকবে', 'o'],
  ['auto', 'অটো গ্রহণ', 'জমা দিলেই গৃহীত; উপরের জন দেখবেন, দরকারে ফিরিয়ে নিতে পারবেন', 'g'],
  ['view', 'শুধু দেখা', 'জমা দিলেই গৃহীত; উপরের জন শুধু দেখবেন, ফিরিয়ে নিতে পারবেন না', 'b'],
]
export const modeName = (m: Mode) => MODES.find(x => x[0] === m)?.[1] ?? m

/** Every kind of input, with the words the page uses. */
export const KIND_TEXT: Record<string, [name: string, note: string, icon: string]> = {
  khata: ['হিসাব খাতা', 'স্টাফ নিজের খাতা সাবমিট করলে ম্যানেজারের Accept', 'ledger'],
  leave: ['ছুটির আবেদন', 'স্টাফ ছুটি চাইলে', 'log'],
  hr_request: ['চাকরি ছাড়া / প্যানেল চালুর আবেদন', 'স্টাফ প্যানেল থেকে পাঠানো আবেদন', 'form'],
  id_application: ['নতুন আইডি আবেদন', 'নতুন লোকের আইডি খোলার আবেদন', 'user'],
  manpower: ['লোক লাগবে', 'হাব থেকে লোকের চাহিদা', 'users'],
  expense: ['খরচ', 'হাবের খরচের অনুমোদন', 'cash'],
  profile: ['প্রোফাইল বদল', 'কর্মীর তথ্য বদলানোর অনুরোধ', 'edit'],
}
