// Staff give their own attendance ("হাবে এসেছি" / "আজ আসব না"); it counts once the hub manager approves it.
import { supabase } from './supabase'
import { HrError } from './hr'

export type SelfKind = 'present' | 'absent'
export type SelfStatus = 'waiting' | 'approved' | 'rejected'
export type Decided = 'present' | 'late' | 'half_day' | 'absent'
export type MyAttToday = {
  work_date: string
  record: { status: string; check_in: string | null; source: string } | null
  mark: { id: string; kind: SelfKind; note: string | null; marked_at: string; status: SelfStatus; decided_as: Decided | null
    decide_note: string | null; decided_at: string | null; decided_by_name: string | null } | null
}
export type SelfMark = { id: string; employee_id: string; employee_code: string | null; full_name: string; kind: SelfKind; note: string | null
  marked_at: string; status: SelfStatus; decided_as: Decided | null; decide_note: string | null; decided_at: string | null; decided_by_name: string | null }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new HrError(error.message, error.code)
  return data as T
}

const BN: Array<[RegExp, string]> = [
  [/already on the register/i, 'আজকের হাজিরা আগেই খাতায় উঠেছে'],
  [/already approved/i, 'আজকের হাজিরা আগেই অনুমোদিত'],
  [/reason for not coming/i, 'কেন আসছেন না, লিখুন'],
  [/turned down/i, 'কেন ফেরত দিচ্ছেন, লিখুন'],
  [/Your own attendance/i, 'নিজের হাজিরা অন্য ম্যানেজার অনুমোদন দেবেন'],
  [/No active staff profile/i, 'আপনার লগইনের সাথে সক্রিয় কর্মী প্রোফাইল যুক্ত নেই'],
  [/may not approve|42501|permission denied/i, 'এই কাজের অনুমতি আপনার নেই'],
]
export const selfAttFriendly = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e)
  return BN.find(([re]) => re.test(m))?.[1] ?? m
}

export const selfAtt = {
  mine: () => rpc<MyAttToday | null>('my_att_today'),
  mark: (kind: SelfKind, note?: string) => rpc<string>('att_self_mark', { p_kind: kind, p_note: note || null }),
  list: (hub: string, date: string) => rpc<SelfMark[]>('att_self_list', { p_hub: hub, p_date: date }),
  decide: (ids: string[], ok: boolean, as?: Decided | null, note?: string) =>
    rpc<number>('att_self_decide', { p_ids: ids, p_ok: ok, p_as: as ?? null, p_note: note || null }),
}
