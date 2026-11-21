// Company sheets: the company's own Excel layouts (ID create, ID transfer, ...), learnt from the
// company's file, filled from HR requests or the staff records, and downloaded looking the same.
// When the company changes its layout, the new file is read again and the columns that stayed keep
// their source; only what is new has to be pointed at something.
import { supabase } from './supabase'
import { HrError, dmy, org } from './hr'
import { hrReq, slugKey, type FieldType, type HrRequest, type ReqField, type ReqFormat, type ReqKind, type ReqStatus } from './hrreq'
import { manpower, type RegisterRow } from './manpower'
import { EXPORT_FIELDS, exportValue, staffAdmin } from './staffAdmin'
import type { CField } from './extra'
import type { BookSheet } from './sheetRead'
import { download, laidXlsxBlob, type LaidSheet } from './xlsx'

export type SheetCol = { head: string; group?: string; src: string; w?: number }
export type CompanySheet = {
  id: string; name: string; name_bn: string | null; source: 'requests' | 'staff'; kind: ReqKind | null; format_id: string | null
  title: string | null; title_at: [number, number] | null; columns: SheetCol[]; file_name: string | null; sort_order: number; archived_at: string | null
}
export type SheetDraft = Omit<CompanySheet, 'id' | 'archived_at' | 'sort_order'> & { id?: string; sort_order?: number }

const fail = (e: { message: string; code?: string } | null) => { if (e) throw new HrError(e.message, e.code) }

export const companySheets = {
  list: async (): Promise<CompanySheet[]> => {
    const { data, error } = await supabase.from('company_sheets').select('*').is('archived_at', null).order('sort_order').order('name')
    fail(error); return (data ?? []) as CompanySheet[]
  },
  save: async (s: SheetDraft) => {
    const row = { name: s.name, name_bn: s.name_bn || null, source: s.source, kind: s.source === 'requests' ? s.kind : null,
      format_id: s.source === 'requests' ? s.format_id || null : null, title: s.title || null, title_at: s.title_at ?? null,
      columns: s.columns.map(c => ({ head: c.head, ...(c.group ? { group: c.group } : {}), src: c.src, ...(c.w ? { w: c.w } : {}) })), file_name: s.file_name || null }
    const r = s.id ? await supabase.from('company_sheets').update(row).eq('id', s.id) : await supabase.from('company_sheets').insert(row)
    fail(r.error)
  },
  archive: async (id: string, reason: string) => {
    const { error } = await supabase.from('company_sheets').update({ archived_at: new Date().toISOString(), archive_reason: reason || null }).eq('id', id)
    fail(error)
  },
  people: async (ids: string[], fields: string[]): Promise<Record<string, Record<string, unknown>>> => {
    if (!ids.length) return {}
    const { data, error } = await supabase.rpc('hr_sheet_people', { p_ids: ids, p_fields: fields }); fail(error)
    return (data ?? {}) as Record<string, Record<string, unknown>>
  },
}

export function sheetFriendly(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  if (/needs a heading/i.test(m)) return 'প্রতিটা কলামের একটা শিরোনাম দিন'
  if (/needs a source|unknown source/i.test(m)) return 'একটা কলামের তথ্যের উৎস ঠিক নেই — আবার বেছে দিন'
  if (/cannot take a value from a request/i.test(m)) return 'কর্মী তালিকার শিটে রিকুয়েস্টের ঘর বসানো যায় না'
  if (/does not match the kind/i.test(m)) return 'ফর্ম আর শিটের ধরন মিলছে না'
  if (/company_sheets_name_uq|duplicate key|unique/i.test(m)) return 'এই নামে একটা শিট আগেই আছে — অন্য নাম দিন'
  if (/company_sheets.*does not exist|schema cache|PGRST205/i.test(m)) return 'কোম্পানি শিট এখনো ডাটাবেসে চালু হয়নি (migration 20261121000500 বসাতে হবে)'
  if (/row-level security|42501|Not authorised/i.test(m)) return 'এই কাজের অনুমতি আপনার নেই'
  if (/Too many people/i.test(m)) return 'এক শিটে সর্বোচ্চ ৫০০০ জন — হাব বা তারিখ বেছে ছোট করুন'
  return m
}

