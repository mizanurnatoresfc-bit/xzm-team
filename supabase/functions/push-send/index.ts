// push-send: sends new notifications to the person's phones through Firebase Cloud Messaging (HTTP v1).
//
// Called by the database when a notification is written (and every two minutes by pg_cron). The call carries
// no secret and needs none: this function reads the unsent rows itself with the service key (push_claim takes
// each row once), so calling it again only sends what is really waiting.
//
// Secret (Supabase → Edge Functions → Secrets): FCM_SERVICE_ACCOUNT = the Firebase service-account JSON.
// Without it nothing is claimed or sent; the rows wait. Deploy with verify_jwt = false.
import { createClient } from 'npm:@supabase/supabase-js@2'

type Account = { project_id: string; client_email: string; private_key: string; token_uri?: string }
type Row = { id: string; profile_id: string; title: string; body: string | null; link: string | null; kind: string | null; tokens: string[] }

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer)
  let s = ''; for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
// Read the secret however it was pasted: the plain JSON, JSON wrapped in quotes or escaped once more, base64,
// or JSON whose "\n" inside the key became real line breaks. Falls back to picking the three fields out.
function readAccount(raw: string): Account | null {
  const tries: string[] = []
  const t = raw.trim().replace(/^\uFEFF/, '')
  tries.push(t)
  if (/^['"`]/.test(t) && t.endsWith(t[0])) tries.push(t.slice(1, -1))
  if (!t.startsWith('{')) { try { tries.push(atob(t.replace(/\s+/g, ''))) } catch { /* not base64 */ } }
  for (const x of [...tries]) {
    try { const v = JSON.parse(x); if (typeof v === 'string') tries.push(v); else if (v?.private_key && v?.client_email) return v as Account } catch { /* next */ }
  }
  for (const x of tries) {
    const pick = (k: string) => x.match(new RegExp(`\\\\?"${k}\\\\?"\\s*:\\s*\\\\?"([\\s\\S]*?)\\\\?"\\s*[,}]`))?.[1]
    const project_id = pick('project_id'), client_email = pick('client_email'), private_key = pick('private_key'), token_uri = pick('token_uri')
    if (project_id && client_email && private_key?.includes('PRIVATE KEY')) return { project_id, client_email, private_key, token_uri: token_uri?.replace(/\\\//g, '/') }
  }
  return null
}
let cached: { token: string; until: number } | null = null
async function accessToken(a: Account): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: a.token_uri ?? 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const pem = a.private_key.replace(/-----[^-]+-----/g, '').replace(/\\+n/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`))
  const r = await fetch(a.token_uri ?? 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }) })
  const j = await r.json()
  if (!r.ok || !j.access_token) throw new Error(`google token ${r.status}`)
  cached = { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 }
  return cached.token
}

Deno.serve(async (req) => {
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })
  if (req.method !== 'POST') return json(405, { error: 'method' })
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT')
  if (!raw) return json(200, { configured: false, sent: 0 })
  const acc = readAccount(raw)
  if (!acc) return json(500, { error: 'FCM_SERVICE_ACCOUNT could not be read', length: raw.length, starts_with_brace: raw.trim().startsWith('{') })
  // {"check": true}: only test that Google accepts the key; nothing is claimed or sent.
  const ask = await req.json().catch(() => ({})) as { check?: boolean }
  if (ask?.check) {
    try { await accessToken(acc); return json(200, { configured: true, google: 'ok', project: acc.project_id }) }
    catch (e) { return json(200, { configured: true, google: e instanceof Error ? e.message : 'failed', project: acc.project_id }) }
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data, error } = await db.rpc('push_claim', { p_limit: 100 })
  if (error) return json(500, { error: error.message })
  const rows = (data ?? []) as Row[]
  if (!rows.some(r => r.tokens?.length)) return json(200, { configured: true, sent: 0, claimed: rows.length })

  const token = await accessToken(acc)
  const url = `https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`
  let sent = 0; const dead: string[] = []; const failed: string[] = []
  await Promise.all(rows.flatMap(r => (r.tokens ?? []).map(async t => {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: {
        token: t,
        notification: { title: r.title.slice(0, 200), body: (r.body ?? '').slice(0, 500) },
        data: { id: r.id, link: r.link ?? '/app/notifications', kind: r.kind ?? '' },
        android: { priority: 'high', notification: { channel_id: 'xzm', sound: 'default', tag: r.id } },
      } }) })
    if (res.ok) { sent++; return }
    const b = await res.json().catch(() => ({}))
    const code = JSON.stringify(b?.error?.details ?? '') + (b?.error?.status ?? '')
    if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(code)) dead.push(t); else failed.push(`${res.status}`)
  })))
  if (dead.length) await db.rpc('push_device_dead', { p_tokens: dead })
  return json(200, { configured: true, claimed: rows.length, sent, dead: dead.length, failed: failed.length })
})
