// The company's "New Admin & Rider ID Creat Information" sheet, filled from the staff records:
// the same 25 columns, in the same order, with the same headings — nothing more.
import { supabase } from './supabase'
import { dmy } from './hr'
import { staffAdmin } from './staffAdmin'
import { download, xlsxBlob } from './xlsx'

export const ID_CREATE_HEADS = ['SL', 'Name', 'Phone Number', 'Alternative Phone Number', 'Hub Name', 'Designation', 'Gmail Only for Admin', 'Blood Group',
  'Date Of Birth', 'Permament Address', 'Raferance Name & ID', 'NID/ Birth Certificate Number', 'Employee Picture', 'NID Front Picture', 'NID Back Picture',
  'Basic', 'Phn bill', 'Conveyance', 'Commission', 'Pick & Drop', 'Return', 'Weight Bonus', 'Entry Com.', 'Reason', 'Remarks']
const FIELDS = ['employee_code', 'full_name', 'mobile', 'cf:alt_mobile', 'hub_name', 'position_name', 'email', 'cf:blood_group', 'date_of_birth', 'permanent_address',
  'referrer_name', 'referrer_code', 'nid_number', 'basic_salary', 'transport_allowance', 'commission']

type Row = Record<string, unknown>
const text = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const num = (v: unknown): number | string => (typeof v === 'number' ? v : v === null || v === undefined || v === '' ? '' : Number(v))

/** Builds and downloads the sheet for the staff the signed-in person may see (optionally one hub / status). Returns how many rows. */
export async function downloadIdCreateFile(o: { zone?: string | null; hub?: string | null; status?: string | null; hubName?: string } = {}): Promise<number> {
  const rows = (await staffAdmin.exportRows(FIELDS, { zone: o.zone, hub: o.hub, status: o.status })) as Row[]
  if (!rows.length) return 0
  // which pictures are on file (the pictures themselves cannot go into a sheet)
  const have = new Map<string, Set<string>>()
  const ids = rows.map(r => text(r._id)).filter(Boolean)
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from('employee_documents').select('employee_id, doc_type').is('archived_at', null).in('doc_type', ['photo', 'nid_front', 'nid_back']).in('employee_id', ids.slice(i, i + 100))
    for (const d of (data ?? []) as Array<{ employee_id: string; doc_type: string }>) { const s = have.get(d.employee_id) ?? new Set<string>(); s.add(d.doc_type); have.set(d.employee_id, s) }
  }
  const pic = (r: Row, t: string) => (have.get(text(r._id))?.has(t) ? 'Yes' : '')
  const sorted = [...rows].sort((a, b) => text(a.hub_name).localeCompare(text(b.hub_name)) || text(a.full_name).localeCompare(text(b.full_name)))
  const body = sorted.map((r, i) => [i + 1, text(r.full_name), text(r.mobile), text(r['cf:alt_mobile']), text(r.hub_name), text(r.position_name), text(r.email), text(r['cf:blood_group']),
    r.date_of_birth ? dmy(text(r.date_of_birth)) : '', text(r.permanent_address),
    [text(r.referrer_name), r.referrer_code ? `(${text(r.referrer_code)})` : ''].filter(Boolean).join(' '), text(r.nid_number),
    pic(r, 'photo'), pic(r, 'nid_front'), pic(r, 'nid_back'),
    num(r.basic_salary), '', num(r.transport_allowance), num(r.commission), '', '', '', '', '', r.employee_code ? `ID ${text(r.employee_code)}` : ''])
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
  download(xlsxBlob('New Admin & Rider ID Creat Information', `${o.hubName || 'All hubs'} · ${sorted.length} staff · ${day}`, ID_CREATE_HEADS, body), `New-Admin-Rider-ID-Creat-Information-${day}.xlsx`)
  return sorted.length
}