// ------------------------------------------------------------------ where a column's value comes from
/** "a|b|fixed:x|y" → ['a', 'b', 'fixed:x|y'] (a fixed text may hold a bar, so it is always last). */
export function srcParts(src: string): string[] {
  const s = src || 'blank'
  if (s.startsWith('fixed:')) return [s]
  const i = s.indexOf('|fixed:')
  return i < 0 ? s.split('|').filter(Boolean) : [...s.slice(0, i).split('|').filter(Boolean), s.slice(i + 1)]
}
export const joinSrc = (parts: string[]) => parts.filter(p => p && p !== 'blank').join('|') || 'blank'

export const DOC_SRC: Array<[string, string]> = [['doc:photo', 'ছবি জমা আছে কি (Yes)'], ['doc:nid_front', 'NID সামনের ছবি আছে কি'], ['doc:nid_back', 'NID পেছনের ছবি আছে কি'],
  ['doc:signature', 'স্বাক্ষর আছে কি'], ['doc:cv', 'সিভি আছে কি']]
export const REQ_SRC: Array<[string, string]> = [['req.hub', 'রিকুয়েস্টের হাব (বদলিতে: পুরোনো হাব)'], ['req.no', 'রিকুয়েস্ট নং'], ['req.date', 'রিকুয়েস্টের তারিখ'], ['req.status', 'রিকুয়েস্টের অবস্থা'],
  ['req.result', 'ফলাফল'], ['req.note', 'নোট'], ['req.decision', 'সিদ্ধান্তের নোট']]

export type SrcCtx = { source: 'requests' | 'staff'; fields: ReqField[]; custom: CField[] }
export type SrcGroup = { label: string; items: Array<[string, string]> }

/** Everything a column may be pointed at, grouped for the picker. */
export function srcGroups(ctx: SrcCtx): SrcGroup[] {
  const out: SrcGroup[] = [
    { label: 'সাধারণ', items: [['sl', 'ক্রমিক নং (১, ২, ৩…)'], ['blank', 'খালি — নামানোর আগে হাতে লিখব'], ['ref', 'রেফারেন্স — নাম ও আইডি'], ['fixed:', 'সব সারিতে একই লেখা…']] },
    { label: 'কর্মীর তথ্য', items: [...EXPORT_FIELDS.map(([f, bn]) => [`emp:${f}`, bn] as [string, string]),
      ...ctx.custom.map(c => [`emp:cf:${c.code}`, `${c.label_bn || c.label} (প্রোফাইলের ঘর)`] as [string, string])] },
    { label: 'কাগজপত্র', items: DOC_SRC },
  ]
  if (ctx.source === 'requests') {
    out.push({ label: 'রিকুয়েস্ট', items: REQ_SRC })
    if (ctx.fields.length) out.push({ label: 'ফর্মের ঘর', items: ctx.fields.map(f => [`req:${f.key}`, f.label] as [string, string]) })
    out.push({ label: 'ফর্মে নেই?', items: [['__new:text', '➕ ফর্মে নতুন ঘর বানান (লেখা)'], ['__new:number', '➕ ফর্মে নতুন ঘর বানান (সংখ্যা)'], ['__new:date', '➕ ফর্মে নতুন ঘর বানান (তারিখ)']] })
  }
  return out
}
export function srcLabel(part: string, ctx: SrcCtx): string {
  if (part.startsWith('fixed:')) return `“${part.slice(6)}”`
  for (const g of srcGroups(ctx)) { const hit = g.items.find(i => i[0] === part); if (hit) return hit[1] }
  if (part.startsWith('req:')) return `ফর্মের ঘর: ${part.slice(4)}`
  return part
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, ' ').trim()

