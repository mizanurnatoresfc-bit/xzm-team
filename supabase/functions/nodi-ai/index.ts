// nodi-ai: the only place the Anthropic API key is used.
//
//   status   → { configured: boolean }   (whether the secret exists; never the value)
//   chat     → { messages: [{role, content}] } → { text, usage, actions }
//            নদী can run several commands in one message through tools (see TOOLS). Every tool runs AS THE CALLER:
//            the same database functions and permission checks as the app itself — nodi can do nothing a person could not.
//
// Secrets (Supabase → Edge Functions → Secrets):  ANTHROPIC_API_KEY
// Provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Deploy with verify_jwt = false: the caller's token is checked below.
// Who may call, the model, the daily limit and on/off are decided by the database (nodi_gate).
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
  if (b.action !== 'chat') return reply(400, { error: 'bad_request' })
  if (!key) return reply(503, { error: 'not_configured', message: 'API key বসানো হয়নি — অ্যাডমিন Supabase secret-এ ANTHROPIC_API_KEY দিন' })

  // the database decides: permission, on/off, daily limit, model
  const gate = await caller.rpc('nodi_gate')
  if (gate.error) return reply(gate.error.code === '42501' ? 403 : 429, { error: 'gate', message: gate.error.message })
  const g = gate.data as { model: string; max_tokens: number; user: string }

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
