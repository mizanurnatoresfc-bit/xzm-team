// Steadfast panel PDFs for the day's parcel plan: "Update list" (what one rider got and delivered) and "Dispatch"
// (what a sorting centre sent to the hub). The file is read in the browser; only numbers, parcel ids and the rider's
// id leave the device — never a customer's name, phone or address.

export type PdfItem = { s: string; x: number; y: number; w?: number }
export type PdfAreaRow = { id: number; text: string }
export type PdfKind = 'update_list' | 'dispatch'
export type ParsedPdf = {
  kind: PdfKind; doc_no: string; doc_date: string | null; hub_text: string | null; from_text: string | null
  rider_code: string | null; rider_name: string | null
  /** update_list: parcels, delivered, cod_total, declared_parcels, declared_delivered, declared_total, status:<name>
   *  dispatch: pieces, parcels, for_hub, other_hub, cancelled, point, received, not_scanned, unscanned_delivered, declared_*, status:<name> */
  counts: Record<string, number>
  parcel_ids: number[]
  warnings: string[]
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const iso = (d: string, m: string, y: string) => { const i = MONTHS.indexOf(m.slice(0, 3).toLowerCase()); return i < 0 ? null : `${y}-${String(i + 1).padStart(2, '0')}-${d.padStart(2, '0')}` }
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+([,.:])/g, '$1').trim()
const money = (s: string) => Number(s.replace(/[^\d.]/g, '')) || 0
const add = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n }
const statusKey = (s: string) => `status:${tidy(s).toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '') || 'unknown'}`

/** The table of one page: where each column starts, and the items under the heading. */
function table(page: PdfItem[], heads: string[]) {
  for (const first of page.filter(i => tidy(i.s) === heads[0])) {
    const line = page.filter(i => i.x >= first.x && Math.abs(i.y - first.y) < 2).sort((a, b) => a.x - b.x)
    const col: Record<string, number> = {}
    let cursor = 0
    for (const heading of heads) {
      for (; cursor < line.length; cursor++) {
        const x = line[cursor].x
        let label = ''
        for (let i = cursor; i < line.length; i++) {
          label = tidy(label + ' ' + line[i].s)
          if (!heading.startsWith(label)) break
          if (heading === label) {
            col[heading] = x
            cursor = i + 1
            break
          }
        }
        if (heading in col) break
      }
    }
    if (Object.keys(col).length === heads.length) return { col, body: page.filter(i => i.y < first.y - 2) }
  }
  return null
}
/** Items of a row: from just above its first line down to the next row (or a little below, for the last row of a page). */
function bands(body: PdfItem[], starts: PdfItem[], above: number, lastDepth: number) {
  const s = [...starts].sort((a, b) => b.y - a.y)
  return s.map((st, i) => { const top = st.y + above, bottom = i + 1 < s.length ? s[i + 1].y + above : st.y - lastDepth
    return { start: st, items: body.filter(it => it.y <= top && it.y > bottom) } })
}
const inCol = (items: PdfItem[], from: number, to: number) => items.filter(i => i.x >= from - 2 && i.x < to - 2).sort((a, b) => b.y - a.y || a.x - b.x)
const words = (items: PdfItem[]) => tidy(items.map(i => i.s).join(' '))

