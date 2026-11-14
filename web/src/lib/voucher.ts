// The company's own expense voucher: for a cost where the shop or the payee gave no bill.
// Printed from the browser with the same print box the lists use.
import type { Category, VoucherData } from './dailyAccounts'

const ONES = ['', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়', 'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো',
  'ষোলো', 'সতেরো', 'আঠারো', 'ঊনিশ', 'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'ঊনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ', 'চল্লিশ',
  'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ', 'পঞ্চাশ',
  'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট', 'ষাট',
  'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর', 'সত্তর',
  'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি', 'আশি',
  'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'ঊননব্বই', 'নব্বই',
  'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই']

/** 40598 -> "চল্লিশ হাজার পাঁচশত আটানব্বই" — the Bangla lakh/crore grouping. */
export function takaInWords(n: number): string {
  const whole = Math.floor(Math.abs(n))
  const paisa = Math.round((Math.abs(n) - whole) * 100)
  const words = (v: number): string => {
    if (v === 0) return ''
    if (v < 100) return ONES[v]
    if (v < 1000) return `${ONES[Math.floor(v / 100)]}শত${v % 100 ? ' ' + words(v % 100) : ''}`
    if (v < 100000) return `${words(Math.floor(v / 1000))} হাজার${v % 1000 ? ' ' + words(v % 1000) : ''}`
    if (v < 10000000) return `${words(Math.floor(v / 100000))} লক্ষ${v % 100000 ? ' ' + words(v % 100000) : ''}`
    return `${words(Math.floor(v / 10000000))} কোটি${v % 10000000 ? ' ' + words(v % 10000000) : ''}`
  }
  const main = whole === 0 ? 'শূন্য' : words(whole)
  return paisa ? `${main} টাকা ${words(paisa)} পয়সা` : `${main} টাকা`
}

const bn = (s: string | number) => String(s).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)])
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!))
const taka = (n: number) => '৳ ' + bn(Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dmy = (d: string | null) => d ? bn(d.split('-').reverse().join('/')) : '—'

/** The voucher as printable HTML. Two copies on one page: office and the person who took the money. */
export function voucherHtml(v: VoucherData, cat: Category | undefined): string {
  const name = cat ? `${cat.bn} (${cat.en})` : v.category
  const site = !cat ? '' : cat.site_name
    ? `মেইন সাইটে: ${esc(cat.site_name)}${cat.site_sub ? ` → ${esc(cat.site_sub)}` : ''}${cat.site_limit ? ` · সর্বোচ্চ ৳${bn(cat.site_limit.toLocaleString('en-US'))}` : ''}`
    : esc(cat.site_note_bn ?? 'মেইন সাইটে যায় না।')
  const row = (a: string, b: string) => `<tr><th>${a}</th><td>${b}</td></tr>`
  const copy = (label: string) => `
  <div class="vch">
    <div class="vch-head">
      <div><b>XZM-TEAM</b><div class="s">${esc(v.hub)} · ${esc(v.zone)}</div></div>
      <div class="r"><b>খরচের ভাউচার</b><div class="s">${label}</div></div>
    </div>
    <table class="vch-t">
      ${row('ভাউচার নম্বর', `<b>${esc(v.voucher_no ?? '—')}</b>`)}
      ${row('তারিখ', `${dmy(v.bill_date)} · হিসাবের দিন ${dmy(v.account_date)}`)}
      ${row('খরচের খাত', `${esc(name)}<div class="s">${site}</div>`)}
      ${row('কী বাবদ', esc(v.expense_name))}
      ${row('টাকার পরিমাণ', `<b>${taka(v.amount)}</b><div class="s">কথায়: ${esc(takaInWords(v.amount))}</div>`)}
      ${row('কার জন্য', v.employee_name ? `${esc(v.employee_name)} (${esc(v.employee_code ?? '')})` : 'হাবের খরচ')}
      ${row('টাকা দিয়েছেন', esc(v.paid_by_name ?? '—'))}
      ${row('মন্তব্য', esc(v.remarks ?? '—'))}
    </table>
    <p class="s">দোকান বা পক্ষের কোনো বিল/ভাউচার পাওয়া যায়নি বলে প্রতিষ্ঠানের নিজের এই ভাউচার করা হলো।
      হিসাব খাতা নং ${bn(v.sheet_no)} · লাইন ${bn(v.expense_no)} · তৈরি করেছেন ${esc(v.made_by ?? '')}</p>
    <div class="vch-sign"><div>যিনি টাকা নিয়েছেন</div><div>যিনি টাকা দিয়েছেন</div><div>হাব ইনচার্জ</div><div>হিসাব বিভাগ</div></div>
  </div>`
  return `<style>
    #print-box .vch{border:1px solid #333;padding:14px;margin-bottom:16px;font-size:12px}
    #print-box .vch-head{display:flex;justify-content:space-between;border-bottom:1px solid #333;padding-bottom:6px;margin-bottom:8px}
    #print-box .vch-head .r{text-align:right}
    #print-box .vch .s{font-size:10px;color:#444}
    #print-box table.vch-t{width:100%;border-collapse:collapse;margin-bottom:8px}
    #print-box table.vch-t th{width:150px;text-align:left;background:#f1f1f1}
    #print-box .vch-sign{display:flex;gap:16px;margin-top:34px}
    #print-box .vch-sign div{flex:1;border-top:1px dotted #333;padding-top:4px;text-align:center;font-size:10px}
  </style>${copy('অফিস কপি')}${copy('গ্রাহক কপি')}`
}

/** Shows the voucher in the browser's print window (Save as PDF works there too). */
export function printVoucher(v: VoucherData, cat: Category | undefined) {
  const box = document.createElement('div')
  box.id = 'print-box'
  box.innerHTML = voucherHtml(v, cat)
  const host = document.querySelector('.app-main') ?? document.body
  host.appendChild(box)
  document.body.classList.add('print-list')
  const old = document.title
  document.title = `XZM-TEAM-ভাউচার-${v.voucher_no ?? v.expense_no}`
  const done = () => {
    box.remove(); document.body.classList.remove('print-list'); document.title = old
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  setTimeout(() => window.print(), 50)
}
