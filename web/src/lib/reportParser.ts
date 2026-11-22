// ডেইলি রিপোর্ট ইম্পোর্ট — reads the pasted text of the courier panel's "Update Report" page.
// Pure functions only (no database, no browser): the same text gives the same answer, and the
// tests in web/tests/reportParser.test.mjs run it with plain Node.
//
// The text may come with line breaks, with tabs, or as one long line. Nothing is guessed: a part
// that cannot be read is an error, and a report whose three checks do not pass is never saved.

export type ParsedList = {
  /** The list ID on the courier panel (8 digits). */
  list_no: string
  /** "Point delivery" has no rider. */
  point: boolean
  rider_code: string | null
  rider_name: string | null
  parcels: number
  amount: number
}

export type ParsedReport = {
  report_no: string
  hub_text: string
  manager_code: string
  manager_name: string
  /** The report's own date and time as written, Asia/Dhaka: "2026-11-16T20:37:00". */
  reported_at: string
  report_date: string
  collected: number
  delivery_charge: number
  declared_lists: number
  declared_parcels: number
  lists: ParsedList[]
  /** The page's own "Total" line, when it was in the text. */
  total_parcels: number | null
  total_amount: number | null
}

export type CheckKey = 'amount' | 'parcels' | 'lists'
export type Check = { key: CheckKey; ok: boolean; expected: number; got: number }

export type ParseResult = {
  report: ParsedReport | null
  /** What could not be read (Bengali, shown to the person). */
  errors: string[]
  checks: Check[]
  sums: { lists: number; parcels: number; amount: number }
  /** True only when everything was read and all three checks pass. */
  ok: boolean
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯'
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const MONEY = String.raw`(?:৳|Tk\.?|BDT)?\s*(-?[\d,]+(?:\.\d{1,2})?)`

/** Money as whole paisa, so sums never pick up a floating-point tail. */
const paisa = (s: string) => Math.round(Number(s.replace(/,/g, '')) * 100)
const pad = (n: number) => String(n).padStart(2, '0')

/** Bengali digits to ASCII, odd spaces to plain ones. Line breaks are kept. */
function clean(text: string): string {
  return text.replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d)))
    .replace(/[  -​ ﻿]/g, ' ').replace(/\r\n?/g, '\n')
}
const flat = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The avatar letter the page prints before a name ("M Md Sazib Ali") is dropped. */
export function stripInitial(name: string): string {
  const m = /^(\p{L})\s+(\S.*)$/u.exec(name.trim())
  return m && m[2][0].toLowerCase() === m[1].toLowerCase() ? m[2].trim() : name.trim()
}

/** The three checks, on whole paisa. Used by the page and mirrored by the database function. */
export function checkReport(r: Pick<ParsedReport, 'collected' | 'delivery_charge' | 'declared_lists' | 'declared_parcels' | 'lists'>) {
  const amount = r.lists.reduce((a, l) => a + Math.round(l.amount * 100), 0)
  const parcels = r.lists.reduce((a, l) => a + l.parcels, 0)
  const got = amount + Math.round(r.delivery_charge * 100), want = Math.round(r.collected * 100)
  const checks: Check[] = [
    { key: 'amount', ok: got === want, expected: want / 100, got: got / 100 },
    { key: 'parcels', ok: parcels === r.declared_parcels, expected: r.declared_parcels, got: parcels },
    { key: 'lists', ok: r.lists.length === r.declared_lists, expected: r.declared_lists, got: r.lists.length },
  ]
  return { checks, sums: { lists: r.lists.length, parcels, amount: amount / 100 } }
}

/**
 * Read one pasted "Update Report".
 * `hubNames` (optional) helps to tell the hub from the manager's name when the text came as one line.
 */