/** Best guess of where a heading's value lives. `sure` is false when nothing in the system matched. */
export function guessSrc(head: string, group: string, ctx: SrcCtx): { src: string; sure: boolean } {
  const h = norm(head), g = norm(group), R = ctx.source === 'requests'
  const has = (k: string) => ctx.fields.some(f => f.key === k)
  const req = (k: string) => (R && has(k) ? `|req:${k}` : '')
  const cf = (re: RegExp) => { const f = ctx.custom.find(c => re.test(norm(c.label)) || re.test(norm(c.label_bn ?? '')) || re.test(c.code)); return f ? `emp:cf:${f.code}` : '' }
  const yes = (src: string) => ({ src, sure: true })
  const isNew = /\bnew\b|নতুন|revised|পরিবর্তিত/.test(g)
  const pay = (field: string, key: string) => !isNew ? yes(`emp:${field}`) : R && has(key) ? yes(`req:${key}|emp:${field}`) : { src: 'blank', sure: false }

  if (/^(sl|s l|sl no|serial|serial no|no|ক্রমিক|ক্রমিক নং|নং)$/.test(h)) return yes('sl')
  if (/picture|photo|image|ছবি/.test(h)) return yes(/front|সামনে/.test(h) ? 'doc:nid_front' : /back|পেছ|পিছ/.test(h) ? 'doc:nid_back' : /signature|স্বাক্ষর/.test(h) ? 'doc:signature' : 'doc:photo')
  if (/refer|rafer|রেফা/.test(h)) return yes('ref')
  if (/(alt|alternative|second|বিকল্প).*(phone|mobile|number|নম্বর|মোবাইল)/.test(h)) { const c = cf(/alt/); return yes(joinSrc([c, 'emp:emergency_contact_phone'])) }
  if (/(old|previous|present|current|from|পুরা|পুরো|বর্তমান|আগের).*(hub|হাব)/.test(h)) return yes(R ? 'req.hub' + req('from_hub') : 'emp:hub_name')
  if (/(new|to|transfer|নতুন).*(hub|হাব)/.test(h)) return R && has('to_hub') ? yes('req:to_hub') : { src: 'blank', sure: false }
  if (/hub code|হাব কোড/.test(h)) return yes('emp:hub_code')
  if (/hub|হাব/.test(h)) return yes(R ? 'emp:hub_name|req.hub' : 'emp:hub_name')
  if (/designation|position|\bpost\b|পদবি|পদ/.test(h)) return yes('emp:position_name' + req('position'))
  if (/mail/.test(h)) return yes('emp:email')
  if (/blood|রক্ত/.test(h)) { const c = cf(/blood|রক্ত/); return c ? yes(c) : { src: 'blank', sure: false } }
  if (/nid|national id|birth certificate|জন্ম নিবন্ধন|এনআইডি/.test(h)) return yes('emp:nid_number' + req('nid'))
  if (/date of birth|\bdob\b|birth|জন্ম/.test(h)) return yes('emp:date_of_birth')
  if (/father|বাবা|পিতা/.test(h)) return yes('emp:father_name')
  if (/mother|মায়ের|মাতা/.test(h)) return yes('emp:mother_name')
  if (/perma|স্থায়ী/.test(h)) return yes('emp:permanent_address|emp:present_address' + req('address'))
  if (/present address|বর্তমান ঠিকানা/.test(h)) return yes('emp:present_address|emp:permanent_address')
  if (/address|ঠিকানা/.test(h)) return yes('emp:permanent_address|emp:present_address' + req('address'))
  if (/join|যোগদান/.test(h)) return yes('emp:joining_date' + req('joining_date'))
  if (/reason|remark|কারণ|মন্তব্য/.test(h)) return R ? yes(joinSrc([has('reason') ? 'req:reason' : '', 'req.note'])) : { src: 'blank', sure: false }
  if (/^basic|basic salary|মূল বেতন|বেসিক/.test(h)) return pay('basic_salary', 'new_basic')
  if (/fuel|fuyel|conveyance|transport|যাতায়াত|ফুয়েল/.test(h)) return pay('transport_allowance', 'new_bill')
  if (/commis|কমিশন/.test(h)) return pay('commission', 'new_commission')
  if (/^(id|id no|employee id|rider id|staff id|আইডি|আইডি নং)$/.test(h)) return yes('emp:employee_code' + req('employee_code'))
  if (/phone|mobile|contact|মোবাইল|ফোন/.test(h) && !/bill|বিল/.test(h)) return yes('emp:mobile' + req('mobile'))
  if (/status|অবস্থা/.test(h)) return yes(R ? 'req.status' : 'emp:status')
  if (/zone|area|জোন|এরিয়া/.test(h)) return yes('emp:zone_name')
  if (/department|বিভাগ/.test(h)) return yes('emp:department_name')
  if (/^date$|তারিখ/.test(h) && R) return yes('req.date')
  if (/name|নাম/.test(h)) return yes('emp:full_name' + req('full_name'))
  // the form or the profile may have a box with exactly this heading
  const fld = R ? ctx.fields.find(f => norm(f.label) === h) : undefined
  if (fld) return yes(`req:${fld.key}`)
  const own = ctx.custom.find(c => norm(c.label) === h || norm(c.label_bn ?? '') === h)
  if (own) return yes(`emp:cf:${own.code}`)
  return { src: 'blank', sure: false }
}

