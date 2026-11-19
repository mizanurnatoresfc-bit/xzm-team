// nodi-ai: the only place the Anthropic API key is used.
//
//   status   → { configured: boolean }   (whether the secret exists; never the value)
//   chat     → { messages: [{role, content}] } → { text, usage, actions }
//            নদী can run several commands in one message through tools (see TOOLS). Every tool runs AS THE CALLER:
//            the same database functions and permission checks as the app itself — nodi can do nothing a person could not.
//   teach    → { messages, module?, guide } → { text }
//            "নদী AI হিসাব শিক্ষক": answers accounts questions in Bangla from two sources only — the official SteadFast
//            rules head office wrote (setting da.learn_official, read here from the database) and the app's own internal
//            instructions (the lesson text the page sends, plus the accounts settings read here). No tools: it teaches, it does not act.
//   office   → { task: 'contract' | 'power' | 'insight', data } → { text }
//            One answer, no tools: a rental agreement draft, ways to lower the electricity bill, or what to fix first
//            in an office. The page sends only what the person already sees; passwords are never sent here.
//
// Secrets (Supabase → Edge Functions → Secrets):  ANTHROPIC_API_KEY
// Provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Deploy with verify_jwt = false: the caller's token is checked below.
// Who may call, the model, the daily limit and on/off (the main switch and each part's switch) are decided by the database (nodi_gate).
import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_ORIGINS = ['https://xzm-team-erp.netlify.app', 'https://xzmteam.com', 'https://www.xzmteam.com', 'https://localhost', 'capacitor://localhost', 'http://localhost:5173', 'http://127.0.0.1:5173']
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean)
const allowed = ORIGINS.length ? ORIGINS : DEFAULT_ORIGINS

const SYSTEM = `তুমি "নদী AI", XZM-TEAM-এর জোনাল অ্যাসিস্ট্যান্ট। কুরিয়ার হাব, রাইডার, পার্সেল, ইস্যু ও কাজের ফলো-আপে সাহায্য করো।
সবসময় সহজ বাংলায়, ছোট বাক্যে উত্তর দাও (উত্তর জোরে পড়ে শোনানো হতে পারে — তাই তালিকা বা চিহ্ন কম রাখো)।
একই বার্তায় একাধিক কমান্ড থাকলে প্রতিটার জন্য আলাদা টুল চালাও, তারপর কী কী হলো আর কোনটা হলো না তা সত্যি সত্যি জানাও। টুলের ফলাফলে ভুল এলে সেটাই বলো — বানিয়ে বলবে না।
কোনো তথ্য (হাব, আইডি, ইস্যু নম্বর) অস্পষ্ট হলে অনুমান না করে জিজ্ঞাসা করো। কারও গোপন তথ্য (NID, বেতন, পাসওয়ার্ড) চাইবে না ও দেবে না।
আজকের তারিখ: ${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })}।`

const TOOLS = [
  { name: 'list_hubs', description: 'যে হাবগুলোর গ্রুপে এই ব্যবহারকারী আছেন তার তালিকা', input_schema: { type: 'object', properties: {} } },
  { name: 'my_issues', description: 'এই ব্যবহারকারীর ইস্যু: আমার কাজ, চেক বাকি, আমি দিয়েছি', input_schema: { type: 'object', properties: {} } },
  { name: 'create_issue', description: 'নতুন ইস্যু/কাজ তৈরি। parcel_ref দিলে ওই পার্সেলের রাইডার নিজে থেকে বসে। assignee_code = কর্মীর Employee ID।',
    input_schema: { type: 'object', properties: { hub: { type: 'string', description: 'হাবের নাম বা কোড' }, title: { type: 'string' }, parcel_ref: { type: 'string' },
      assignee_code: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] } }, required: ['hub'] } },
  { name: 'issue_action', description: 'ইস্যুতে কাজ: start (শুরু), solve (সমাধান; note লাগবে), approve (অনুমোদন), reopen (ফেরত; note লাগবে), cancel (বাতিল; note লাগবে)',
    input_schema: { type: 'object', properties: { issue_no: { type: 'string', description: 'যেমন IS-00012' }, action: { type: 'string', enum: ['start', 'solve', 'approve', 'reopen', 'cancel'] }, note: { type: 'string' } }, required: ['issue_no', 'action'] } },
  { name: 'post_to_hub', description: 'হাবের গ্রুপে বার্তা লেখা', input_schema: { type: 'object', properties: { hub: { type: 'string' }, text: { type: 'string' } }, required: ['hub', 'text'] } },
]

