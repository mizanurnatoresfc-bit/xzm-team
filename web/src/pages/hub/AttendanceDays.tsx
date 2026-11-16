// হাজিরার দিন মেলানো — for each person of the hub and a period: the days on the online system and the days in the hub's
// own register, written by the hub. The site's own count is shown beside them and fills the "online" box when it has any.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { Icon } from '../../components/Icon'
import { hrFriendly } from '../../lib/hr'
import { toLatinDigits } from '../../lib/validate'
import { download, xlsxBlob } from '../../lib/xlsx'
import { Badge, useLoad, useToast } from '../accounts/ui'
import { useOrg } from '../hr/common'

type Row = { employee_id: string; employee_code: string | null; full_name: string; position_name: string | null; site_days: number
  online_days: number | null; register_days: number | null; note: string | null; submitted_by_name: string | null; submitted_at: string | null }
type Draft = Record<string, { on: string; reg: string; note: string }>
const bn = (v: number | string) => String(v).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)])
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const lastDay = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()
/** 1–15 or 16–end of a month. */
function period(ym: string, half: 1 | 2) { return half === 1 ? { from: `${ym}-01`, to: `${ym}-15` } : { from: `${ym}-16`, to: `${ym}-${String(lastDay(ym)).padStart(2, '0')}` } }
const num = (s: string) => { const t = toLatinDigits(s).trim(); return t === '' ? null : Number(t) }

