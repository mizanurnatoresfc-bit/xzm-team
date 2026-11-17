import { useEffect, useState } from 'react'
import { Field } from '../pages/accounts/ui'
import { useOrg } from '../pages/hr/common'
import { referrals } from '../lib/extra'
import { refs } from '../lib/refs'
import { Icon } from './Icon'
import { Combo } from './inputs'

/** A reference person: someone in the system, or a person written by hand (outside / not in the system). */
export type RefPerson =
  | { kind: 'employee'; id: string; code: string | null; name: string; hub: string; position: string; mobile?: string | null }
  | { kind: 'manual'; name: string; code: string; hub: string; position: string; mobile: string }
type Mode = 'list' | 'id' | 'manual'
type Emp = { id: string; employee_code: string | null; full_name: string; post: string | null; mobile: string | null }

/** Pick a person three ways: হাব → পদ → নাম, by Employee ID, or write it by hand. */
export function PersonPicker({ value, onChange, exclude }: { value: RefPerson | null; onChange: (v: RefPerson | null) => void; exclude?: string }) {
  const o = useOrg()
  const [mode, setMode] = useState<Mode>(value?.kind === 'manual' ? 'manual' : 'list')
  const [hub, setHub] = useState('')
  const [pos, setPos] = useState('')
  const [people, setPeople] = useState<Emp[] | null>(null)
  const [code, setCode] = useState('')
  const [found, setFound] = useState<'none' | null>(null)
  const [m, setM] = useState({ name: '', code: '', hub: '', position: '', mobile: '' })
  useEffect(() => { if (value?.kind === 'manual') setM({ name: value.name, code: value.code, hub: value.hub, position: value.position, mobile: value.mobile }) }, [value?.kind]) // eslint-disable-line react-hooks/exhaustive-deps

  // হাব → পদ → নাম: the people of the chosen hub (and post).
  useEffect(() => {
    if (mode !== 'list' || !hub) { setPeople(null); return }
    setPeople(null)
    // Read through ref_hub_people so staff (whose own access is one profile) can pick too.
    void refs.hubPeople(hub).then(r => setPeople(((r ?? []) as Emp[]).filter(e => e.id !== exclude))).catch(() => setPeople([]))
  }, [mode, hub, exclude])
  // By ID: look the code up as it is typed.
  useEffect(() => {
    if (mode !== 'id' || !code.trim()) { setFound(null); return }
    const t = window.setTimeout(() => {
      void referrals.lookup(code.trim()).then(r => {
        if (!r || r.id === exclude) { setFound('none'); return }
        setFound(null); onChange({ kind: 'employee', id: r.id, code: r.employee_code, name: r.full_name, hub: r.hub_name ?? '', position: r.position_name ?? '' })
      }).catch(() => setFound('none'))
    }, 350)
    return () => window.clearTimeout(t)
  }, [code, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const hubName = (id: string | null) => o.names.hub[id ?? ''] ?? ''
  const pick = (e: Emp) => onChange({ kind: 'employee', id: e.id, code: e.employee_code, name: e.full_name, hub: hubName(hub), position: e.post ?? '', mobile: e.mobile })
  const setManual = (k: keyof typeof m, v: string) => { const n = { ...m, [k]: v }; setM(n); onChange(n.name.trim() ? { kind: 'manual', ...n } : null) }
  const posts = [...new Set((people ?? []).map(p => p.post ?? '—'))].sort()
  const shown = (people ?? []).filter(p => !pos || (p.post ?? '—') === pos)

  return <div className="pp">
    {value && <div className={`pp-card${value.kind === 'manual' ? ' manual' : ''}`}>
      <span className="pp-av">{value.name.slice(0, 1).toUpperCase()}</span>
      <div className="pp-who"><b>{value.name}</b>
        <small>{[value.code && `আইডি ${value.code}`, value.position, value.hub, value.mobile].filter(Boolean).join(' · ') || '—'}</small>
        {value.kind === 'manual' && <span className="pp-tag">নিজে লেখা</span>}</div>
      <button type="button" className="icon-btn" aria-label="সরান" onClick={() => onChange(null)}><Icon name="x" size={16} /></button>
    </div>}
    <div className="seg pp-modes">
      <button type="button" className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>হাব → পদ → নাম</button>
      <button type="button" className={mode === 'id' ? 'on' : ''} onClick={() => setMode('id')}>আইডি দিয়ে</button>
      <button type="button" className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>নিজে লিখুন</button>
    </div>
    {mode === 'list' && <div className="hr-form pp-form">
      <Field label="হাব"><Combo value={hub} onChange={v => { setHub(v); setPos('') }} options={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name }))} /></Field>
      <Field label="পদ"><select value={pos} disabled={!hub} onChange={e => setPos(e.target.value)}><option value="">সব পদ</option>
        {posts.map(p => <option key={p} value={p}>{p} ({people?.filter(x => (x.post ?? '—') === p).length ?? 0})</option>)}</select></Field>
      <Field label="নাম" wide><Combo value={value?.kind === 'employee' ? value.id : ''} disabled={!hub || !people} clearable={false}
        onChange={v => { const p = people?.find(x => x.id === v); if (p) pick(p) }}
        placeholder={!hub ? 'আগে হাব বাছুন' : !people ? 'লোড হচ্ছে…' : shown.length ? `নাম, আইডি বা মোবাইল লিখে খুঁজুন… (${shown.length} জন)` : 'কাউকে পাওয়া যায়নি'}
        options={shown.map(p => ({ value: p.id, label: p.full_name, keywords: p.mobile ?? '',
          sub: [p.employee_code && `#${p.employee_code}`, !pos && p.post ? p.post : ''].filter(Boolean).join(' · ') }))} /></Field>
    </div>}
    {mode === 'id' && <Field label="এমপ্লয়ি আইডি" hint={found === 'none' ? <span className="bad">এই আইডির কাউকে পাওয়া যায়নি</span> : 'আইডি লিখলে নিজে খুঁজে নেবে'}>
      <input inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} placeholder="যেমন 10086" /></Field>}
    {mode === 'manual' && <div className="hr-form pp-form">
      <Field label="নাম *"><input value={m.name} onChange={e => setManual('name', e.target.value)} /></Field>
      <Field label="আইডি"><input value={m.code} onChange={e => setManual('code', e.target.value)} placeholder="থাকলে" /></Field>
      <Field label="হাবের নাম"><input list="pp-hubs" value={m.hub} onChange={e => setManual('hub', e.target.value)} /></Field>
      <Field label="পদবি"><input list="pp-posts" value={m.position} onChange={e => setManual('position', e.target.value)} /></Field>
      <Field label="মোবাইল" wide><input inputMode="tel" value={m.mobile} onChange={e => setManual('mobile', e.target.value)} placeholder="01XXXXXXXXX" /></Field>
      <datalist id="pp-hubs">{o.data?.hubs.map(h => <option key={h.id} value={h.name} />)}</datalist>
      <datalist id="pp-posts">{o.data?.positions.map(p => <option key={p.id} value={p.name} />)}</datalist>
    </div>}
  </div>
}