// ------------------------------------------------------------------ learning a layout from the company's own file
export type Learnt = { title: string; title_at: [number, number] | null; cols: Array<{ head: string; group: string; w?: number; sample: string }> }

/** Finds the row of column headings, the title and grouped headings above it, widths and one sample row. */
export function learnLayout(sheet: BookSheet): Learnt {
  const rows = sheet.rows
  const filled = (r: string[] | undefined) => (r ?? []).filter(c => c !== '').length
  let hr = -1, best = 1
  for (let i = 0; i < Math.min(rows.length, 15); i++) if (filled(rows[i]) > best) { best = filled(rows[i]); hr = i }
  if (hr < 0) throw new Error('এই শিটে কলামের শিরোনামের সারি পাওয়া যায়নি')
  const headRow = rows[hr]
  const keep: number[] = []                       // file column numbers that carry a heading
  headRow.forEach((h, c) => { if (h !== '') keep.push(c) })
  const pos = new Map(keep.map((c, i) => [c, i]))
  // cells above the headings: the widest is the title, the others group the columns under them
  const tops: Array<{ text: string; c0: number; c1: number }> = []
  for (let r = 0; r < hr; r++) (rows[r] ?? []).forEach((text, c) => {
    if (text === '') return
    const m = sheet.merges.find(x => x.r0 === r && x.c0 === c)
    tops.push({ text, c0: c, c1: m ? m.c1 : c })
  })
  const span = (t: { c0: number; c1: number }) => keep.filter(c => c >= t.c0 && c <= t.c1)
  const titleCell = [...tops].sort((a, b) => span(b).length - span(a).length || a.c0 - b.c0)[0]
  const groupOf = new Map<number, string>()
  for (const t of tops) if (t !== titleCell) for (const c of span(t)) groupOf.set(c, t.text)
  let title_at: [number, number] | null = null
  if (titleCell) {
    const cs = span(titleCell)
    if (cs.length && cs.length < keep.length) title_at = [pos.get(cs[0])!, pos.get(cs[cs.length - 1])!]
  }
  const sampleRow = rows.slice(hr + 1).find(r => keep.filter(c => (r?.[c] ?? '') !== '').length > 1)
  return { title: titleCell?.text ?? '', title_at,
    cols: keep.map(c => ({ head: headRow[c].replace(/\s+/g, ' '), group: groupOf.get(c) ?? '', w: sheet.widths[c], sample: sampleRow?.[c] ?? '' })) }
}

const colKey = (c: { head: string; group?: string }) => `${norm(c.group ?? '')}›${norm(c.head)}`