function updateList(pages: PdfItem[][], head: string, areaRows?: PdfAreaRow[]): ParsedPdf {
  const warnings: string[] = []
  const no = head.match(/Update\s+list\s+#\s*(\d{5,12})/)
  if (!no) throw new Error('Update list number not found')
  const made = head.match(/Created\s*:\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/)
  const hub = head.match(/Hub\s*:\s*(.+?)\s+Created/)
  const riderItem = pages[0].find(i => /^#\d{1,12}\s*·/.test(i.s.trim()) || /^#\d{1,12}$/.test(i.s.trim()) && pages[0].some(j => j.s === 'RIDER' && Math.abs(j.x - i.x) < 120 && j.y > i.y && j.y - i.y < 25))
  const rider_code = riderItem?.s.match(/#(\d{1,12})/)?.[1] ?? null
  const rider_name = riderItem ? tidy(pages[0].filter(i => Math.abs(i.y - riderItem.y) < 2 && i.x < riderItem.x).sort((a, b) => a.x - b.x).map(i => i.s).join(' ')) || null : null
  if (!rider_code) warnings.push('rider')
  const counts: Record<string, number> = { parcels: 0, delivered: 0, cod_total: 0 }
  const ids: number[] = []
  for (const page of pages) {
    const t = table(page, ['PARCEL', 'MERCHANT', 'CUSTOMER', 'COD', 'OUTCOME'])
    if (!t) continue
    // a parcel line has the row number at its left; an invoice number that wraps under the parcel id has not
    const starts = t.body.filter(i => Math.abs(i.x - t.col.PARCEL) < 3 && /^\d{8,10}$/.test(i.s.trim())
      && t.body.some(j => j.x < t.col.PARCEL - 5 && Math.abs(j.y - i.y) < 2 && /^\d{1,4}$/.test(j.s.trim())))
    for (const row of bands(t.body, starts, 3, 45)) {
      const line = row.items.filter(i => Math.abs(i.y - row.start.y) < 2)
      const cod = money(words(line.filter(i => i.x > t.col.CUSTOMER + 120 && i.x < t.col.OUTCOME - 2)))
      const outcome = words(inCol(row.items, t.col.OUTCOME, 9999).filter(i => row.start.y - i.y < 30)) || 'unknown'
      if (areaRows) areaRows.push({ id: Number(row.start.s.trim()), text: words(inCol(row.items, t.col.CUSTOMER, t.col.COD)) })
      ids.push(Number(row.start.s.trim())); counts.parcels++; counts.cod_total += cod
      add(counts, statusKey(outcome))
      if (/^deliver/i.test(outcome)) counts.delivered++
    }
  }
  const dec = head.match(/(\d+)\s+Parcels\s+(\d+)\s+Delivered/)
  if (dec) { counts.declared_parcels = Number(dec[1]); counts.declared_delivered = Number(dec[2]) }
  const total = head.match(/৳\s*([\d,]+)\s+List\s+total/)
  if (total) counts.declared_total = money(total[1])
  if (!counts.parcels) throw new Error('No parcel rows found in the update list')
  if (dec && counts.parcels !== counts.declared_parcels) warnings.push('rows')
  if (total && Math.round(counts.cod_total) !== counts.declared_total) warnings.push('total')
  return { kind: 'update_list', doc_no: no[1], doc_date: made ? iso(made[1], made[2], made[3]) : null, hub_text: hub ? tidy(hub[1]) : null, from_text: null,
    rider_code, rider_name, counts, parcel_ids: ids, warnings }
}

function dispatch(pages: PdfItem[][], head: string, areaRows?: PdfAreaRow[]): ParsedPdf {
  const warnings: string[] = []
  const no = head.match(/DISPATCH\s+#\s*(\d{5,12})\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/) ?? head.match(/DISPATCH\s+#\s*(\d{5,12})/)
  if (!no) throw new Error('Dispatch number not found')
  const way = head.match(/FROM\s+(.+?)\s+TO\s+(.+?)\s+(\d+)\s+parcels\s+(\d+)\s+received/)
  const more = head.match(/(\d+)\s+not\s+scanned\s+in\s+(\d+)\s+bound\s+for\s+another\s+hub/)
  type P = { pieces: number; other: boolean; status: string; received: boolean; point: boolean }
  const parcels = new Map<number, P>()
  const counts: Record<string, number> = { pieces: 0, received: 0, not_scanned: 0 }
  const addressRows: PdfAreaRow[] = []
  let cut = false
  for (const page of pages) {
    const t = table(page, ['PARCEL', 'MERCHANT', 'CUSTOMER', 'DESTINATION', 'STATUS'])
    if (!t) continue
    const recv = page.find(i => /^RECEIV/.test(i.s) && Math.abs(i.x - t.col.STATUS) > 20 && i.x > t.col.STATUS)
    if (recv && recv.s !== 'RECEIVED') cut = true
    const rx = recv?.x ?? 9999
    const starts = t.body.filter(i => Math.abs(i.x - t.col.PARCEL) < 3 && /^#\d{8,10}$/.test(i.s.trim()))
    for (const row of bands(t.body, starts, 6, 50)) {
      const id = Number(row.start.s.trim().slice(1))
      if (areaRows) addressRows.push({ id, text: words(inCol(row.items, t.col.CUSTOMER, t.col.DESTINATION)) })
      const status = words(inCol(row.items, t.col.STATUS, rx).filter(i => row.start.y + 6 - i.y < 20)) || 'unknown'
      const got = words(inCol(row.items, rx, 9999))
      const received = /Rece/i.test(got) && !/^Not/i.test(got)
      const other = /Bound\s+for/i.test(words(inCol(row.items, t.col.DESTINATION, t.col.STATUS)))
      const point = inCol(row.items, t.col.CUSTOMER, t.col.DESTINATION).some(i => i.s.trim() === 'Point')
      counts.pieces++; add(counts, received ? 'received' : 'not_scanned')
      const p = parcels.get(id)
      if (p) { p.pieces++; p.other ||= other; p.received ||= received; p.point ||= point }
      else parcels.set(id, { pieces: 1, other, status, received, point })
    }
  }
  if (!parcels.size) throw new Error('No parcel rows found in the dispatch sheet')
  if (areaRows) {
    for (const row of addressRows) {
      const parcel = parcels.get(row.id)!
      if (!parcel.other && !/^cancel/i.test(parcel.status)) areaRows.push(row)
    }
  }
  const all = [...parcels.values()]
  counts.parcels = all.length
  counts.other_hub = all.filter(p => p.other).length
  counts.for_hub = counts.parcels - counts.other_hub
  counts.cancelled = all.filter(p => !p.other && /^cancel/i.test(p.status)).length
  counts.point = all.filter(p => !p.other && p.point).length
  counts.unscanned_delivered = all.filter(p => !p.received && /^deliver/i.test(p.status)).length
  for (const p of all) add(counts, statusKey(p.status))
  if (way) { counts.declared_pieces = Number(way[3]); counts.declared_received = Number(way[4]) }
  if (more) { counts.declared_not_scanned = Number(more[1]); counts.declared_other_hub = Number(more[2]) }
  if (way && counts.pieces !== counts.declared_pieces) warnings.push('rows')
  if (cut) warnings.push('cut')
  return { kind: 'dispatch', doc_no: no[1], doc_date: no[2] ? iso(no[2], no[3], no[4]) : null, hub_text: way ? tidy(way[2]) : null, from_text: way ? tidy(way[1]) : null,
    rider_code: null, rider_name: null, counts, parcel_ids: [...parcels.keys()], warnings }
}


/** The rider panel's mobile print layout is separate from the Update list report. */
function deliveryList(pages: PdfItem[][], head: string, areaRows: PdfAreaRow[]) {
  const date = head.match(/\bDate\s*:\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/)
  const hub = head.match(/\bHub\s*:\s*(.+?)\s+Assigned By\s*:/)?.[1] ?? null
  const hubLabel = hub?.split('(')[0].trim().toLowerCase()
  const declared = Number(head.match(/\bGrand Total\s*:\s*(\d+)/)?.[1] ?? 0)
  const declaredNew = head.match(/\bTotal Parcels\s*\(\s*New\s*\)\s*:\s*(\d+)/i)
  const declaredOld = head.match(/\bTotal Parcels\s*\(\s*Old from other lists\s*\)\s*:\s*(\d+)/i)
  const ids = new Set<number>()
  for (const page of pages) {
    const t = table(page, ['ID', 'MERCHANT DETAILS', 'INVOICE', 'CUSTOMER DETAILS'])
    if (!t) continue
    const starts = t.body.filter(i => Math.abs(i.x - t.col.ID) < 4 && /^#\d{8,12}$/.test(i.s.trim()))
    for (const row of bands(t.body, starts, 2, 48)) {
      const id = Number(row.start.s.trim().slice(1))
      if (ids.has(id)) continue
      ids.add(id)
      const items = inCol(row.items, t.col['CUSTOMER DETAILS'], Infinity)
        .filter(i => i.y < row.start.y - 2 && row.start.y - i.y <= 42 && i.s.trim().toLowerCase() !== hubLabel)
      let address = ''
      let previous: PdfItem | undefined
      for (const item of items) {
        if (previous && (Math.abs(previous.y - item.y) > 2
          || item.x - (previous.x + (previous.w ?? 0)) > 1.2)) address += ' '
        address += item.s.replace(/\x00/g, '')
        previous = item
      }
      areaRows.push({ id, text: address.trim() })
    }
  }
  if (!ids.size) throw new Error('No parcel rows found in the delivery list')
  return {
    kind: 'update_list', doc_no: '', doc_date: date ? iso(date[2], date[1], date[3]) : null,
    hub_text: hub, from_text: null, rider_code: null, rider_name: null,
    counts: { parcels: ids.size, declared_parcels: declared,
      ...(declaredNew && { declared_new: Number(declaredNew[1]) }),
      ...(declaredOld && { declared_old: Number(declaredOld[1]) }) },
    parcel_ids: [...ids], warnings: declared && declared !== ids.size ? ['rows'] : [],
  } satisfies ParsedPdf
}

/** What a Steadfast panel PDF says, from its text items (page by page). Throws when it is neither an Update list nor a Dispatch sheet. */
export function parsePlanPdf(pages: PdfItem[][], areaRows?: PdfAreaRow[]): ParsedPdf {
  const head = (pages[0] ?? []).map(i => i.s).join(' ').replace(/\s+/g, ' ')
  if (areaRows && /Delivery List Information/i.test(head)) return deliveryList(pages, head, areaRows)
  if (/Update\s+list\s+#/.test(head)) return updateList(pages, head, areaRows)
  if (/DISPATCH\s+#/.test(head)) return dispatch(pages, head, areaRows)
  throw new Error('Not an Update list or a Dispatch sheet')
}

/** Read a PDF file in the browser (the reader is loaded only when a file is picked). */
export async function readPlanPdf(file: File, areaRows?: PdfAreaRow[]): Promise<ParsedPdf> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  try {
    if (doc.numPages > 120) throw new Error('The file has too many pages')
    const pages: PdfItem[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const text = await (await doc.getPage(n)).getTextContent()
      pages.push(text.items.flatMap(i => 'str' in i && i.str.trim() ? [{ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }] : []))
    }
    if (!pages.some(page => page.length)) throw new Error('This PDF has no readable text. Use a text-based export.')
    return parsePlanPdf(pages, areaRows)
  } finally { void doc.destroy() }
}
