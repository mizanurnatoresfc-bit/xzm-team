// auth-login: password sign-in with account lockout.
//
// Browser -> POST { email, password, portal } -> this function:
//   1. refuses at once if the account is locked or inactive (no password check),
//   2. asks Supabase Auth to check the password,
//   3. records the attempt with record_login_attempt() (5 failures -> 30 min lock),
//   4. returns the session tokens; the browser calls supabase.auth.setSession().
// The Custom Access Token hook (migration 20261113001200) blocks locked accounts even
// if someone calls the Auth API directly, so this function is not the only gate.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by
// Supabase automatically. Optional ALLOWED_ORIGINS (comma separated) overrides the list below.
import { createClient } from 'npm:@supabase/supabase-js@2'

// https://localhost = the Android app (Capacitor), capacitor://localhost = a future iPhone app.
const DEFAULT_ORIGINS = ['https://xzm-team-erp.netlify.app', 'https://localhost', 'capacitor://localhost', 'http://localhost:5173', 'http://127.0.0.1:5173']
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean)
const allowed = ORIGINS.length ? ORIGINS : DEFAULT_ORIGINS

// Best-effort per-IP limit (per function instance): 20 attempts per 10 minutes.
const hits = new Map<string, number[]>()
function tooMany(ip: string): boolean {
  const now = Date.now(), win = 10 * 60_000
  const list = (hits.get(ip) ?? []).filter(t => now - t < win)
  list.push(now); hits.set(ip, list)
  return list.length > 20
}

function cors(origin: string | null): Record<string, string> {
  const ok = origin && allowed.includes(origin)
  return {
    'Access-Control-Allow-Origin': ok ? origin! : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const headers = { ...cors(origin), 'Content-Type': 'application/json' }
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return reply(405, { error: 'method' })
  if (origin && !allowed.includes(origin)) return reply(403, { error: 'origin' })

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300)
  if (tooMany(ip)) return reply(429, { error: 'rate_limited' })

  let email = '', password = '', portal = 'staff'
  try {
    const b = await req.json()
    email = String(b.email ?? '').trim().toLowerCase()
    password = String(b.password ?? '')
    portal = b.portal === 'admin' ? 'admin' : 'staff'
  } catch { return reply(400, { error: 'bad_request' }) }
  if (!email || !password || email.length > 254 || password.length > 200) return reply(400, { error: 'bad_request' })

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const pub = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: st } = await admin.rpc('login_lock_state', { p_email: email })
  const state = Array.isArray(st) ? st[0] : st
  if (state?.locked) return reply(423, { error: 'locked', locked_until: state.locked_until })
  if (state && state.active === false) {
    await admin.rpc('record_login_attempt', { p_email: email, p_success: false, p_portal: portal, p_failure_reason: 'inactive account', p_ip: ip, p_user_agent: ua })
    return reply(401, { error: 'invalid' })
  }

  const { data, error } = await pub.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    const { data: r } = await admin.rpc('record_login_attempt', {
      p_email: email, p_success: false, p_portal: portal,
      p_failure_reason: (error?.message ?? 'no session').slice(0, 200), p_ip: ip, p_user_agent: ua,
    })
    const res = Array.isArray(r) ? r[0] : r
    if (res?.locked) return reply(423, { error: 'locked', locked_until: res.locked_until })
    return reply(401, { error: 'invalid' })
  }

  await admin.rpc('record_login_attempt', { p_email: email, p_success: true, p_portal: portal, p_ip: ip, p_user_agent: ua })
  return reply(200, {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
  })
})
