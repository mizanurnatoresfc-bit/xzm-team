// The hub's daily report sheet as one picture (PNG), drawn on a canvas — to send on WhatsApp or keep in the gallery.
// Every line of the day: update report IDs, merchant cash payments, expenses (with what stands for the bill:
// a photo, the company's own voucher, or nothing yet), the bank deposits, and the totals from the accounts centre.
// Nothing here is calculated anew: the totals are the ones da_center_overview gives (CenterRow).
import { dateBn, num, taka, timeBn, type Category, type CenterRow, type Sheet } from './dailyAccounts'

type Line = { cells: string[]; tone?: 'ok' | 'auto' | 'bad' }

const FONT = '"Hind Siliguri", "Noto Sans Bengali", system-ui, sans-serif'
const font = (size: number, bold = false) => `${bold ? '700 ' : ''}${size}px ${FONT}`

/** What stands for the bill of one expense line. */
export function billMark(x: Sheet['expenses'][number]): { text: string; tone: Line['tone'] } {
  if (x.attachment_path || x.claim_file) return { text: 'বিলের ছবি', tone: 'ok' }
  if (x.voucher_no) return { text: `অটো ${x.voucher_no}`, tone: 'auto' }
  if (x.bill_no) return { text: `বিল নং ${x.bill_no}`, tone: 'ok' }
  return { text: 'বিল/ভাউচার নেই', tone: 'bad' }
}

export async function reportCanvas(sheet: Sheet, row: CenterRow, cats: Category[]): Promise<HTMLCanvasElement> {
  try { await document.fonts?.ready } catch { /* system font is fine */ }
  const W = 1080, pad = 48, scale = 2
  const catName = (code: string) => { const c = cats.find(k => k.code === code); return c ? c.en : code }
  const reports: Line[] = (sheet.report_ids ?? []).map((r, i) => ({ cells: [num(i + 1), r.report_no, taka(r.amount)] }))
  const pays: Line[] = sheet.merchant_payments.map((p, i) => ({ cells: [num(i + 1), `${p.merchant_name}${p.payment_ref ? ` · ${p.payment_ref}` : ''}`, taka(p.amount)] }))
  const exps: Line[] = sheet.expenses.map((x, i) => {
    const m = billMark(x)
    return { cells: [num(i + 1), `${catName(x.category)} · ${x.expense_name}`, x.reference_name ?? '—', m.text, taka(x.amount)], tone: m.tone }
  })
  const deps: Line[] = (sheet.deposits ?? []).map((d, i) => ({
    cells: [num(i + 1), `${d.bank_name ?? d.method}${d.ref_no ? ` · ${d.ref_no}` : ''}`, d.slip_uploaded_at ? `স্লিপ ${timeBn(d.slip_uploaded_at)}` : 'স্লিপ বাকি', taka(d.amount)],
    tone: d.slip_path ? 'ok' : 'bad' }))
  const autoCount = sheet.expenses.filter(x => billMark(x).tone === 'auto').length
  const photoCount = sheet.expenses.filter(x => x.attachment_path || x.claim_file).length
  const missing = sheet.expenses.filter(x => billMark(x).tone === 'bad').length

  const ROW = 44, SEC = 64
  const sections: Array<[string, string[], Line[], number[]]> = [
    ['দৈনিক রিপোর্ট আইডি', ['ক্রম', 'রিপোর্ট আইডি', 'এমাউন্ট'], reports, [70, 700]],
    ['হাব ক্যাশ পেমেন্ট (মার্চেন্ট)', ['ক্রম', 'মার্চেন্ট · পেমেন্ট আইডি', 'এমাউন্ট'], pays, [70, 700]],
    ['হাব এক্সপেন্স', ['ক্রম', 'খাত · বিবরণ', 'রেফারেন্স', 'ভাউচার', 'এমাউন্ট'], exps, [70, 470, 640, 840]],
    ['ব্যাংকে জমা', ['ক্রম', 'ব্যাংক · রেফ', 'স্লিপ', 'এমাউন্ট'], deps, [70, 560, 840]],
  ]
  const body = sections.reduce((a, [, , l]) => a + SEC + ROW + Math.max(l.length, 1) * ROW + 16, 0)
  const H = 360 + body + 220
  const c = document.createElement('canvas')
  c.width = W * scale; c.height = H * scale
  const g = c.getContext('2d')!
  g.scale(scale, scale)
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H)

  // header
  g.fillStyle = '#15803D'; g.font = font(24, true); g.fillText('XZM TEAM · দৈনিক রিপোর্ট শীট', pad, pad + 24)
  g.fillStyle = '#111827'; g.font = font(40, true); g.fillText(`${row.name}`, pad, pad + 76)
  g.textAlign = 'right'; g.font = font(24, true); g.fillText(dateBn(sheet.session.account_date), W - pad, pad + 30)
  g.font = font(18); g.fillStyle = '#4b5563'
  g.fillText(`জমা: ${sheet.session.submitted_by_name ?? '—'}${sheet.session.submitted_at ? ` · ${timeBn(sheet.session.submitted_at)}` : ''}`, W - pad, pad + 62)
  g.fillText(`${row.zone} · হাব কোড ${sheet.hub.code}`, W - pad, pad + 88)
  g.textAlign = 'left'
  g.fillStyle = '#15803D'; g.fillRect(pad, pad + 108, W - pad * 2, 4)

  // three totals
  const tiles: Array<[string, string, string, string]> = [
    ['মোট কালেকশন', taka(row.report_total), '#f0fdf4', '#14532d'],
    ['পেমেন্ট + খরচ + চার্জ', `− ${taka(row.merchant + row.expense + row.bank_costs)}`, '#fff7ed', '#9a3412'],
    ['ব্যাংকে যাওয়ার কথা', taka(row.bank_amount), '#f3f4f6', '#111827'],
  ]
  const tw = (W - pad * 2 - 32) / 3
  tiles.forEach(([k, v, bg, fg], i) => {
    const x = pad + i * (tw + 16), y = pad + 132
    g.fillStyle = bg; roundRect(g, x, y, tw, 104, 14); g.fill()
    g.fillStyle = fg; g.font = font(18); g.fillText(k, x + 18, y + 34)
    g.font = font(32, true); g.fillText(v, x + 18, y + 80)
  })

  // sections
  let y = pad + 280
  for (const [title, head, lines, cols] of sections) {
    g.fillStyle = '#111827'; g.font = font(24, true); g.fillText(title, pad, y + 30)
    y += SEC
    g.fillStyle = '#f3f4f6'; g.fillRect(pad, y - 30, W - pad * 2, ROW)
    g.fillStyle = '#374151'; g.font = font(17, true)
    head.forEach((h, i) => drawCell(g, h, i, head.length, cols, pad, W, y))
    y += ROW
    if (!lines.length) { g.fillStyle = '#6b7280'; g.font = font(18); g.fillText('— কিছু নেই —', pad + 12, y); y += ROW }
    for (const l of lines) {
      g.font = font(19)
      l.cells.forEach((t, i) => {
        const isMark = head[i] === 'ভাউচার' || head[i] === 'স্লিপ'
        g.fillStyle = isMark && l.tone === 'auto' ? '#1e40af' : isMark && l.tone === 'bad' ? '#b91c1c' : isMark && l.tone === 'ok' ? '#14532d' : '#111827'
        if (isMark) g.font = font(17, true); else g.font = font(19)
        drawCell(g, t, i, l.cells.length, cols, pad, W, y)
      })
      g.strokeStyle = '#e5e7eb'; g.lineWidth = 1; g.beginPath(); g.moveTo(pad, y + 14); g.lineTo(W - pad, y + 14); g.stroke()
      y += ROW
    }
    y += 16
  }

  // footer: deposited and due
  const due = row.hub_due
  g.strokeStyle = '#111827'; g.lineWidth = 2; roundRect(g, pad, y, (W - pad * 2 - 16) / 2, 92, 14); g.stroke()
  g.fillStyle = '#111827'; g.font = font(20); g.fillText('ব্যাংকে জমা', pad + 20, y + 36)
  g.font = font(30, true); g.fillText(taka(row.deposited), pad + 20, y + 76)
  const x2 = pad + (W - pad * 2 - 16) / 2 + 16
  g.fillStyle = due > 0 ? '#fef2f2' : due < 0 ? '#eff6ff' : '#f0fdf4'; roundRect(g, x2, y, (W - pad * 2 - 16) / 2, 92, 14); g.fill()
  g.fillStyle = due > 0 ? '#991b1b' : due < 0 ? '#1e40af' : '#14532d'; g.font = font(20)
  g.fillText(due > 0 ? 'হাবের বকেয়া' : due < 0 ? 'হাবে ফান্ড দরকার' : 'হিসাব মিলেছে', x2 + 20, y + 36)
  g.font = font(30, true); g.fillText(taka(Math.abs(due)), x2 + 20, y + 76)
  y += 130
  g.fillStyle = '#4b5563'; g.font = font(17); g.textAlign = 'center'
  g.fillText(`ভাউচার: বিলের ছবি ${num(photoCount)}টা · অটো ${num(autoCount)}টা${missing ? ` · নেই ${num(missing)}টা` : ''} · সিস্টেম থেকে তৈরি ছবি`, W / 2, y)
  g.textAlign = 'left'
  return c
}