/** Lays the new file's columns over an older layout: a column that was there keeps its source, a new one is guessed. */
export function mergeLearnt(learnt: Learnt, old: SheetCol[], ctx: SrcCtx): { cols: Array<SheetCol & { sample: string; state?: 'kept' | 'new' | 'unsure' }>; dropped: SheetCol[] } {
  const left = [...old]
  const cols = learnt.cols.map(c => {
    const i = left.findIndex(o => colKey(o) === colKey(c))
    if (i >= 0) { const [o] = left.splice(i, 1); return { head: c.head, group: c.group || undefined, src: o.src, w: c.w ?? o.w, sample: c.sample, state: 'kept' as const } }
    const g = guessSrc(c.head, c.group, ctx)
    return { head: c.head, group: c.group || undefined, src: g.src, w: c.w, sample: c.sample, state: !g.sure ? 'unsure' as const : old.length ? 'new' as const : undefined }
  })
  return { cols, dropped: old.length ? left : [] }
}

/** Adds boxes to a request form for columns the system has nowhere to take from; returns the key of each, in order. */
export async function addFormFields(format: ReqFormat, wanted: Array<{ label: string; type: FieldType }>): Promise<string[]> {
  if (!wanted.length) return []
  const fields = [...format.fields], keys: string[] = []
  for (const w of wanted) {
    const same = fields.find(f => norm(f.label) === norm(w.label))
    if (same) { keys.push(same.key); continue }
    const key = slugKey(w.label, fields.map(f => f.key))
    fields.push({ key, label: w.label, type: w.type }); keys.push(key)
  }
  if (fields.length !== format.fields.length) await hrReq.saveFormat({ fields }, format.id)
  return keys
}

// ------------------------------------------------------------------ filling a sheet
export type BuiltRow = { id: string; label: string; status?: ReqStatus; /** made directly in the system, with no request behind it */ direct?: boolean; cells: Array<string | number> }
export type Built = { rows: BuiltRow[]; hidden: number }
export type BuildOpts = { from?: string | null; to?: string | null; hub?: string | null; zone?: string | null; statuses?: ReqStatus[]; status?: string | null; q?: string | null
  /** also list transfers / status changes made straight in the system, which have no request */ withDirect?: boolean
  custom: CField[]; lang?: string }

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
// An amount typed on a form goes out as a number (a mobile number keeps its leading 0, a long NID stays text).
const AMOUNT = /^(0|[1-9]\d{0,8})(\.\d{1,2})?$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REQ_STATUS_EN: Record<string, string> = { submitted: 'Submitted', processing: 'Processing', done: 'Done', rejected: 'Rejected', cancelled: 'Cancelled' }
let hubCache: Promise<Record<string, string>> | null = null
/** Hub names as the company writes them (no number code added). */
const hubNames = () => (hubCache ??= org.hubs().then(l => Object.fromEntries(l.map(h => [h.id, h.name]))).catch(() => { hubCache = null; return {} as Record<string, string> }))

function valueOf(part: string, i: number, emp: Record<string, unknown> | undefined, r: HrRequest | undefined, hubs: Record<string, string>, o: BuildOpts): string | number {
  if (part === 'sl') return i + 1
  if (part === 'blank') return ''
  if (part.startsWith('fixed:')) return part.slice(6)
  if (part === 'ref') {
    const name = r?.ref_name || (emp?.referrer_name as string | undefined) || '', code = r?.ref_name ? r.ref_code : r?.ref_code || (emp?.referrer_code as string | undefined)
    return [name, code ? `ID: ${code}` : ''].filter(Boolean).join('\n')
  }
  if (part.startsWith('emp:')) { const f = part.slice(4); return emp ? exportValue(f, emp[f], o.lang ?? 'en', o.custom) : '' }
  if (part.startsWith('doc:')) return emp?.[part] ? 'Yes' : ''
  if (!r) return ''
  if (part.startsWith('req:')) {
    const v = String(r.data[part.slice(4)] ?? '').trim()
    return hubs[v] ?? (ISO_DAY.test(v) ? dmy(v) : UUID.test(v) ? '' : AMOUNT.test(v) ? Number(v) : v)
  }
  switch (part) {
    case 'req.no': return r.request_no
    case 'req.date': return dmy(new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }))
    case 'req.status': return REQ_STATUS_EN[r.status] ?? r.status
    case 'req.result': return r.result ?? ''
    case 'req.note': return r.note ?? ''
    case 'req.decision': return r.decision_note ?? ''
    case 'req.hub': return hubs[r.hub_id ?? ''] ?? ''
    default: return ''
  }
}