const OFFICE: Record<string, { system: string; ask: string; tokens: number }> = {
  contract: { tokens: 3000, ask: 'এই তথ্য দিয়ে চুক্তিপত্রটি লেখো:',
    system: `তুমি বাংলাদেশের বাড়ি/অফিস ভাড়ার চুক্তিপত্র লেখায় দক্ষ সহকারী। দেওয়া তথ্য দিয়ে সহজ, পরিষ্কার বাংলায় একটি পূর্ণ ভাড়ার চুক্তিপত্রের খসড়া লেখো:
পক্ষদ্বয়, জায়গার বিবরণ (কয়টা রুম অফিস, কয়টা আবাসিক), মেয়াদ, মাসিক ভাড়া ও পরিশোধের তারিখ, অগ্রিম ও ফেরতের নিয়ম, বিদ্যুৎ/ইন্টারনেট বিল, মেরামত, চুক্তি বাতিলের নোটিশ, নবায়ন, স্বাক্ষর ও সাক্ষীর জায়গা।
যে তথ্য দেওয়া নেই সেখানে ".............." রাখো — কোনো নাম, টাকা বা তারিখ বানাবে না। শুধু চুক্তিপত্রটাই দাও, আগে-পরে কোনো ভূমিকা বা মন্তব্য নয়, কোনো মার্কডাউন চিহ্ন নয়।` },
  power: { tokens: 1200, ask: 'এই অফিসের ডিভাইস ও বিলের তথ্য:',
    system: `তুমি একটি কুরিয়ার অফিসের বিদ্যুৎ খরচ কমানোর পরামর্শদাতা। দেওয়া ডিভাইসের তালিকা (ওয়াট, ঘণ্টা, সংখ্যা), হিসাব করা ইউনিট ও আসল বিল দেখে সহজ বাংলায় বলো:
১) মাসে আনুমানিক কত বিল আসা উচিত এবং আসল বিলের সাথে মিল আছে কি; ২) কোন ৩–৫টা কাজ করলে সবচেয়ে বেশি কমবে, প্রতিটার পাশে আনুমানিক মাসিক সাশ্রয় টাকায়; ৩) কোনো তথ্য অস্বাভাবিক লাগলে সেটা।
শুধু দেওয়া তথ্য থেকে বলো, সংখ্যা বানাবে না। ছোট বাক্য, সর্বোচ্চ ১০ লাইন, কোনো মার্কডাউন চিহ্ন নয়।` },
  insight: { tokens: 1200, ask: 'অফিসগুলোর বর্তমান তথ্য:',
    system: `তুমি একটি কুরিয়ার কোম্পানির জোনাল ম্যানেজারের অপারেশন সহকারী। দেওয়া অফিস/হাবের তথ্য (ভাড়া, চুক্তির মেয়াদ, বিল, জিনিসপত্র, নষ্ট জিনিস, ধার দেওয়া জিনিস, খোলা রিপোর্ট, দায়িত্বহীন ডেস্ক) দেখে সহজ বাংলায় বলো আগে কোন কাজগুলো করা দরকার, গুরুত্ব অনুযায়ী সাজিয়ে — প্রতিটা এক লাইনে, কোন হাব/অফিস তার নামসহ।
শুধু দেওয়া তথ্য থেকে বলো, কিছু বানাবে না। সর্বোচ্চ ১০ লাইন, কোনো মার্কডাউন চিহ্ন নয়।` },
}