export function parseReport(text: string, opts: { hubNames?: string[] } = {}): ParseResult {
  const errors: string[] = []
  const src = clean(text ?? '')
  const s = flat(src)
  const none: ParseResult = { report: null, errors, checks: [], sums: { lists: 0, parcels: 0, amount: 0 }, ok: false }
  if (!s) { errors.push('রিপোর্টের লেখা পেস্ট করুন।'); return none }

  const rep = /Update\s+Report\s*#\s*(\d+)/i.exec(s)
  if (!rep) { errors.push('রিপোর্ট আইডি পাওয়া যায়নি ("Update Report #…" লেখাটা সহ পুরো পাতা পেস্ট করুন)।'); return none }

  // Hub, manager and date sit between the report ID and "COLLECTED".
  const headEnd = s.search(/\bCOLLECTED\b/i)
  const head = s.slice(rep.index + rep[0].length, headEnd < 0 ? undefined : headEnd)
  const who = /^(.*?)\s*#\s*(\d+)\s+(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AP])\.?M\.?/i.exec(head.trim())
  let hub_text = '', manager_name = '', manager_code = '', reported_at = '', report_date = ''
  if (!who) errors.push('ম্যানেজার আইডি বা রিপোর্টের তারিখ-সময় পাওয়া যায়নি।')
  else {
    manager_code = who[2]
    const month = MONTHS[who[4].toLowerCase()]
    let hour = Number(who[6]) % 12
    if (who[8].toUpperCase() === 'P') hour += 12
    if (!month || Number(who[3]) < 1 || Number(who[3]) > 31 || Number(who[7]) > 59) errors.push('রিপোর্টের তারিখ পড়া যায়নি।')
    else {
      report_date = `${who[5]}-${pad(month)}-${pad(Number(who[3]))}`
      reported_at = `${report_date}T${pad(hour)}:${who[7]}:00`
    }
    ;[hub_text, manager_name] = splitHubManager(src, rep[1], who[1], opts.hubNames ?? [])
  }

  const col = new RegExp(String.raw`\bCOLLECTED\s*:?\s*${MONEY}`, 'i').exec(s)
  if (!col) errors.push('"COLLECTED" টাকার অঙ্ক পাওয়া যায়নি।')
  const dec = /(\d+)\s*lists?\s*[·•.,|/-]?\s*(\d+)\s*parcels?/i.exec(s)
  if (!dec) errors.push('ঘোষিত লিস্ট ও পার্সেল সংখ্যা ("8 lists · 190 parcels") পাওয়া যায়নি।')
  const chg = new RegExp(String.raw`DELIVERY\s+CHARGES?(?:\s+PAID)?\s*:?\s*${MONEY}`, 'i').exec(s)
  if (!chg) errors.push('"DELIVERY CHARGES PAID" টাকার অঙ্ক পাওয়া যায়নি।')

  // Lists: every "#" followed by exactly 8 digits starts one; it runs to the next one or to "Total".
  const lists: ParsedList[] = []
  const starts = [...s.matchAll(/#\s*(\d{8})(?!\d)/g)]
  const totalAt = (() => { let at = -1; for (const m of s.matchAll(/\bTotal\b/gi)) at = m.index; return at })()
  const lastStart = starts.length ? starts[starts.length - 1].index : -1
  const rider = new RegExp(String.raw`^(.+?)\s*#\s*(\d+)\s+(\d+)\s+(?:[\d.]+\s*%|[—–-])?\s*${MONEY}`)
  const point = new RegExp(String.raw`^Point\s+delivery\s+(\d+)\s+(?:[\d.]+\s*%|[—–-])?\s*${MONEY}`, 'i')
  const seen = new Set<string>()
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : totalAt > m.index ? totalAt : s.length
    const body = s.slice(m.index + m[0].length, end).trim()
    const no = m[1]
    if (seen.has(no)) { errors.push(`লিস্ট #${no} এই রিপোর্টে দুইবার আছে।`); return }
    seen.add(no)
    const p = point.exec(body)
    if (p) { lists.push({ list_no: no, point: true, rider_code: null, rider_name: null, parcels: Number(p[1]), amount: paisa(p[2]) / 100 }); return }
    const r = rider.exec(body)
    if (r) { lists.push({ list_no: no, point: false, rider_code: r[2], rider_name: stripInitial(r[1]), parcels: Number(r[3]), amount: paisa(r[4]) / 100 }); return }
    errors.push(`লিস্ট #${no} পড়া যায়নি।`)
  })
  if (!starts.length) errors.push('কোনো লিস্ট (৮ অঙ্কের লিস্ট আইডি) পাওয়া যায়নি।')

  const tot = totalAt > lastStart && lastStart >= 0 ? new RegExp(String.raw`^Total\s+(\d+)\s+${MONEY}`, 'i').exec(s.slice(totalAt)) : null

  const report: ParsedReport = {
    report_no: rep[1], hub_text, manager_code, manager_name, reported_at, report_date,
    collected: col ? paisa(col[1]) / 100 : 0, delivery_charge: chg ? paisa(chg[1]) / 100 : 0,
    declared_lists: dec ? Number(dec[1]) : 0, declared_parcels: dec ? Number(dec[2]) : 0, lists,
    total_parcels: tot ? Number(tot[1]) : null, total_amount: tot ? paisa(tot[2]) / 100 : null,
  }
  const { checks, sums } = checkReport(report)
  return { report, errors, checks, sums, ok: errors.length === 0 && checks.every(c => c.ok) }
}

/** "Gurudaspur (Natore) MD. RASHED MIAH" -> hub and manager name. */
function splitHubManager(src: string, reportNo: string, joined: string, hubNames: string[]): [string, string] {
  // With line breaks: the hub is the line after the report ID, the manager the line after that.
  const lines = src.split(/[\n\t]+/).map(flat).filter(Boolean)
  const at = lines.findIndex(l => new RegExp(String.raw`Update\s+Report\s*#\s*${reportNo}\s*$`, 'i').test(l))
  if (at >= 0 && lines[at + 2] && /#\s*\d+\s*$/.test(lines[at + 2]) && !/#/.test(lines[at + 1]))
    return [lines[at + 1], lines[at + 2].replace(/\s*#\s*\d+\s*$/, '')]
  // One line: a hub name we know, else up to the closing bracket of "Hub (District)".
  const j = joined.trim(), low = j.toLowerCase()
  const known = [...hubNames].sort((a, b) => b.length - a.length).find(h => h && low.startsWith(h.toLowerCase() + ' '))
  if (known) return [j.slice(0, known.length), j.slice(known.length).trim()]
  const close = j.lastIndexOf(')')
  if (close > 0 && close < j.length - 1) return [j.slice(0, close + 1).trim(), j.slice(close + 1).trim()]
  return ['', j]
}
