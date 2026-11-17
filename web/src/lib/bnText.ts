// বাংলা মোডে পর্দার লেখা — one place that keeps the screen Bangla when the app is in Bangla:
//  * every date shown on screen, written as 2026-11-15 or 15/11/2026, becomes "১৫ নভেম্বর ২০২৬";
//  * a post or role name that arrives only in English (e.g. "Commission Rider") shows its Bangla name from the database.
// It changes only text on the screen — never form fields, data sent to the server, or downloaded Excel files.
// Switching the app to English puts the original text back.
import { supabase } from './supabase'

const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর']
const bnDigits = (s: string) => s.replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[+d])
// Not part of a word, a path or a file name (sorting-2026-11-15), and not a timestamp (2026-11-15T…).
const ISO = /(?<![\w/.-])((?:19|20)\d{2})-(\d{2})-(\d{2})(?![\w:])/g
const DMY = /(?<![\w/.-])(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})(?![\w/])/g
const SKIP = 'script,style,code,pre,textarea,[contenteditable="true"],.no-bn'

let names = new Map<string, string>()
const original = new WeakMap<Text, string>()
let started = false

function day(y: string, m: string, d: string, whole: string) {
  const mi = Number(m), di = Number(d)
  return mi >= 1 && mi <= 12 && di >= 1 && di <= 31 ? `${bnDigits(String(di))} ${MONTHS[mi - 1]} ${bnDigits(y)}` : whole
}

function convert(text: string): string {
  let s = text.replace(ISO, (w, y, m, d) => day(y, m, d, w)).replace(DMY, (w, d, m, y) => day(y, m, d, w))
  if (names.size && /[A-Za-z]/.test(s)) {
    const t = s.trim()
    if (names.has(t)) s = s.replace(t, names.get(t)!)
    else if (s.includes(' · ')) s = s.split(' · ').map(p => names.get(p.trim()) ? p.replace(p.trim(), names.get(p.trim())!) : p).join(' · ')
  }
  return s
}

const bn = () => document.documentElement.lang === 'bn'

function fix(n: Text) {
  const v = n.nodeValue
  if (!v || !/[0-9A-Za-z]/.test(v)) return
  const p = n.parentElement
  if (!p || p.closest(SKIP)) return
  const out = convert(v)
  if (out !== v) { original.set(n, v); n.nodeValue = out }
}

function walk(root: Node, f: (t: Text) => void) {
  if (root.nodeType === Node.TEXT_NODE) { f(root as Text); return }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) f(n as Text)
}

function restore(n: Text) {
  const o = original.get(n)
  if (o !== undefined && n.nodeValue === convert(o)) n.nodeValue = o
  original.delete(n)
}

async function loadNames() {
  try {
    const [p, r] = await Promise.all([
      supabase.from('positions').select('name, name_bn'),
      supabase.from('roles').select('name, name_bn'),
    ])
    const m = new Map<string, string>()
    for (const x of [...(p.data ?? []), ...(r.data ?? [])] as Array<{ name: string | null; name_bn: string | null }>) {
      if (x.name && x.name_bn && x.name.trim() !== x.name_bn.trim() && /[A-Za-z]/.test(x.name)) m.set(x.name.trim(), x.name_bn.trim())
    }
    names = m
    if (bn()) walk(document.body, fix)
  } catch { /* names stay as they are */ }
}

/** Start once, at app start. */
export function startBanglaText() {
  if (started || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  started = true
  new MutationObserver(list => {
    if (!bn()) return
    for (const m of list) {
      if (m.type === 'characterData') fix(m.target as Text)
      else m.addedNodes.forEach(n => walk(n, fix))
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true })
  new MutationObserver(() => walk(document.body, bn() ? fix : restore))
    .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  if (bn()) walk(document.body, fix)
  void loadNames()
  supabase.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION') void loadNames() })
}

/** For tests: the same conversion as on screen. */
export const toBanglaScreen = (s: string) => convert(s)
