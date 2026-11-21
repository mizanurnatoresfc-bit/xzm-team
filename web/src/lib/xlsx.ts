// Minimal real .xlsx writer (stored zip, no library) for report downloads, plus print-to-PDF.
const enc = new TextEncoder()
const crcTable = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

function zip(files: Array<[string, string]>): Blob {
  const parts: Uint8Array[] = [], central: Uint8Array[] = []
  let offset = 0
  const u16 = (n: number) => [n & 255, (n >>> 8) & 255]
  const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
  for (const [name, text] of files) {
    const data = enc.encode(text), nm = enc.encode(name), crc = crc32(data)
    const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)])
    parts.push(head, nm, data)
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset)]), nm)
    offset += head.length + nm.length + data.length
  }
  const size = central.reduce((a, b) => a + b.length, 0)
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(size), ...u32(offset), ...u16(0)])
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// Characters XML forbids (a stray control character pasted into a name) are dropped: one of them makes Excel call the whole file damaged.
const x = (s: unknown) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const col = (i: number) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s }

export function xlsxBlob(title: string, subtitle: string, heads: string[], rows: Array<Array<string | number | null>>): Blob {
  const cell = (v: unknown, r: number, c: number, style = 0) => typeof v === 'number' && Number.isFinite(v)
    ? `<c r="${col(c)}${r}" s="${style}"><v>${v}</v></c>`
    : `<c r="${col(c)}${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${x(v)}</t></is></c>`
  const body = [
    `<row r="1">${cell(title, 1, 0, 1)}</row>`, `<row r="2">${cell(subtitle, 2, 0)}</row>`,
    `<row r="4">${heads.map((h, i) => cell(h, 4, i, 2)).join('')}</row>`,
    ...rows.map((r, ri) => `<row r="${ri + 5}">${r.map((v, ci) => cell(v, ri + 5, ci)).join('')}</row>`),
  ].join('')
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetData>${body}</sheetData></worksheet>`],
  ])
}

/** One sheet laid out like a company's own file: a band of merged headings on top, the column headings, then the rows — with borders, widths and print set-up. */
export type LaidSheet = {
  name: string
  /** Merged cells above the column headings (title, grouped headings); c0/c1 are column numbers from 0. */
  top: Array<{ text: string; c0: number; c1: number }>
  /** How many rows the band takes (0 = none). */
  topRows: number
  heads: string[]
  rows: Array<Array<string | number | null>>
  /** Column widths in Excel's units; missing ones are worked out from the text. */
  widths?: Array<number | null | undefined>
}

export function laidXlsxBlob(sheets: LaidSheet[]): Blob {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const cell = (v: unknown, r: number, c: number, style: number) => typeof v === 'number' && Number.isFinite(v)
    ? `<c r="${col(c)}${r}" s="${style}"><v>${v}</v></c>`
    : v === null || v === undefined || v === '' ? `<c r="${col(c)}${r}" s="${style}"/>`
    : `<c r="${col(c)}${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${x(v)}</t></is></c>`
  const used = new Set<string>()
  const sheetName = (n: string, i: number) => {
    let s = (n.replace(/[\\/?*[\]:]/g, ' ').trim() || `Sheet${i + 1}`).slice(0, 31), k = 2
    while (used.has(s.toLowerCase())) s = `${s.slice(0, 28)} ${k++}`
    used.add(s.toLowerCase()); return s
  }
  const names = sheets.map((s, i) => sheetName(s.name, i))
  const xml = sheets.map(s => {
    const n = Math.max(1, s.heads.length), hr = s.topRows + 1
    const widths = s.heads.map((h, i) => {
      const w = s.widths?.[i]
      if (w && w > 1) return Math.min(80, w)
      const longest = Math.max(h.length, ...s.rows.slice(0, 200).map(r => String(r[i] ?? '').split('\n').reduce((m, l) => Math.max(m, l.length), 0)))
      return Math.min(45, Math.max(9, longest + 3))
    })
    const merges: string[] = []
    let band = ''
    if (s.topRows > 0) {
      // every cell under a merged heading is written (so its border draws fully); the text sits in the first cell
      const at = new Map<number, string>(), under = new Set<number>()
      for (const t of s.top) {
        const c0 = Math.max(0, Math.min(n - 1, t.c0)), c1 = Math.max(c0, Math.min(n - 1, t.c1))
        at.set(c0, t.text)
        for (let c = c0; c <= c1; c++) under.add(c)
        if (c1 > c0 || s.topRows > 1) merges.push(`${col(c0)}1:${col(c1)}${s.topRows}`)
      }
      // columns with nothing above them stay plain, as in the company's own file
      for (let r = 1; r <= s.topRows; r++)
        band += `<row r="${r}" ht="${s.topRows > 1 ? 18 : 26}" customHeight="1">${Array.from({ length: n }, (_, c) => (under.has(c) ? cell(r === 1 ? at.get(c) ?? '' : '', r, c, 1) : '')).join('')}</row>`
    }
    const body = band + `<row r="${hr}" ht="32" customHeight="1">${s.heads.map((h, i) => cell(h, hr, i, 2)).join('')}</row>`
      + s.rows.map((r, ri) => `<row r="${hr + 1 + ri}">${Array.from({ length: n }, (_, ci) => cell(r[ci], hr + 1 + ri, ci, ci === 0 ? 4 : 3)).join('')}</row>`).join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`
      + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${hr}" topLeftCell="A${hr + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      + `<sheetFormatPr defaultRowHeight="18"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      + `<sheetData>${body}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}`
      + `<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`
  })
  const edge = '<left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/>'
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}">`
    + '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${edge}</border></borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
    + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="${rel}"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ...xml.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s] as [string, string]),
  ])
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

// PDF = the browser's print window ("Save as PDF"). The page's print CSS shows only .print-area.
export function printArea(title: string) {
  const old = document.title
  document.title = title
  const done = () => { document.title = old; window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  window.print()
}