function drawCell(g: CanvasRenderingContext2D, text: string, i: number, n: number, cols: number[], pad: number, W: number, y: number) {
  const last = i === n - 1
  if (last) { g.textAlign = 'right'; g.fillText(text, W - pad - 12, y); g.textAlign = 'left'; return }
  const x = pad + 12 + (i === 0 ? 0 : cols[i - 1])
  const maxW = (i < cols.length ? cols[i] : W - pad * 2 - 160) - (i === 0 ? 0 : cols[i - 1]) - 20
  g.fillText(fit(g, text, maxW), x, y)
}

function fit(g: CanvasRenderingContext2D, t: string, maxW: number): string {
  if (g.measureText(t).width <= maxW) return t
  let s = t
  while (s.length > 1 && g.measureText(`${s}…`).width > maxW) s = s.slice(0, -1)
  return `${s}…`
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath()
}

/** Share the picture (phone share sheet → WhatsApp) where the browser can, otherwise download it. */
export async function shareReportPng(sheet: Sheet, row: CenterRow, cats: Category[]) {
  const c = await reportCanvas(sheet, row, cats)
  const name = `report-${sheet.hub.code}-${sheet.session.account_date}.png`
  const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'))
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[]; title?: string }) => Promise<void> }
  if (blob && nav.share && nav.canShare) {
    const file = new File([blob], name, { type: 'image/png' })
    if (nav.canShare({ files: [file] })) { try { await nav.share({ files: [file], title: 'দৈনিক রিপোর্ট' }); return } catch { return } }
  }
  const a = document.createElement('a')
  a.href = blob ? URL.createObjectURL(blob) : c.toDataURL('image/png')
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  if (blob) setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