/** Kinds of sheet that can also show what was done straight in the system (the staff page's transfer / active / inactive buttons). */
export const DIRECT_KINDS: ReqKind[] = ['id_transfer', 'id_active', 'id_inactive']
const OFF_STATUS = ['inactive', 'resigned', 'terminated']

/** Transfers and status changes made in the system with no request, shaped like requests so the same columns fill.
 *  One that a listed request already covers (same person, same kind of change) is left out, so nobody is listed twice. */
async function directChanges(kind: ReqKind, o: BuildOpts, requests: HrRequest[], hubs: Record<string, string>): Promise<HrRequest[]> {
  // the request rows must still come out if the register cannot be read
  const reg = (await manpower.register(o.zone ?? null, o.from || '2000-01-01', o.to || today()).catch(() => null)) ?? ([] as RegisterRow[])
  const covered = new Set(requests.map(r => r.employee_id))
  const fits = (r: RegisterRow) => kind === 'id_transfer' ? r.kind === 'transfer' && r.from_hub !== r.to_hub
    : r.kind === 'status' && (kind === 'id_active' ? r.to_status === 'active' : OFF_STATUS.includes(r.to_status ?? ''))
  return reg.filter(r => r.source === 'system' && r.employee_id && fits(r) && !covered.has(r.employee_id) && (!o.hub || r.from_hub === hubs[o.hub] || r.to_hub === hubs[o.hub]))
    .map((r, i) => ({ id: `direct:${i}:${r.employee_id}:${r.recorded_at}`, request_no: '', format_id: '', kind, employee_id: r.employee_id, zone_id: '', hub_id: null,
      data: { full_name: r.full_name ?? '', employee_code: r.employee_code ?? '', mobile: r.mobile ?? '', position: r.position_name ?? '', from_hub: r.from_hub ?? '', hub: r.from_hub ?? '',
        to_hub: r.to_hub ?? '', effective_date: r.event_date ?? '', last_date: r.event_date ?? '', reason: r.reason ?? '' },
      note: null, status: 'done' as ReqStatus, submitted_by: '', submitter_employee_id: null, decided_by: null, decided_at: null, decision_note: null, result: null,
      ref_employee_id: null, ref_name: null, ref_code: null, ref_hub: null, ref_position: null, created_at: r.recorded_at }))
}