const TEACH = (official: string, internal: string, settings: string, module: string) => `তুমি "নদী AI হিসাব শিক্ষক" — XZM-TEAM-এর হাব ম্যানেজারদের SteadFast কুরিয়ারের হিসাবের কাজ শেখাও।
সবসময় সহজ, ভদ্র বাংলায় উত্তর দাও। নতুন ম্যানেজার বুঝবেন এমনভাবে, ধাপে ধাপে (১, ২, ৩…), ছোট বাক্যে। স্ক্রিনে ঘরের নাম যেভাবে লেখা আছে সেভাবেই বলো।

তোমার উত্তরের উৎস শুধু এই তিনটি — এর বাইরে কিছু নয়:
[ক] SteadFast অফিশিয়াল নিয়ম — হেড অফিস নিজে লিখে দিয়েছে:
${official || '(হেড অফিস এখনো কোনো অফিশিয়াল নিয়ম লিখে দেয়নি)'}
[খ] নদী AI-র অভ্যন্তরীণ নির্দেশনা — এই সিস্টেম কীভাবে কাজ করে:
${internal || '(এই অংশের নির্দেশনা পাঠানো হয়নি)'}
[গ] এই সিস্টেমের বর্তমান হিসাব সেটিংস (খরচের খাত, সীমা, রসিদ লাগবে কিনা, ব্যাংক চার্জ):
${settings || '(নেই)'}
${module ? `ম্যানেজার এখন এই অংশ শিখছেন: ${module}` : ''}

কঠোর নিয়ম:
- কোনো নিয়ম বললে আগে উৎস লেখো: "SteadFast অফিশিয়াল (হেড অফিস):" অথবা "নদী AI অভ্যন্তরীণ নির্দেশনা:"। [খ] ও [গ]-কে কখনো SteadFast-এর অফিশিয়াল নিয়ম বলবে না।
- উৎসে নেই এমন কোনো নিয়ম, সীমা, টাকার অঙ্ক, চার্জ, সময়সীমা, ওয়েবসাইটের মেনুর নাম বা ফর্ম বানাবে না। না জানলে স্পষ্ট বলো: "এটা আমার কাছে লেখা নেই — হেড অফিস বা অ্যাকাউন্টস টিমের কাছ থেকে নিশ্চিত হোন।"
- ম্যানেজার কোনো এন্ট্রির তথ্য লিখলে মিলিয়ে দেখো কোন ঘর বাকি বা ভুল (যেমন টাকা, খাত, স্টাফ আইডি, রেফারেন্স, ভাউচার/বিল) — শুধু উৎসের নিয়ম ধরে।
- OCR-এ পড়া টাকা কখনো ব্যাংকে জমার নিশ্চয়তা নয় — মানুষকে নিজে মিলিয়ে "ব্যাংকে নিশ্চিত করুন" দিতে হয়, এটা মনে করিয়ে দাও যখন প্রাসঙ্গিক।
- তুমি কোনো কাজ নিজে করো না (কিছু সেভ, জমা বা অনুমোদন করো না) — শুধু শেখাও, কোথায় চাপতে হবে বলো।
- কারও গোপন তথ্য (NID, বেতন, পাসওয়ার্ড, ব্যাংক অ্যাকাউন্ট নম্বর) চাইবে না।
- উত্তর সর্বোচ্চ ১৫ লাইন; মার্কডাউন চিহ্ন (#, **, টেবিল) নয়।
আজকের তারিখ: ${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })}।`

