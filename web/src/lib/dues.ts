// দেনা-পাওনা: a person's own dues ledger — statement lines (bKash / Nagad / Rocket), profiles by number, ticks.
// Everything is private to the signed-in person; every read and write goes through a dp_* database function.
import { supabase } from './supabase'

export type Wallet = 'bkash' | 'nagad' | 'rocket' | 'bank' | 'other'
export type Medium = Wallet | 'cash'
export type Dir = 'in' | 'out'
export const WALLETS: Array<{ key: Wallet; bn: string; en: string }> = [
  { key: 'bkash', bn: 'বিকাশ', en: 'bKash' }, { key: 'nagad', bn: 'নগদ', en: 'Nagad' }, { key: 'rocket', bn: 'রকেট', en: 'Rocket' },
  { key: 'bank', bn: 'ব্যাংক', en: 'Bank' }, { key: 'other', bn: 'অন্য', en: 'Other' }]
export const MEDIA: Array<{ key: Medium; bn: string; en: string }> = [{ key: 'cash', bn: 'হাতে নগদ টাকা', en: 'Cash in hand' }, ...WALLETS]
export const mediumName = (k: string, L: (bn: string, en: string) => string) => { const m = MEDIA.find(x => x.key === k); return m ? (k === 'cash' ? L('ক্যাশ', 'Cash') : L(m.bn, m.en)) : k }

export type Txn = {
  id: string; provider: Medium; txn_at: string; txn_date: string; direction: Dir; amount: number; fee: number; balance: number | null
  txn_type: string | null; trx_id: string | null; party_no: string | null; party_name: string | null; reference: string | null; note: string | null
  profile_id: string | null; profile_name: string | null
  /** the profile was picked by hand (not found by the number) */ by_hand: boolean
  /** written by hand, not from a statement */ manual: boolean; checked: boolean; edited: boolean; removed: boolean
}
export type Profile = { id: string; name: string; numbers: string[]; note: string | null; opening: number; given: number; got: number; balance: number
  txn_count: number; unchecked: number; last_date: string | null; created_at: string }
export type Statement = { id: string; provider: Wallet; account_no: string | null; file_name: string | null; date_from: string | null; date_to: string | null
  row_count: number; added_count: number; live_count: number; created_at: string }
export type Unknown = { party_no: string; party_name: string | null; txn_count: number; given: number; got: number; last_date: string | null }
export type ImportRow = { at: string; dir: Dir; amount: number; fee?: number; balance?: number | null; type?: string; trx?: string; party?: string; party_name?: string; ref?: string }
export type ImportResult = { statement_id: string; rows: number; added: number; skipped: number; bad: number; date_from: string | null; date_to: string | null }
export type TxnState = 'all' | 'unchecked' | 'checked' | 'noname' | 'removed'
export type TxnFilter = { from?: string | null; to?: string | null; provider?: string | null; profile?: string | null; state?: TxnState; q?: string | null }
/** What a line can be changed to. `profile`: an id, '' = follow the number, 'none' = nobody's. */
export type TxnInput = { at?: string; dir?: Dir; amount?: number; fee?: number; provider?: Medium; type?: string; trx?: string; party?: string; ref?: string; note?: string; profile?: string }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
const num = (v: unknown) => v == null ? 0 : Number(v)
const txn = (r: Txn): Txn => ({ ...r, amount: num(r.amount), fee: num(r.fee), balance: r.balance == null ? null : Number(r.balance) })

export const dues = {
  txns: async (f: TxnFilter = {}) => ((await rpc<Txn[]>('dp_txns', { p_from: f.from || null, p_to: f.to || null, p_provider: f.provider || null,
    p_profile: f.profile || null, p_state: f.state ?? 'all', p_q: f.q?.trim() || null })) ?? []).map(txn),
  saveTxn: (id: string | null, d: TxnInput) => rpc<string>('dp_txn_save', { p_id: id, p_data: d }),
  check: (ids: string[], checked: boolean) => rpc<number>('dp_txn_check', { p_ids: ids, p_checked: checked }),
  remove: (ids: string[], restore = false) => rpc<number>('dp_txn_remove', { p_ids: ids, p_restore: restore }),
  profiles: async () => ((await rpc<Profile[]>('dp_profiles')) ?? []).map(p => ({ ...p, opening: num(p.opening), given: num(p.given), got: num(p.got), balance: num(p.balance) })),
  saveProfile: (id: string | null, name: string, numbers: string[], note: string, opening: number) =>
    rpc<string>('dp_profile_save', { p_id: id, p_name: name, p_numbers: numbers, p_note: note || null, p_opening: opening || 0 }),
  removeProfile: (id: string) => rpc<void>('dp_profile_remove', { p_id: id }),
  unknown: async () => ((await rpc<Unknown[]>('dp_unknown_numbers')) ?? []).map(u => ({ ...u, given: num(u.given), got: num(u.got) })),
  statements: async () => (await rpc<Statement[]>('dp_statements')) ?? [],
  importStatement: (provider: Wallet, account: string, fileName: string, rows: ImportRow[]) =>
    rpc<ImportResult>('dp_statement_import', { p_provider: provider, p_account: account || null, p_file_name: fileName, p_rows: rows }),
  removeStatement: (id: string, all: boolean) => rpc<number>('dp_statement_remove', { p_id: id, p_all: all }),
}

const BN: Array<[RegExp, string]> = [
  [/Could not find the function|PGRST202|schema cache/i, 'দেনা-পাওনার অংশ ডাটাবেসে এখনো বসানো হয়নি'],
  [/permission denied|row-level/i, 'এই কাজের অনুমতি নেই'],
  [/Failed to fetch|NetworkError|network/i, 'ইন্টারনেট সংযোগ নেই — আবার চেষ্টা করুন'],
]
export const duesFriendly = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); return BN.find(([re]) => re.test(m))?.[1] ?? m }

/** A number as the database compares it: digits only, no +88, a 12-digit Rocket account cut to its mobile. */
export function cleanNumber(s: string): string {
  let v = s.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/\D/g, '')
  if (v.startsWith('8801') && v.length >= 13) v = v.slice(2)
  if (v.startsWith('01') && v.length === 12) v = v.slice(0, 11)
  return v
}
/** Today in Asia/Dhaka as YYYY-MM-DD, and the clock as HH:MM. */
export const dhakaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
export const dhakaClock = (iso?: string) => (iso ? new Date(iso) : new Date()).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false })
/** The balance of a profile in words: above zero I am owed, below zero I owe. */
export const balanceWord = (b: number, L: (bn: string, en: string) => string) => b > 0.004 ? L('পাবো', 'To receive') : b < -0.004 ? L('দেবো', 'To pay') : L('শোধ', 'Settled')
