import { useEffect, useState } from 'react'
import { AppShell } from '../../components/AppShell'
import { hrFriendly } from '../../lib/hr'
import { ALL_ON, loadNodiFeatures, nodi, type NodiFeature, type NodiFeatures, type NodiSettings as S } from '../../lib/nodi'
import { Badge, Field, useLoad, useToast } from '../accounts/ui'

const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']
const PARTS: Array<{ k: NodiFeature; bn: string; hint: string; ai: boolean }> = [
  { k: 'chat', bn: 'চ্যাট অ্যাসিস্ট্যান্ট', hint: 'নদী AI চ্যাট পাতা ও প্রতিটি পাতার ভাসমান নদী বোতাম', ai: true },
  { k: 'teach', bn: 'হিসাব শিক্ষক', hint: 'হিসাব শেখার পাতায় বাংলায় প্রশ্নের উত্তর', ai: true },
  { k: 'office', bn: 'অফিসের AI পরামর্শ', hint: 'ভাড়ার চুক্তি লেখা, বিদ্যুৎ বিল কমানো, অপারেশন পরামর্শ', ai: true },
  { k: 'gaps', bn: '“নদী জিজ্ঞেস করছে” — হাজিরার প্রশ্ন', hint: 'যেদিন হাজিরা ওঠেনি, কর্মীর হোম ও স্টাফ প্যানেলে কারণ জানতে চাওয়া; বন্ধ থাকলে রিমাইন্ডারও যায় না', ai: false },
  { k: 'followup', bn: 'ইস্যুর ফলো-আপ', hint: 'যে ইস্যু পড়ে আছে, ঘণ্টায় ঘণ্টায় মনে করিয়ে দেওয়া', ai: false },
]
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
  const [parts, setParts] = useState<NodiFeatures>(ALL_ON)
  const [partBusy, setPartBusy] = useState<NodiFeature | null>(null)
  const [partErr, setPartErr] = useState('')
  useEffect(() => { if (cfg.data) { setF(cfg.data); setParts({ ...ALL_ON, ...cfg.data.features }) } }, [cfg.data])
  async function flip(k: NodiFeature) {
    const on = !parts[k]
    setPartErr(''); setPartBusy(k)
    try {
      await nodi.configureFeatures({ [k]: on }); setParts(p => ({ ...p, [k]: on }))
      toast(`${PARTS.find(x => x.k === k)?.bn} ${on ? 'চালু' : 'বন্ধ'} হয়েছে`); void loadNodiFeatures(true)
    } catch (e) { setPartErr(errText(e)) } finally { setPartBusy(null) }
  }
  async function save() {
    if (!f) return
    setErr(''); try { await nodi.configure(f); toast('সংরক্ষণ হয়েছে'); await cfg.reload(); void loadNodiFeatures(true) } catch (e) { setErr(errText(e)) }
  }
  async function test() {
    setBusy(true); setAns('')
    try { setAns((await nodi.chat([{ role: 'user', content: q || 'নমস্কার, তুমি কে?' }])).text); void usage.reload() } catch (e) { setAns(errText(e)) } finally { setBusy(false) }
  }
  const rows = usage.data ?? []
  return <AppShell title="নদী AI সেটিংস" subtitle="কোন অংশ চালু, API key, মডেল, দৈনিক সীমা ও ব্যবহার">
    <div className="da-card" style={{ padding: 14, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>API key <Badge tone={key.data ? 'ok' : 'bad'}>{key.loading ? '…' : key.data ? 'বসানো আছে' : 'বসানো নেই'}</Badge></h3>
      {!key.data && !key.loading && <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>
        <li>Supabase → Project → <strong>Edge Functions → Secrets</strong> খুলুন।</li>
        <li><code>ANTHROPIC_API_KEY</code> নামে আপনার Anthropic key বসান। এটা শুধু ওখানেই থাকবে — চ্যাট, কোড বা এই অ্যাপে নয়।</li>
        <li>ফাংশন <code>nodi-ai</code> (verify JWT বন্ধ) ডেপ্লয় করা থাকলে এখানে ফিরে এসে রিফ্রেশ করুন।</li></ol>}
      <p className="muted" style={{ margin: 0 }}>key কখনো ব্রাউজারে আসে না। ফাংশন শুধু জানায় বসানো আছে কি না।</p>
    </div>
    {f && <div className="da-card" style={{ padding: 14, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>কোন অংশ চালু থাকবে</h3>
      <p className="muted small" style={{ marginTop: 0 }}>প্রতিটি সুইচ চাপলেই সাথে সাথে সবার জন্য বদলায়। নিচের “নদী AI চালু” বন্ধ করলে AI অংশগুলো (API key লাগে) একসাথে বন্ধ হয়; হাজিরার প্রশ্ন আর ইস্যুর ফলো-আপ শুধু নিজের সুইচ মানে।</p>
      <ul className="nodi-parts">{PARTS.map(p => {
        const blocked = p.ai && cfg.data?.enabled === false
        return <li key={p.k}>
          <div><b>{p.bn}</b> {p.ai ? <Badge tone="info">AI</Badge> : <Badge tone="neutral">AI ছাড়া</Badge>}
            <div className="muted small">{p.hint}{blocked ? ' — মূল সুইচ বন্ধ, তাই এখন কাজ করবে না' : ''}</div></div>
          <button type="button" role="switch" aria-checked={parts[p.k]} aria-label={p.bn} disabled={partBusy !== null}
            className={`nodi-switch${parts[p.k] ? ' on' : ''}`} onClick={() => void flip(p.k)}>
            <span className="knob" aria-hidden="true" /><span>{partBusy === p.k ? '…' : parts[p.k] ? 'চালু' : 'বন্ধ'}</span></button>
        </li>
      })}</ul>
      {partErr && <p className="da-error" role="alert">{partErr}</p>}
    </div>}
    {f && <div className="da-card" style={{ padding: 14, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>মূল সুইচ, মডেল ও সীমা</h3>
      <div className="da-form">
        <Field label="নদী AI চালু"><select value={f.enabled ? '1' : '0'} onChange={e => setF({ ...f, enabled: e.target.value === '1' })}><option value="1">চালু</option><option value="0">বন্ধ</option></select></Field>
        <Field label="মডেল"><select value={f.model} onChange={e => setF({ ...f, model: e.target.value })}>{[...new Set([f.model, ...MODELS])].map(m => <option key={m}>{m}</option>)}</select></Field>
        <Field label="একজন দিনে কতবার" hint="ঢাকার সময় অনুযায়ী দিন"><input type="number" min={1} max={5000} value={f.daily_limit} onChange={e => setF({ ...f, daily_limit: Number(e.target.value) })} /></Field>
        <Field label="উত্তরের সর্বোচ্চ দৈর্ঘ্য (টোকেন)"><input type="number" min={100} max={8000} value={f.max_tokens} onChange={e => setF({ ...f, max_tokens: Number(e.target.value) })} /></Field>
      </div>
      {err && <p className="da-error" role="alert">{err}</p>}
      <button type="button" onClick={() => void save()}>সংরক্ষণ</button></div>}
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
