// The expense voucher as a picture (PNG), drawn on a canvas — to send on WhatsApp or keep in a phone gallery.
// The print/PDF copy stays in voucher.ts; this draws the same facts in the page's own Bangla font.
import type { Category, VoucherData } from './dailyAccounts'
import { takaInWords } from './voucher'

const bn = (v: number | string) => String(v).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[+d])
const dmy = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return bn(`${d}/${m}/${y}`) }

/** Draws the voucher; returns the canvas so it can also be shared. */
export async function voucherCanvas(v: VoucherData, cat: Category | undefined): Promise<HTMLCanvasElement> {
  try { await document.fonts?.ready } catch { /* fonts API missing: system font is fine */ }
  const W = 1000, pad = 40, scale = 2
  const rows: Array<[string, string]> = [
    ['ভাউচার নম্বর', v.voucher_no ?? '—'],
    ['হাব', `${v.hub}${v.zone ? ` · ${v.zone}` : ''}`],
    ['তারিখ', `${dmy(v.bill_date)} · হিসাবের দিন ${dmy(v.account_date)}`],
    ['খরচের খাত', cat ? `${cat.bn} (${cat.en})` : v.category],
    ['কী বাবদ', v.expense_name],
    ['টাকার পরিমাণ', `৳ ${bn(Number(v.amount).toLocaleString('en-IN'))}`],
    ['কথায়', takaInWords(Number(v.amount))],
    ['কার জন্য / স্টাফ আইডি', v.employee_name ? `${v.employee_name} (${v.employee_code ?? ''})` : 'হাবের খরচ'],
    ['রেফারেন্স', v.reference_no ?? '—'],
    ['বিবরণ', v.remarks ?? '—'],
  ]
  const c = document.createElement('canvas')
  const H = 220 + rows.length * 54 + 170
  c.width = W * scale; c.height = H * scale
  const g = c.getContext('2d')!
  g.scale(scale, scale)
  const font = (size: number, bold = false) => `${bold ? '700 ' : ''}${size}px "Hind Siliguri", "Noto Sans Bengali", system-ui, sans-serif`
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H)
  g.strokeStyle = '#1f2937'; g.lineWidth = 2; g.strokeRect(pad / 2, pad / 2, W - pad, H - pad)
  g.fillStyle = '#15803D'; g.font = font(30, true); g.fillText('XZM-TEAM', pad, pad + 40)
  g.fillStyle = '#111827'; g.font = font(26, true); g.textAlign = 'right'; g.fillText('খরচের ভাউচার', W - pad, pad + 40)
  g.font = font(17); g.fillStyle = '#4b5563'; g.fillText(`তৈরি করেছেন ${v.made_by ?? ''}`, W - pad, pad + 70); g.textAlign = 'left'
  g.fillText(`${v.hub}${v.hub_code ? ` (${v.hub_code})` : ''}`, pad, pad + 70)
  g.beginPath(); g.moveTo(pad, pad + 90); g.lineTo(W - pad, pad + 90); g.stroke()
  let y = pad + 130
  const wrap = (text: string, x: number, maxW: number) => {
    const words = text.split(' '); let line = ''; const lines: string[] = []
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w } else line = t }
    if (line) lines.push(line)
    return lines.slice(0, 2).map((l, i) => g.fillText(l, x, y + i * 24)).length
  }
  for (const [k, val] of rows) {
    g.fillStyle = '#f3f4f6'; g.fillRect(pad, y - 30, 260, 46)
    g.fillStyle = '#374151'; g.font = font(19, true); g.fillText(k, pad + 12, y)
    g.fillStyle = '#111827'; g.font = font(k === 'টাকার পরিমাণ' || k === 'ভাউচার নম্বর' ? 22 : 19, k === 'টাকার পরিমাণ' || k === 'ভাউচার নম্বর')
    wrap(val, pad + 280, W - pad * 2 - 290)
    g.strokeStyle = '#e5e7eb'; g.lineWidth = 1; g.beginPath(); g.moveTo(pad, y + 22); g.lineTo(W - pad, y + 22); g.stroke()
    y += 54
  }
  y += 70
  g.strokeStyle = '#6b7280'; g.setLineDash([4, 4]); g.font = font(16); g.fillStyle = '#374151'
  const signs = ['যিনি টাকা নিয়েছেন', 'যিনি টাকা দিয়েছেন', 'হাব ইনচার্জ', 'হিসাব বিভাগ']
  const sw = (W - pad * 2 - 30 * 3) / 4
  signs.forEach((s, i) => { const x = pad + i * (sw + 30); g.beginPath(); g.moveTo(x, y); g.lineTo(x + sw, y); g.stroke(); g.textAlign = 'center'; g.fillText(s, x + sw / 2, y + 24); g.textAlign = 'left' })
  g.setLineDash([])
  return c
}

export async function downloadVoucherPng(v: VoucherData, cat: Category | undefined) {
  const c = await voucherCanvas(v, cat)
  const a = document.createElement('a')
  a.href = c.toDataURL('image/png')
  a.download = `XZM-TEAM-voucher-${v.voucher_no ?? v.expense_no}.png`
  document.body.appendChild(a); a.click(); a.remove()
}
