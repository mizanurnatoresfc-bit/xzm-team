import { useEffect, useState } from 'react'
import { AppShell } from '../../components/AppShell'
import { hrFriendly } from '../../lib/hr'
import { nodi, type NodiSettings as S } from '../../lib/nodi'
import { Badge, Field, useLoad, useToast } from '../accounts/ui'

const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : hrFriendly(e))

export function NodiSettings() {
  const { toast, node } = useToast()
  const cfg = useLoad(() => nodi.settings(), [])
  const key = useLoad(() => nodi.keyConfigured(), [])
  const usage = useLoad(() => nodi.usage(14), [])
  const [f, setF] = useState<S | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [ans, setAns] = useState('')
  const [busy, setBusy] = useState(false)
  const roles = useLoad(() => nodi.roles(), [])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => { if (cfg.data) setF(cfg.data) }, [cfg.data])
  useEffect(() => { if (roles.data) setPicked(new Set(roles.data.filter(r => r.enabled).map(r => r.code))) }, [roles.data])
  async function saveRoles() {
    try { await nodi.setRoles([...picked]); toast('সংরক্ষণ হয়েছে'); await roles.reload() } catch (e) { setErr(errText(e)) }
  }
  async function save() {
    if (!f) return
    setErr(''); try { await nodi.configure(f); toast('সংরক্ষণ হয়েছে'); await cfg.reload() } catch (e) { setErr(errText(e)) }
  }
  async function test() {
    setBusy(true); setAns('')
    try { setAns((await nodi.chat([{ role: 'user', content: q || 'নমস্কার, তুমি কে?' }])).text); void usage.reload() } catch (e) { setAns(errText(e)) } finally { setBusy(false) }
  }
  const rows = usage.data ?? []
  return <AppShell title="নদী AI সেটিংস" subtitle="API key, মডেল, দৈনিক সীমা ও ব্যবহার">
    <div className="da-card" style={{ padding: 14, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>API key <Badge tone={key.data ? 'ok' : 'bad'}>{key.loading ? '…' : key.data ? 'বসানো আছে' : 'বসানো নেই'}</Badge></h3>
      {!key.data && !key.loading && <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>
        <li>Supabase → Project → <strong>Edge Functions → Secrets</strong> খুলুন।</li>
        <li><code>ANTHROPIC_API_KEY</code> নামে আপনার Anthropic key বসান। এটা শুধু ওখানেই থাকবে — চ্যাট, কোড বা এই অ্যাপে নয়।</li>
        <li>ফাংশন <code>nodi-ai</code> (verify JWT বন্ধ) ডেপ্লয় করা থাকলে এখানে ফিরে এসে রিফ্রেশ করুন।</li></ol>}
      <p className="muted" style={{ margin: 0 }}>key কখনো ব্রাউজারে আসে না। ফাংশন শুধু জানায় বসানো আছে কি না।</p>
    </div>
    {f && <div className="da-card" style={{ padding: 14, marginBottom: 12 }}>
      <div className="da-form">
        <Field label="নদী AI চালু"><select value={f.enabled ? '1' : '0'} onChange={e => setF({ ...f, enabled: e.target.value === '1' })}><option value="1">চালু</option><option value="0">বন্ধ</option></select></Field>
        <Field label="মডেল"><select value={f.model} onChange={e => setF({ ...f, model: e.target.value })}>{[...new Set([f.model, ...MODELS])].map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label="একজন দিনে কতবার" hint="ঢাকার সময় অনুযায়ী দিন"><input type="number" min={1} max={5000} value={f.daily_limit} onChange={e => setF({ ...f, daily_limit: Number(e.target.value) })} /></Field>
        <Field label="উত্তরের সর্বোচ্চ দৈর্ঘ্য (টোকেন)"><input type="number" min={100} max={8000} value={f.max_tokens} onChange={e => setF({ ...f, max_tokens: Number(e.target.value) })} /></Field>
      </div>
      {err && <p className="da-error" role="alert">{err}</p>}
      <button type="button" onClick={() => void save()}>সংরক্ষণ</button></div>}
    <div className="da-card" style={{ padding: 14, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>কোন ভূমিকা নদী AI দেখবে</h3>
      <p className="muted" style={{ marginTop: 0 }}>টিক দেওয়া ভূমিকার মানুষ মেনু ও নদীর বাটন দেখবে। সেটিংস-অনুমতিওয়ালা ভূমিকা সবসময় দেখবে।</p>
      {roles.error ? <p className="da-error" role="alert">{errText(roles.error)}</p> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 6, marginBottom: 10 }}>
        {(roles.data ?? []).map(r => <label key={r.code} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" disabled={r.locked} checked={r.locked || picked.has(r.code)} onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(r.code); else n.delete(r.code); return n })} />
          {r.name_bn || r.name}</label>)}</div>}
      <button type="button" onClick={() => void saveRoles()}>ভূমিকা সংরক্ষণ</button></div>
    <div className="da-card" style={{ padding: 14, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>পরীক্ষা</h3>
      <div style={{ display: 'flex', gap: 8 }}><input style={{ flex: 1 }} placeholder="নদীকে কিছু জিজ্ঞাসা করুন" value={q} onChange={e => setQ(e.target.value)} />
        <button type="button" disabled={busy || !key.data} onClick={() => void test()}>{busy ? '…' : 'পাঠান'}</button></div>
      {ans && <p style={{ whiteSpace: 'pre-wrap' }}>{ans}</p>}</div>
    <div className="da-card" style={{ padding: 14 }}>
      <h3 style={{ marginTop: 0 }}>ব্যবহার (শেষ ১৪ দিন)</h3>
      {rows.length ? <table className="da-table"><thead><tr><th>দিন</th><th>কে</th><th>বার</th><th>ব্যর্থ</th><th>ইনপুট টোকেন</th><th>আউটপুট টোকেন</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{r.day}</td><td>{r.full_name}</td><td>{r.requests}</td><td>{r.failed}</td><td>{r.input_tokens}</td><td>{r.output_tokens}</td></tr>)}</tbody></table>
        : <p className="muted">এখনো কেউ ব্যবহার করেনি</p>}</div>
    {node}
  </AppShell>
}