type Db = ReturnType<typeof createClient>
type Hub = { hub_id: string; hub_name: string; hub_code: string }
type Row = { id: string; issue_no: string; title: string; status: string; hub: string | null; assignee: string | null }
const norm = (x: string) => x.toLowerCase().replace(/\s+/g, '')
async function findHub(db: Db, q: string): Promise<{ hub?: Hub; error?: string }> {
  const { data, error } = await db.rpc('hub_group_hubs')
  if (error) return { error: error.message }
  const hubs = (data ?? []) as Hub[]; const n = norm(q)
  const hit = hubs.filter(h => norm(h.hub_name).includes(n) || norm(String(h.hub_code)) === n || n.includes(norm(String(h.hub_code))) && n.length <= 8)
  if (hit.length === 1) return { hub: hit[0] }
  if (!hit.length) return { error: `"${q}" নামে কোনো হাব পাওয়া যায়নি। হাব: ${hubs.map(h => h.hub_name).join(', ')}` }
  return { error: `একাধিক হাব মিলেছে: ${hit.map(h => h.hub_name).join(', ')} — কোনটা?` }
}
async function runTool(db: Db, name: string, a: Record<string, unknown>): Promise<unknown> {
  const str = (k: string) => String(a[k] ?? '').trim()
  if (name === 'list_hubs') { const r = await db.rpc('hub_group_hubs'); return r.error ? { error: r.error.message } : r.data }
  if (name === 'my_issues') {
    const r = await db.rpc('issue_panels'); if (r.error) return { error: r.error.message }
    const p = r.data as Record<string, Row[]>; const cut = (l: Row[]) => (l ?? []).slice(0, 15).map(x => `${x.issue_no} ${x.title} [${x.status}] ${x.hub ?? ''} → ${x.assignee ?? 'কেউ না'}`)
    return { amar_kaj: cut(p.mine), check_baki: cut(p.to_check), ami_diyechi: cut(p.given) }
  }
  if (name === 'create_issue') {
    const h = await findHub(db, str('hub')); if (!h.hub) return { error: h.error }
    let assignee: string | null = null
    if (str('assignee_code')) {
      const e = await db.rpc('hr_lookup_employee', { p_code: str('assignee_code') })
      const row = (e.data as Array<{ id: string; full_name: string }> | null)?.[0]
      if (!row) return { error: `Employee ID ${str('assignee_code')} পাওয়া যায়নি` }
      assignee = row.id
    }
    if (!str('title') && !str('parcel_ref')) return { error: 'কী সমস্যা বা পার্সেল আইডি লাগবে' }
    const r = await db.rpc('issue_create', { p_hub: h.hub.hub_id, p_title: str('title') || null, p_body: null, p_kind: str('parcel_ref') ? 'parcel' : 'other',
      p_parcel_ref: str('parcel_ref') || null, p_photo: null, p_assignee: assignee, p_due: null, p_priority: str('priority') || 'normal' })
    return r.error ? { error: r.error.message } : { ok: true, hub: h.hub.hub_name, issue_id: r.data }
  }
  if (name === 'issue_action') {
    const r = await db.rpc('issue_panels'); if (r.error) return { error: r.error.message }
    const all = Object.values(r.data as Record<string, Row[]>).flat()
    const no = str('issue_no').toUpperCase().replace(/\s/g, '')
    const hit = all.find(x => x.issue_no === no || x.issue_no === 'IS-' + no.replace(/^IS-?/, '').padStart(5, '0'))
    if (!hit) return { error: `${no} নামে আপনার প্যানেলে কোনো ইস্যু নেই` }
    const x = await db.rpc('issue_act', { p_id: hit.id, p_action: str('action'), p_note: str('note') || null, p_photo: null })
    return x.error ? { error: x.error.message } : { ok: true, issue: hit.issue_no, action: str('action') }
  }
  if (name === 'post_to_hub') {
    const h = await findHub(db, str('hub')); if (!h.hub) return { error: h.error }
    const r = await db.rpc('hub_post_create', { p_hub: h.hub.hub_id, p_body: str('text'), p_photo: null })
    return r.error ? { error: r.error.message } : { ok: true, hub: h.hub.hub_name }
  }
  return { error: 'অজানা টুল' }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const ok = origin && allowed.includes(origin)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': ok ? origin! : allowed[0], 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Vary': 'Origin', 'Content-Type': 'application/json' }
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return reply(405, { error: 'method' })
  if (origin && !allowed.includes(origin)) return reply(403, { error: 'origin' })
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return reply(401, { error: 'not_signed_in' })

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: auth } } })
  const { data: who, error: whoErr } = await caller.auth.getUser(auth.slice(7))
  if (whoErr || !who.user) return reply(401, { error: 'not_signed_in' })

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return reply(400, { error: 'bad_request' }) }
  const key = Deno.env.get('ANTHROPIC_API_KEY')

  if (b.action === 'status') return reply(200, { configured: Boolean(key) })
  if (b.action !== 'chat' && b.action !== 'office' && b.action !== 'teach') return reply(400, { error: 'bad_request' })
  if (!key) return reply(503, { error: 'not_configured', message: 'API key বসানো হয়নি — অ্যাডমিন Supabase secret-এ ANTHROPIC_API_KEY দিন' })

  // the database decides: permission, on/off, daily limit, model
  // each part (chat / teach / office) has its own on/off switch on the settings page
  const gate = await caller.rpc('nodi_gate', { p_feature: b.action === 'chat' ? 'chat' : b.action })
  if (gate.error) return reply(gate.error.code === '42501' ? 403 : 429, { error: 'gate', message: gate.error.message })
  const g = gate.data as { model: string; max_tokens: number; user: string }

  if (b.action === 'office') {
    const job = OFFICE[String(b.task ?? '')]
    if (!job) return reply(400, { error: 'bad_request', message: 'অজানা কাজ' })
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const log = (ok: boolean, i: number, o: number, note?: string) => admin.rpc('nodi_log', { p_profile: g.user, p_model: g.model, p_in: i, p_out: o, p_ok: ok, p_note: note ?? null })
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        // a contract is longer than a chat answer, so each job has its own length
        body: JSON.stringify({ model: g.model, max_tokens: job.tokens, system: job.system,
          messages: [{ role: 'user', content: `${job.ask}\n${JSON.stringify(b.data ?? {}).slice(0, 14000)}` }] }) })
      const j = await r.json()
      if (!r.ok) { await log(false, 0, 0, `office ${r.status} ${j?.error?.type ?? ''}`); return reply(502, { error: 'upstream', message: 'নদী AI এখন উত্তর দিতে পারছে না' }) }
      const text = ((j.content ?? []) as Array<{ type: string; text?: string }>).filter(c => c.type === 'text').map(c => c.text).join('\n')
      await log(true, j.usage?.input_tokens ?? 0, j.usage?.output_tokens ?? 0, `office:${b.task}`)
      return reply(200, { text })
    } catch (e) {
      await log(false, 0, 0, String(e).slice(0, 200)); return reply(502, { error: 'upstream', message: 'নদী AI-র সাথে যোগাযোগ হয়নি' })
    }
  }

  if (b.action === 'teach') {
    const raw = Array.isArray(b.messages) ? b.messages : []
    const messages = raw.slice(-10).map((m: { role?: unknown; content?: unknown }) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '').slice(0, 3000) }))
      .filter(m => m.content.trim())
    if (!messages.length || messages[messages.length - 1].role !== 'user') return reply(400, { error: 'bad_request', message: 'প্রশ্ন লিখুন' })
    // official rules and settings come from the database as the caller sees them, never from the page
    const st = await caller.rpc('da_settings')
    const all = (st.data ?? {}) as Record<string, unknown>
    const mod = String(b.module ?? '').slice(0, 40)
    const off = (all['da.learn_official'] ?? {}) as Record<string, string>
    const official = Object.entries(off).filter(([k, v]) => typeof v === 'string' && v.trim() && (!mod || k === mod || k === 'general'))
      .map(([k, v]) => `(${k}) ${v}`).join('\n').slice(0, 6000)
    const cats = ((all['da.expense_categories'] ?? []) as Array<Record<string, unknown>>).map(c =>
      [c.bn, c.en && `(${c.en})`, c.note_bn, c.site_limit && `সর্বোচ্চ ৳${c.site_limit}`, c.site_receipt === true ? 'রসিদ লাগবে' : c.site_receipt === false ? 'রসিদ ছাড়া চলে' : '',
       c.site_name ? `মেইন সাইটে: ${c.site_name}${c.site_sub ? ' → ' + c.site_sub : ''}` : c.site_note_bn ?? ''].filter(Boolean).join(' · '))
    const settings = [`খরচের খাত:\n${cats.join('\n')}`, `ব্যাংক চার্জ: ${JSON.stringify(all['da.bank_charge'] ?? null)}`,
      `বিল/স্লিপ আপলোড: ${JSON.stringify(all['da.bill_upload'] ?? null)}`].join('\n').slice(0, 7000)
    const system = TEACH(official, String(b.guide ?? '').slice(0, 12000), settings, String(b.title ?? mod).slice(0, 80))
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const log = (ok: boolean, i: number, o: number, note?: string) => admin.rpc('nodi_log', { p_profile: g.user, p_model: g.model, p_in: i, p_out: o, p_ok: ok, p_note: note ?? null })
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: g.model, max_tokens: Math.min(Math.max(g.max_tokens, 800), 2000), system, messages }) })
      const j = await r.json()
      if (!r.ok) { await log(false, 0, 0, `teach ${r.status} ${j?.error?.type ?? ''}`); return reply(502, { error: 'upstream', message: 'নদী AI এখন উত্তর দিতে পারছে না' }) }
      const text = ((j.content ?? []) as Array<{ type: string; text?: string }>).filter(c => c.type === 'text').map(c => c.text).join('\n')
      await log(true, j.usage?.input_tokens ?? 0, j.usage?.output_tokens ?? 0, `teach:${mod || 'general'}`)
      return reply(200, { text })
    } catch (e) {
      await log(false, 0, 0, String(e).slice(0, 200)); return reply(502, { error: 'upstream', message: 'নদী AI-র সাথে যোগাযোগ হয়নি' })
    }
  }

  const raw = Array.isArray(b.messages) ? b.messages : []
  const messages = raw.slice(-12).map((m: { role?: unknown; content?: unknown }) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '').slice(0, 4000) }))
    .filter(m => m.content.trim())
  if (!messages.length || messages[messages.length - 1].role !== 'user') return reply(400, { error: 'bad_request', message: 'প্রশ্ন লিখুন' })

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const log = (ok: boolean, i: number, o: number, note?: string) => admin.rpc('nodi_log', { p_profile: g.user, p_model: g.model, p_in: i, p_out: o, p_ok: ok, p_note: note ?? null })
  try {
    const convo: Array<{ role: string; content: unknown }> = [...messages]
    const actions: Array<{ tool: string; input: unknown; result: unknown }> = []
    let tin = 0, tout = 0, text = ''
    for (let step = 0; step < 6; step++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: g.model, max_tokens: g.max_tokens, system: SYSTEM, tools: TOOLS, messages: convo }) })
      const j = await r.json()
      if (!r.ok) { await log(false, tin, tout, `${r.status} ${j?.error?.type ?? ''}`); return reply(502, { error: 'upstream', message: 'নদী AI এখন উত্তর দিতে পারছে না' }) }
      tin += j.usage?.input_tokens ?? 0; tout += j.usage?.output_tokens ?? 0
      const blocks = (j.content ?? []) as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
      text = blocks.filter(c => c.type === 'text').map(c => c.text).join('\n')
      const uses = blocks.filter(c => c.type === 'tool_use')
      if (j.stop_reason !== 'tool_use' || !uses.length) break
      convo.push({ role: 'assistant', content: blocks })
      const results = []
      for (const u of uses) {
        const out = await runTool(caller, u.name!, u.input ?? {})
        actions.push({ tool: u.name!, input: u.input, result: out })
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 6000) })
      }
      convo.push({ role: 'user', content: results })
    }
    await log(true, tin, tout)
    return reply(200, { text, usage: { input_tokens: tin, output_tokens: tout }, actions })
  } catch (e) {
    await log(false, 0, 0, String(e).slice(0, 200)); return reply(502, { error: 'upstream', message: 'নদী AI-র সাথে যোগাযোগ হয়নি' })
  }
})