export function AttendanceDays({ hub }: { hub: { id: string; name: string; code: string } }) {
  const { can } = useAuth()
  const { toast, node } = useToast()
  const o = useOrg()
  const post = (name: string | null) => { const p = (o.data?.positions ?? []).find(x => x.name === name); return (p && o.names.pos[p.id]) || name || 'পদ নেই' }
  const t = today()
  const [ym, setYm] = useState(t.slice(0, 7))
  const [half, setHalf] = useState<1 | 2>(Number(t.slice(8)) <= 15 ? 1 : 2)
  const p = period(ym, half)
  const days = Number(p.to.slice(8)) - Number(p.from.slice(8)) + 1
  const list = useLoad(async () => {
    const { data, error } = await supabase.rpc('att_days_list', { p_hub: hub.id, p_from: p.from, p_to: p.to })
    if (error) throw error
    return (data ?? []) as Row[]
  }, [hub.id, p.from, p.to])
  const [d, setD] = useState<Draft>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const edit = can('hr.attendance.create')
  useEffect(() => {
    setD(Object.fromEntries((list.data ?? []).map(r => [r.employee_id, { on: r.online_days !== null ? String(r.online_days) : r.site_days > 0 ? String(r.site_days) : '', reg: r.register_days !== null ? String(r.register_days) : '', note: r.note ?? '' }])))
  }, [list.data])
  const rows = list.data ?? []
  const set = (id: string, k: 'on' | 'reg' | 'note', v: string) => setD(x => ({ ...x, [id]: { ...(x[id] ?? { on: '', reg: '', note: '' }), [k]: v } }))
  const filled = rows.filter(r => num(d[r.employee_id]?.on ?? '') !== null && num(d[r.employee_id]?.reg ?? '') !== null)
  const differ = filled.filter(r => num(d[r.employee_id].on) !== num(d[r.employee_id].reg))
  const saved = rows.filter(r => r.online_days !== null).length
  const bad = useMemo(() => rows.find(r => { const x = d[r.employee_id]; if (!x) return false; const a = num(x.on), b = num(x.reg)
    return (a !== null && (!Number.isInteger(a) || a < 0 || a > days)) || (b !== null && (!Number.isInteger(b) || b < 0 || b > days)) || ((a === null) !== (b === null)) }), [rows, d, days])

  async function save() {
    setErr('')
    if (bad) return setErr(`${bad.full_name}: দুটি ঘরেই ০ থেকে ${bn(days)}-এর মধ্যে সংখ্যা দিন (একটি ফাঁকা রাখা যাবে না)।`)
    if (!filled.length) return setErr('অন্তত একজনের দুটি সংখ্যা লিখুন।')
    setBusy(true)
    try {
      const { error } = await supabase.rpc('att_days_save', { p_hub: hub.id, p_from: p.from, p_to: p.to,
        p_rows: filled.map(r => ({ employee_id: r.employee_id, online_days: num(d[r.employee_id].on), register_days: num(d[r.employee_id].reg), note: d[r.employee_id].note.trim() || null })) })
      if (error) throw error
      toast(`${bn(filled.length)} জনের হাজিরার দিন জমা হয়েছে`); await list.reload()
    } catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  function excel() {
    download(xlsxBlob(`XZM-TEAM — হাজিরার দিন · ${hub.name}`, `${p.from} থেকে ${p.to}`, ['ID', 'নাম', 'পদ', 'অনলাইন হাজিরা (দিন)', 'হাবের খাতা (দিন)', 'পার্থক্য', 'নোট'],
      rows.map(r => { const a = num(d[r.employee_id]?.on ?? ''), b = num(d[r.employee_id]?.reg ?? ''); return [r.employee_code ?? '', r.full_name, r.position_name ?? '', a ?? '', b ?? '', a !== null && b !== null ? b - a : '', d[r.employee_id]?.note ?? ''] })),
      `attendance-days-${hub.code}-${p.from}.xlsx`)
  }

  return <div className="nv ad">
    {node}
    <div className="nv-chips no-print" role="group" aria-label="কোন সময়">
      <input type="month" value={ym} max={t.slice(0, 7)} onChange={e => e.target.value && setYm(e.target.value)} aria-label="মাস" className="ad-month" />
      <button type="button" className={`nv-chip${half === 1 ? ' on' : ''}`} aria-pressed={half === 1} onClick={() => setHalf(1)}>১–১৫ তারিখ</button>
      <button type="button" className={`nv-chip${half === 2 ? ' on' : ''}`} aria-pressed={half === 2} onClick={() => setHalf(2)}>১৬–{bn(lastDay(ym))} তারিখ</button>
      <button type="button" className="nv-chip" onClick={excel} disabled={!rows.length}><Icon name="xls" size={15} /> Excel</button>
    </div>
    <section className="nv-hero">
      <div className="nv-hero-main"><span className="lbl">হাজিরার দিন মেলানো · {hub.name}</span>
        <b className="big">{bn(saved)} / {bn(rows.length)} জনের জমা হয়েছে</b>
        <span className="sub">এই সময়ে মোট {bn(days)} দিন। প্রতি জনের পাশে লিখুন: অনলাইনে কত দিন হাজিরা, আর হাবের খাতায় কত দিন।</span></div>
      <div className="nv-nums"><div><b>{bn(filled.length)}</b><span>লেখা হয়েছে</span></div><div className={differ.length ? 'warn' : ''}><b>{bn(differ.length)}</b><span>দুই সংখ্যা মেলেনি</span></div></div>
    </section>
    {list.error ? <p className="da-error">{hrFriendly(list.error)}</p> : null}
    {list.loading && !list.data ? <p className="muted">লোড হচ্ছে…</p> : rows.length === 0 ? <div className="nv-empty"><Icon name="users" size={32} /><p>এই হাবে কোনো সক্রিয় কর্মী নেই।</p></div> :
      <div className="nv-rows ad-rows">
        <div className="nv-row ad-head" aria-hidden="true"><span className="tx"><b>কর্মী</b></span><span className="ad-in"><span>অনলাইন</span><span>খাতা</span></span></div>
        {rows.map(r => { const x = d[r.employee_id] ?? { on: '', reg: '', note: '' }; const a = num(x.on), b = num(x.reg); const diff = a !== null && b !== null && a !== b
          return <div key={r.employee_id} className={`nv-row${diff ? ' ad-diff' : ''}`}>
            <span className="nv-av">{r.full_name.slice(0, 1)}</span>
            <span className="tx"><b>{r.full_name}</b><span>{r.employee_code ? `ID ${r.employee_code} · ` : ''}{post(r.position_name)}{r.site_days > 0 ? ` · এই সাইটে ${bn(r.site_days)} দিন` : ''}</span>
              {diff && <span className="who"><em>পার্থক্য {bn(Math.abs(b! - a!))} দিন</em> <input className="ad-note" value={x.note} disabled={!edit} onChange={e => set(r.employee_id, 'note', e.target.value)} placeholder="কেন মেলেনি (ঐচ্ছিক)" aria-label={`${r.full_name} — নোট`} /></span>}
              {!diff && r.submitted_at && <span className="who">জমা দিয়েছেন {r.submitted_by_name ?? '—'}</span>}</span>
            <span className="ad-in">
              <input inputMode="numeric" value={x.on} disabled={!edit} onChange={e => set(r.employee_id, 'on', toLatinDigits(e.target.value).replace(/[^\d]/g, '').slice(0, 2))} aria-label={`${r.full_name} — অনলাইন হাজিরা কত দিন`} placeholder="—" />
              <input inputMode="numeric" value={x.reg} disabled={!edit} onChange={e => set(r.employee_id, 'reg', toLatinDigits(e.target.value).replace(/[^\d]/g, '').slice(0, 2))} aria-label={`${r.full_name} — হাবের খাতায় কত দিন`} placeholder="—" />
            </span>
          </div> })}
      </div>}
    {err && <p className="da-error" role="alert">{err}</p>}
    {edit && rows.length > 0 && <div className="nv-sheet"><div className="da-actionbar no-print">
      <span className="muted small">{differ.length ? <Badge tone="warn">{bn(differ.length)} জনের দুই সংখ্যা মেলেনি</Badge> : null} লেখা শেষ হলে জমা দিন — পরে আবার ঠিক করে জমা দেওয়া যায়।</span>
      <button type="button" disabled={busy || !filled.length} onClick={() => void save()}>{busy ? 'জমা হচ্ছে…' : `${bn(filled.length)} জনের হিসাব জমা দিন`}</button></div></div>}
  </div>
}