/** The rows of a sheet, taken from the system: one per request (requests sheet) or per employee (staff sheet). */
export async function buildSheet(sheet: Pick<CompanySheet, 'source' | 'kind' | 'format_id' | 'columns'>, o: BuildOpts): Promise<Built> {
  const chains = sheet.columns.map(c => srcParts(c.src))
  const all = chains.flat()
  const empFields = [...new Set([...all.filter(p => p.startsWith('emp:')).map(p => p.slice(4)), ...all.filter(p => p.startsWith('doc:')),
    ...(all.includes('ref') ? ['referrer_name', 'referrer_code'] : []), 'full_name', 'employee_code'])]
  const hubs = await hubNames()
  const cells = (i: number, emp: Record<string, unknown> | undefined, r: HrRequest | undefined) =>
    chains.map(ch => { for (const p of ch) { const v = valueOf(p, i, emp, r, hubs, o); if (v !== '' && v !== '—') return v } return '' })

  if (sheet.source === 'staff') {
    const base = await staffAdmin.exportRows(['employee_code', 'full_name'], { zone: o.zone, hub: o.hub, status: o.status, q: o.q })
    const ids = base.map(b => String(b._id))
    const people = await companySheets.people(ids, empFields)
    const seen = ids.filter(id => people[id])
    return { rows: seen.map((id, i) => ({ id, label: String(people[id].full_name ?? ''), cells: cells(i, people[id], undefined) })), hidden: ids.length - seen.length }
  }
  const ofKind = (await hrReq.between(o.from ?? null, o.to ?? null)).filter(r => r.kind === sheet.kind && (!sheet.format_id || r.format_id === sheet.format_id))
  const direct = o.withDirect && DIRECT_KINDS.includes(sheet.kind ?? 'custom') ? await directChanges(sheet.kind!, o, ofKind, hubs) : []
  const list = [...ofKind.filter(r => (!o.hub || r.hub_id === o.hub) && (!o.statuses?.length || o.statuses.includes(r.status))), ...direct]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const people = await companySheets.people([...new Set(list.map(r => r.employee_id).filter(Boolean) as string[])], empFields)
  return { rows: list.map((r, i) => { const emp = r.employee_id ? people[r.employee_id] : undefined
    return { id: r.id, label: String(r.data.full_name || emp?.full_name || r.request_no), status: r.status, direct: r.id.startsWith('direct:') || undefined, cells: cells(i, emp, r) } }), hidden: 0 }
}

/** The merged cells above the headings: the title and the grouped headings, placed as in the company's file. */
export function bandOf(sheet: Pick<CompanySheet, 'title' | 'title_at' | 'columns'>): Pick<LaidSheet, 'top' | 'topRows'> {
  const n = sheet.columns.length
  const groups: LaidSheet['top'] = []
  sheet.columns.forEach((c, i) => {
    const g = (c.group ?? '').trim(); if (!g) return
    const last = groups[groups.length - 1]
    if (last && last.text === g && last.c1 === i - 1) last.c1 = i; else groups.push({ text: g, c0: i, c1: i })
  })
  const top = [...groups]
  const title = (sheet.title ?? '').trim()
  if (title) {
    const grouped = (a: number, b: number) => groups.some(g => g.c0 <= b && g.c1 >= a)
    let at: [number, number] | null = sheet.title_at && sheet.title_at[0] >= 0 && sheet.title_at[1] < n && sheet.title_at[0] <= sheet.title_at[1] && !grouped(sheet.title_at[0], sheet.title_at[1]) ? sheet.title_at : null
    if (!at) {                                    // the longest run of columns with no grouped heading
      let s = -1
      for (let i = 0; i <= n; i++) {
        const free = i < n && !grouped(i, i)
        if (free && s < 0) s = i
        if (!free && s >= 0) { if (!at || i - 1 - s > at[1] - at[0]) at = [s, i - 1]; s = -1 }
      }
    }
    if (at) top.unshift({ text: title, c0: at[0], c1: at[1] })
  }
  return { top, topRows: top.length ? (groups.length ? 2 : 1) : 0 }
}

/** Downloads the sheet with these rows; SL is counted again so a sheet with some rows left out still runs 1, 2, 3. */
export function downloadSheet(sheet: Pick<CompanySheet, 'name' | 'title' | 'title_at' | 'columns' | 'file_name'>, rows: Array<Array<string | number>>): string {
  const slCols = sheet.columns.map((c, i) => (srcParts(c.src)[0] === 'sl' ? i : -1)).filter(i => i >= 0)
  const body = rows.map((r, ri) => r.map((v, ci) => (slCols.includes(ci) ? ri + 1 : v)))
  const base = (sheet.file_name || sheet.name).replace(/\.xlsx$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'company-sheet'
  const file = `${base} ${today()}.xlsx`
  download(laidXlsxBlob([{ name: 'Sheet1', ...bandOf(sheet), heads: sheet.columns.map(c => c.head), rows: body, widths: sheet.columns.map(c => c.w) }]), file)
  return file
}
