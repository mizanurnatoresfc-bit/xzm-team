// admin-users: the only steps of account management that need the service key.
//
//   create          admin creates a staff login (email + temporary password + first role)
//   reset_password  admin sets a new password for an account they may manage (used as it is, no forced change)
//   change_password the signed-in user replaces their (temporary) password
//
// Every permission decision is made by the database while acting AS THE CALLER
// (user_admin_precheck, user_admin_assign_role, user_admin_can_manage ...), so this
// function cannot be used to grant more than the caller could grant themselves.
// The service key is used only for auth.admin.createUser / updateUserById and to clear
// the "must change password" flag after the user changed it.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (provided by Supabase).
// Deploy with verify_jwt = false: the caller's token is checked below with auth.getUser().
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

// https://localhost = the Android app (Capacitor), capacitor://localhost = a future iPhone app.
const DEFAULT_ORIGINS = ['https://xzm-team-erp.netlify.app', 'https://xzmteam.com', 'https://www.xzmteam.com', 'https://localhost', 'capacitor://localhost', 'http://localhost:5173', 'http://127.0.0.1:5173']
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean)
const allowed = ORIGINS.length ? ORIGINS : DEFAULT_ORIGINS

function cors(origin: string | null): Record<string, string> {
  const ok = origin && allowed.includes(origin)
  return {
    'Access-Control-Allow-Origin': ok ? origin! : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

/** At least 6 characters (owner, 22 Nov 2026: no letter/digit rule). */
function weak(pw: string): boolean {
  return pw.length < 6 || pw.length > 72
}
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const headers = { ...cors(origin), 'Content-Type': 'application/json' }
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return reply(405, { error: 'method' })
  if (origin && !allowed.includes(origin)) return reply(403, { error: 'origin' })

  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return reply(401, { error: 'not_signed_in' })

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // Acts as the caller: RLS and every database permission check apply.
  const caller: SupabaseClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } },
  })
  const { data: who, error: whoErr } = await caller.auth.getUser(auth.slice(7))
  if (whoErr || !who.user) return reply(401, { error: 'not_signed_in' })

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return reply(400, { error: 'bad_request' }) }
  const dbError = (e: { message: string; code?: string }) => reply(e.code === '42501' ? 403 : 400, { error: 'db', message: e.message, code: e.code })

  // ---------- the signed-in user changes their own password ----------
  if (b.action === 'change_password') {
    const pw = String(b.password ?? '')
    if (weak(pw)) return reply(400, { error: 'weak_password' })
    const { error } = await admin.auth.admin.updateUserById(who.user.id, { password: pw })
    if (error) return reply(400, { error: 'auth', message: error.message })
    await admin.from('profiles').update({ must_change_password: false }).eq('id', who.user.id)
    return reply(200, { ok: true })
  }

  // ---------- admin resets someone's password ----------
  if (b.action === 'reset_password') {
    const user = uuid(b.user_id), pw = String(b.password ?? '')
    if (!user) return reply(400, { error: 'bad_request' })
    if (weak(pw)) return reply(400, { error: 'weak_password' })
    const { data: may, error: e1 } = await caller.rpc('user_admin_can_manage', { p_user: user })
    if (e1) return dbError(e1)
    if (may !== true) return reply(403, { error: 'forbidden' })
    const { error } = await admin.auth.admin.updateUserById(user, { password: pw })
    if (error) return reply(400, { error: 'auth', message: error.message })
    const { error: e2 } = await caller.rpc('user_admin_note_reset', { p_user: user })
    if (e2) return dbError(e2)
    return reply(200, { ok: true })
  }

  // ---------- admin creates a staff login ----------
  if (b.action === 'create') {
    const email = String(b.email ?? '').trim().toLowerCase()
    const fullName = String(b.full_name ?? '').trim()
    const phone = String(b.phone ?? '').trim() || null
    const pw = String(b.password ?? '')
    const role = uuid(b.role_id), scope = String(b.scope_type ?? '')
    const zone = uuid(b.zone_id), hub = uuid(b.hub_id), employee = uuid(b.employee_id)
    if (!email || fullName.length < 2 || !role || email.length > 254 || fullName.length > 120) return reply(400, { error: 'bad_request' })
    if (weak(pw)) return reply(400, { error: 'weak_password' })

    const { error: pre } = await caller.rpc('user_admin_precheck', {
      p_email: email, p_role: role, p_scope: scope, p_zone: zone, p_hub: hub, p_employee: employee })
    if (pre) return dbError(pre)

    const { data: made, error: ce } = await admin.auth.admin.createUser({
      email, password: pw, email_confirm: true, user_metadata: { full_name: fullName } })
    if (ce || !made.user) return reply(400, { error: 'auth', message: ce?.message ?? 'create failed' })
    const id = made.user.id

    const { error: ae } = await caller.rpc('user_admin_assign_role', {
      p_user: id, p_role: role, p_scope: scope, p_zone: zone, p_hub: hub })
    if (ae) {
      // Should not happen after the precheck; never leave a usable account without a role.
      await admin.from('profiles').update({ status: 'inactive' }).eq('id', id)
      return dbError(ae)
    }
    const { error: fe } = await caller.rpc('user_admin_finish_create', { p_user: id, p_full_name: fullName, p_phone: phone })
    if (fe) {
      await admin.from('profiles').update({ must_change_password: true }).eq('id', id)
    }
    let warning: string | null = null
    if (employee) {
      const { error: le } = await caller.rpc('hr_link_login', { p_employee: employee, p_profile: id })
      if (le) warning = 'employee_link_failed: ' + le.message
    }
    return reply(200, { ok: true, user_id: id, warning })
  }

  return reply(400, { error: 'bad_request' })
})
