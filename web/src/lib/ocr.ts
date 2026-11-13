// OCR for payment screenshots and bills. Runs in the browser with Tesseract.js, loaded on first use.
// The result is only a proposal: the form shows it, a person checks it and ticks "I have checked",
// and the database refuses to submit a sheet while any OCR value is unchecked.
import type { OcrResult, Template, Category } from './dailyAccounts'

type Tess = { recognize: (img: File | Blob, lang: string, opts?: { logger?: (m: { status: string; progress: number }) => void })
  => Promise<{ data: { text: string; confidence: number } }> }

let loading: Promise<Tess> | null = null
const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'

export function loadTesseract(): Promise<Tess> {
  const w = window as unknown as { Tesseract?: Tess }
  if (w.Tesseract) return Promise.resolve(w.Tesseract)
  if (loading) return loading
  loading = new Promise<Tess>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = CDN
    const timer = window.setTimeout(() => reject(new Error('OCR টুল লোড হতে বেশি সময় লাগছে।')), 30000)
    s.onload = () => { window.clearTimeout(timer); w.Tesseract ? resolve(w.Tesseract) : reject(new Error('OCR টুল লোড হয়নি।')) }
    s.onerror = () => { window.clearTimeout(timer); reject(new Error('OCR টুল লোড করা যায়নি (ইন্টারনেট সংযোগ দেখুন)।')) }
    document.head.appendChild(s)
  }).catch(e => { loading = null; throw e })
  return loading
}

export async function readImage(file: File, languages = 'eng+ben', onProgress?: (p: number) => void) {
  if (!file.type.startsWith('image/')) throw new Error('OCR শুধু ছবিতে চলে (JPG/PNG)। PDF হলে তথ্য নিজে লিখুন।')
  const T = await loadTesseract()
  const { data } = await T.recognize(file, languages, { logger: m => { if (m.status === 'recognizing text') onProgress?.(m.progress) } })
  return { text: data.text, confidence: Math.round(data.confidence) }
}

const toLatin = (s: string) => s.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
const money = (s: string) => Number(s.replace(/,/g, ''))

function findAmount(t: string): number | null {
  const labeled = t.match(/(?:amount|total|tk\.?|taka|৳|bdt|টাকা|মোট|পরিমাণ)\s*[:=]?\s*(?:tk\.?|৳|bdt)?\s*([\d,]+(?:\.\d{1,2})?)/i)
  if (labeled) return money(labeled[1])
  const all = [...t.matchAll(/(?:৳|tk\.?|bdt)\s*([\d,]+(?:\.\d{1,2})?)/gi)].map(m => money(m[1]))
  return all.length ? Math.max(...all) : null
}
function findDate(t: string): string | null {
  let m = t.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const mon = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ')
  m = t.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})/)
  if (m && mon.includes(m[2].toLowerCase())) return `${m[3]}-${String(mon.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

// bKash / Nagad / Rocket / bank screenshots
export function parsePayment(raw: string, confidence: number): OcrResult {
  const t = toLatin(raw)
  const txn = t.match(/(?:trx\s*id|txn\s*id|transaction\s*id|ট্রানজেকশন\s*আইডি)\s*[:#]?\s*([A-Z0-9]{6,20})/i)
  const pay = t.match(/\b(MP-\d{3,})\b/i) || t.match(/(?:payment\s*id|পেমেন্ট\s*আইডি)\s*[:#]?\s*([A-Z0-9-]{4,20})/i)
  return { transaction_id: txn ? txn[1].toUpperCase() : null, payment_ref: pay ? pay[1].toUpperCase() : null,
           amount: findAmount(t), payment_date: findDate(t), confidence, text: raw.slice(0, 2000) }
}

// Bills and memos. Expense name and category come from the templates' keywords where possible.
export function parseBill(raw: string, confidence: number, templates: Template[], categories: Category[]): OcrResult {
  const t = toLatin(raw)
  const low = t.toLowerCase()
  const bill = t.match(/(?:bill|memo|invoice|cash\s*memo|বিল|মেমো|ইনভয়েস)\s*(?:no\.?|number|নং|নম্বর)?\s*[:#]?\s*([A-Z0-9/-]{2,20})/i)
  const ref = t.match(/(?:ref(?:erence)?|রেফ(?:ারেন্স)?)\s*(?:no\.?|নং)?\s*[:#]?\s*([A-Z0-9/-]{2,20})/i)
  const tpl = templates.find(x => x.status === 'active' && x.keywords.some(k => k && low.includes(k.toLowerCase())))
  const cat = tpl?.category ?? categories.find(c => low.includes(c.en.toLowerCase()) || (c.bn && raw.includes(c.bn)))?.code ?? null
  const firstLine = raw.split('\n').map(s => s.trim()).find(s => s.length > 3 && /[A-Za-zঀ-৿]/.test(s)) ?? null
  return { expense_name: tpl?.name ?? firstLine, template_id: tpl?.id ?? null, category: cat, bill_no: bill ? bill[1] : null,
           reference_no: ref ? ref[1] : null, amount: findAmount(t), bill_date: findDate(t), confidence, text: raw.slice(0, 2000) }
}
