// Reads an .xlsx file (or a .csv) in the browser, with no extra library:
// an .xlsx is a zip of XML files; the browser's DecompressionStream unpacks it.
// Returns rows as arrays of cell text (dates stay as Excel serial numbers; see excelDate()).

type Entry = { name: string; method: number; compSize: number; offset: number }

function zipEntries(buf: ArrayBuffer): Entry[] {
  const v = new DataView(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not_xlsx')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out: Entry[] = []
  const dec = new TextDecoder()
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true), compSize = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true)
    const offset = v.getUint32(p + 42, true)
    out.push({ name: dec.decode(new Uint8Array(buf, p + 46, nameLen)), method, compSize, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function readEntry(buf: ArrayBuffer, e: Entry): Promise<string> {
  const v = new DataView(buf)
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true)
  const data = new Uint8Array(buf, start, e.compSize)
  if (e.method === 0) return new TextDecoder().decode(data)
  if (e.method !== 8) throw new Error('not_xlsx')
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return await new Response(stream).text()
}

const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml')
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }

/** One worksheet as the company laid it out: the cell texts, which cells are merged and how wide each column is. */
export type BookSheet = { name: string; rows: string[][]; merges: Array<{ r0: number; c0: number; r1: number; c1: number }>; widths: Record<number, number> }

async function readBook(file: File, onlyFirst: boolean): Promise<BookSheet[]> {
  const buf = await file.arrayBuffer()
  const entries = zipEntries(buf)
  const get = async (name: string) => { const e = entries.find(x => x.name === name); return e ? await readEntry(buf, e) : null }
  const shared: string[] = []
  const ss = await get('xl/sharedStrings.xml')
  // phonetic guides (<rPh>) are not part of the text
  if (ss) for (const si of Array.from(xml(ss).getElementsByTagName('si'))) shared.push(Array.from(si.getElementsByTagName('t')).filter(t => t.parentElement?.tagName !== 'rPh').map(t => t.textContent ?? '').join(''))
  // sheets in workbook order
  let list: Array<{ name: string; path: string }> = [{ name: 'Sheet1', path: 'xl/worksheets/sheet1.xml' }]
  const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels')
  if (wb && rels) {
    const relList = Array.from(xml(rels).getElementsByTagName('Relationship'))
    const found = Array.from(xml(wb).getElementsByTagName('sheet')).map(sh => {
      const rid = sh.getAttribute('r:id') ?? sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      const target = relList.find(r => r.getAttribute('Id') === rid)?.getAttribute('Target')
      return target ? { name: sh.getAttribute('name') ?? '', path: target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '') } : null
    }).filter(Boolean) as Array<{ name: string; path: string }>
    if (found.length) list = found
  }
  const out: BookSheet[] = []
  for (const item of onlyFirst ? list.slice(0, 1) : list) {
    const sheet = await get(item.path)
    if (!sheet) { if (onlyFirst) throw new Error('not_xlsx'); continue }
    const doc = xml(sheet)
    const rows: string[][] = []
    for (const row of Array.from(doc.getElementsByTagName('row'))) {
      const r = Number(row.getAttribute('r') ?? rows.length + 1) - 1
      const cells: string[] = []
      for (const c of Array.from(row.getElementsByTagName('c'))) {
        const t = c.getAttribute('t'), ref = c.getAttribute('r')
        const vEl = c.getElementsByTagName('v')[0]
        let val = ''
        if (t === 's') val = shared[Number(vEl?.textContent ?? -1)] ?? ''
        else if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map(x => x.textContent ?? '').join('')
        else val = vEl?.textContent ?? ''
        cells[ref ? colIndex(ref) : cells.length] = val.trim()
      }
      rows[r] = Array.from(cells, x => x ?? '')
    }
    const merges = Array.from(doc.getElementsByTagName('mergeCell')).map(m => {
      const [a, b = a] = (m.getAttribute('ref') ?? '').split(':')
      const rowOf = (s: string) => Number(s.replace(/[^0-9]/g, '')) - 1
      return { r0: rowOf(a), c0: colIndex(a), r1: rowOf(b), c1: colIndex(b) }
    }).filter(m => m.r0 >= 0 && m.c0 >= 0)
    const widths: Record<number, number> = {}
    for (const c of Array.from(doc.getElementsByTagName('col'))) {
      const min = Number(c.getAttribute('min')), max = Number(c.getAttribute('max')), w = Number(c.getAttribute('width'))
      if (!(w > 0) || !(min > 0) || c.getAttribute('hidden') === '1') continue
      for (let i = min; i <= Math.min(max, min + 200); i++) widths[i - 1] = Math.round(w * 10) / 10
    }
    out.push({ name: item.name, rows: Array.from(rows, x => x ?? []), merges, widths })
  }
  return out
}

async function readXlsx(file: File): Promise<string[][]> {
  const first = (await readBook(file, true))[0]
  if (!first) throw new Error('not_xlsx')
  return first.rows
}

/** Every worksheet of an .xlsx with its merged cells and column widths — for learning a company's layout from its own file. */
export async function readWorkbook(file: File): Promise<BookSheet[]> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('শুধু .xlsx ফাইল দিন (পুরনো .xls হলে Excel-এ "Save As → .xlsx" করে নিন)')
  if (typeof DecompressionStream === 'undefined') throw new Error('এই ব্রাউজারে এক্সেল পড়া যাচ্ছে না — Chrome আপডেট করুন')
  let book: BookSheet[]
  try { book = await readBook(file, false) } catch { throw new Error('ফাইলটা পড়া যায়নি — এক্সেলে খুলে .xlsx হিসেবে আবার সেভ করে দিন') }
  if (!book.length) throw new Error('ফাইলে কোনো শিট পাওয়া যায়নি')
  return book
}

function readCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch; continue }
    if (ch === '"') q = true
    else if (ch === ',') { row.push(cell.trim()); cell = '' }
    else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  return rows
}

/** Rows of the first sheet (or the CSV), each an array of cell texts. */
export async function readSheet(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name)) return readCsv((await file.text()).replace(/^﻿/, ''))
  if (!/\.xlsx$/i.test(file.name)) throw new Error('শুধু .xlsx বা .csv ফাইল দিন (পুরনো .xls হলে Excel-এ "Save As → .xlsx" করে নিন)')
  if (typeof DecompressionStream === 'undefined') throw new Error('এই ব্রাউজারে এক্সেল পড়া যাচ্ছে না — Chrome আপডেট করুন অথবা CSV দিন')
  try { return await readXlsx(file) } catch { throw new Error('ফাইলটা পড়া যায়নি — এক্সেলে খুলে .xlsx হিসেবে আবার সেভ করে দিন') }
}

/** Excel stores dates as day numbers (1 = 1900-01-01). Converts "45231" to "2023-11-01"; other text unchanged. */
export function excelDate(v: string): string {
  if (!/^\d{4,5}(\.\d+)?$/.test(v)) return v
  const ms = Math.round((Number(v) - 25569) * 86400000)
  return new Date(ms).toISOString().slice(0, 10)
}
