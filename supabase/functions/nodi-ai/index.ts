// nodi-ai: the only place the Anthropic API key is used.
//
//   status   → { configured: boolean }   (whether the secret exists; never the value)
//   chat     → { messages: [{role, content}] } → { text, usage }
//
// Secrets (Supabase → Edge Functions → Secrets):  ANTHROPIC_API_KEY
// Provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Deploy with verify_jwt = false: the caller's token is checked below.
// Who may call, the model, the daily limit and on/off are decided by the database (nodi_gate).
import { createClient } from 'npm:@supabase/supabase-js@2'

const DEFAULT_ORIGINS = ['https://xzm-team-erp.netlify.app', 'https://localhost', 'capacitor://localhost', 'http://localhost:5173', 'http://127.0.0.1:5173']
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean)
const allowed = ORIGINS.length ? ORIGINS : DEFAULT_ORIGINS

const SYSTEM = `তুমি "নদী AI", XZM-TEAM-এর জোনাল অ্যাসিস্ট্যান্ট। কুরিয়ার হাব, রাইডার, পার্সেল, ইস্যু ও কাজের ফলো-আপে সাহায্য করো।
সবসময় সহজ বাংলায়, সংক্ষেপে উত্তর দাও। না জানলে অনুমান না করে বলো জানো না। কারও গোপন তথ্য (NID, বেতন, পাসওয়ার্ড) চাইবে না ও দেবে না।`

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
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: g.model, max_tokens: g.max_tokens, system: SYSTEM, messages }) })
    const j = await r.json()
    if (!r.ok) { await log(false, 0, 0, `${r.status} ${j?.error?.type ?? ''}`); return reply(502, { error: 'upstream', message: 'নদী AI এখন উত্তর দিতে পারছে না' }) }
    const text = (j.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n')
    await log(true, j.usage?.input_tokens ?? 0, j.usage?.output_tokens ?? 0)
    return reply(200, { text, usage: j.usage })
  } catch (e) {
    await log(false, 0, 0, String(e).slice(0, 200)); return reply(502, { error: 'upstream', message: 'নদী AI-র সাথে যোগাযোগ হয়নি' })
  }
})
