import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Icon } from '../../components/Icon'
import { ATT_WORD, daily, dailyFriendly, OUT_WORD, type AttSt, type OutRider, type SheetRow } from '../../lib/daily'
import type { Hub } from '../../lib/hr'
import { usePrefs } from '../../lib/prefs'
import { PLACE } from '../../lib/presence'
import { Badge, Field, Modal, useLoad, useToast } from '../accounts/ui'

/**
 * Hub manager, every morning: send only who is absent / late / half day by 11 am — everyone else becomes present.
 * After sending, a mistake is fixed per person with a note (the staff member is told, and it is logged).
 */
type Mark = 'present' | 'absent' | 'late' | 'half_day'
const MARKS: Mark[] = ['present', 'absent', 'late', 'half_day']

export function AbsenceList({ hub, onDone }: { hub: Hub; onDone?: () => void }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const q = useLoad(() => daily.sheet(hub.id), [hub.id])
  const v = q.data
  const [pick, setPick] = useState<Record<string, { m: Mark; note: string }>>({})
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [fix, setFix] = useState<{ row: SheetRow; m: Mark; note: string } | null>(null)
  const [search, setSearch] = useState('')
  // Start from what is known: today's register, else the staff member's own "not coming", else present.
  useEffect(() => {
    if (!v) return
    const p: Record<string, { m: Mark; note: string }> = {}
    for (const s of v.staff) {
      const st = s.status && MARKS.includes(s.status as Mark) ? s.status as Mark : s.self?.kind === 'absent' ? 'absent' : 'present'
      p[s.employee_id] = { m: st, note: s.self?.kind === 'absent' ? s.self.note ?? '' : '' }
    }
    setPick(p)
  }, [v])
  const sent = !!v?.submission
  const locked = (s: SheetRow) => s.on_leave || s.status === 'leave' || s.status === 'holiday' || s.status === 'weekly_off'
  const rows = useMemo(() => (v?.staff ?? []).filter(s => !search.trim() || `${s.full_name} ${s.employee_code ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())), [v, search])
  const out = (v?.staff ?? []).filter(s => !locked(s) && (pick[s.employee_id]?.m ?? 'present') !== 'present')
  const clock = (t: string) => new Date(t).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })

  async function submit() {
    if (!v) return
    if (!window.confirm(L(`অনুপস্থিত/দেরি/অর্ধদিবস ${n(out.length)} জন — বাকি সবাই উপস্থিত হবে। জমা দেবেন?`, `${out.length} not present — everyone else becomes present. Send?`))) return
    setBusy(true); setErr('')
    try {
      const r = await daily.submit(hub.id, out.map(s => ({ employee_id: s.employee_id, status: pick[s.employee_id].m as 'absent' | 'late' | 'half_day', note: pick[s.employee_id].note.trim() || null })))
      await q.reload(); onDone?.()
      toast(L(`জমা হয়েছে: উপস্থিত ${n(r.present)}, অনুপস্থিত/অন্যান্য ${n(r.absent)}`, `Sent: ${r.present} present, ${r.absent} not present`))
    } catch (e) { setErr(dailyFriendly(e)) } finally { setBusy(false) }
  }
  async function correct() {
    if (!fix || !v) return
    if (!fix.note.trim()) return setErr(L('কেন সংশোধন করছেন, নোট লিখুন', 'Write why'))
    setBusy(true); setErr('')
    try { await daily.correct(fix.row.employee_id, v.work_date, fix.m, fix.note.trim()); setFix(null); await q.reload(); onDone?.(); toast(L('সংশোধন হয়েছে', 'Corrected')) }
    catch (e) { setErr(dailyFriendly(e)) } finally { setBusy(false) }
  }

  if (q.error) return <p className="da-error">{dailyFriendly(q.error)}</p>
  if (!v) return null
  return <section className="panel absence">{node}
    <div className="da-bar"><h2>{L('আজকের অনুপস্থিত তালিকা', "Today's absent list")} <span className="muted small">· {L('সকাল ১১টার মধ্যে', 'by 11 am')}</span></h2>
      {sent ? <Badge tone={v.submission!.late ? 'warn' : 'ok'}>{L(`জমা ${clock(v.submission!.submitted_at)}`, `Sent ${clock(v.submission!.submitted_at)}`)}{v.submission!.late ? L(' · দেরিতে', ' · late') : ''}</Badge>
        : <Badge tone={v.past_deadline ? 'bad' : 'warn'}>{v.past_deadline ? L('১১টা পেরিয়ে গেছে — এখনই দিন', 'Past 11 — send now') : L('এখনো জমা হয়নি', 'Not sent yet')}</Badge>}</div>
    <p className="muted small">{sent
      ? L(`${v.submission!.by ?? ''} জমা দিয়েছেন: উপস্থিত ${n(v.submission!.present)}, অনুপস্থিত/অন্যান্য ${n(v.submission!.absent)}। ভুল থাকলে নিচে "সংশোধন" চেপে নোট দিয়ে ঠিক করুন — কর্মী জানতে পারবেন।`,
          `Sent by ${v.submission!.by ?? ''}: ${v.submission!.present} present, ${v.submission!.absent} not. Fix a mistake with "Correct" and a note — the staff member is told.`)
      : L('শুধু যারা আসেননি / দেরিতে / অর্ধদিবস তাদের বাছুন। জমা দিলে বাকি সবাই উপস্থিত হয়ে যাবে। অনুমোদিত ছুটি নিজে থেকেই থাকে।',
          'Mark only who is absent / late / half day. On sending, everyone else becomes present. Approved leave stays.')}</p>
    {(v.staff.length > 8) && <input className="absence-search" placeholder={L('নাম বা আইডি খুঁজুন', 'Search name or ID')} value={search} onChange={e => setSearch(e.target.value)} />}
    <div className="absence-rows">{rows.map(s => { const p = pick[s.employee_id] ?? { m: 'present' as Mark, note: '' }; const lk = locked(s)
      const shown: AttSt | Mark = lk ? (s.status ?? 'leave') : sent ? (s.status ?? 'present') : p.m
      return <div key={s.employee_id} className={`absence-row${shown !== 'present' ? ' off' : ''}`}>
        <div className="absence-who"><b>{s.full_name}</b><small className="muted">{[s.employee_code, lang === 'bn' ? s.position : s.position_en].filter(Boolean).join(' · ')}</small>
          {s.self && <small className="absence-self">{s.self.kind === 'present' ? L('নিজে: হাবে এসেছি', 'Self: arrived') : `${L('নিজে: আসবেন না', 'Self: not coming')}${s.self.note ? ' — ' + s.self.note : ''}`}
            {s.self.place_status ? ` · ${L(PLACE[s.self.place_status][0], PLACE[s.self.place_status][1])}` : ''}</small>}
          {sent && s.note && s.source !== 'absence_list' && <small className="muted">{L('নোট', 'Note')}: {s.note}</small>}</div>
        {lk ? <Badge tone="info">{L(ATT_WORD[shown as AttSt]?.[0] ?? 'ছুটি', ATT_WORD[shown as AttSt]?.[1] ?? 'Leave')}</Badge>
        : sent ? <span className="row-acts"><Badge tone={ATT_WORD[shown as AttSt]?.[2] ?? 'neutral'}>{L(ATT_WORD[shown as AttSt]?.[0] ?? '', ATT_WORD[shown as AttSt]?.[1] ?? '')}</Badge>
            {s.corrections > 0 && <Badge tone="neutral">{L(`সংশোধিত ${n(s.corrections)}`, `corrected ${s.corrections}`)}</Badge>}
            <button className="secondary sm" onClick={() => { setErr(''); setFix({ row: s, m: (MARKS.includes(shown as Mark) ? shown : 'present') as Mark, note: '' }) }}><Icon name="edit" size={13} />{L('সংশোধন', 'Correct')}</button></span>
        : <div className="absence-pick">
            <span className="da-seg">{MARKS.map(m => <button key={m} type="button" className={p.m === m ? `sm att-${m} on` : 'secondary sm'} aria-pressed={p.m === m}
              onClick={() => setPick({ ...pick, [s.employee_id]: { ...p, m } })}>{L(ATT_WORD[m][0], ATT_WORD[m][1])}</button>)}</span>
            {p.m !== 'present' && <input value={p.note} placeholder={L('কারণ (ইচ্ছা হলে)', 'Reason (optional)')} onChange={e => setPick({ ...pick, [s.employee_id]: { ...p, note: e.target.value } })} />}
          </div>}
      </div> })}</div>
    {err && !fix && <p className="da-error">{err}</p>}
    {!sent && v.staff.length > 0 && <div className="absence-foot">
      <span>{L(`অনুপস্থিত/দেরি/অর্ধদিবস: ${n(out.length)} জন · বাকি ${n(v.staff.filter(s => !locked(s)).length - out.length)} জন উপস্থিত হবে`,
        `${out.length} not present · ${v.staff.filter(s => !locked(s)).length - out.length} will be present`)}</span>
      <button disabled={busy} onClick={() => void submit()}><Icon name="check" size={15} />{busy ? L('জমা হচ্ছে…', 'Sending…') : L('জমা দিন', 'Send')}</button></div>}
    {fix && <Modal title={L(`হাজিরা সংশোধন — ${fix.row.full_name}`, `Correct attendance — ${fix.row.full_name}`)} onClose={() => setFix(null)}
      actions={<><button className="secondary" onClick={() => setFix(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void correct()}>{L('সংশোধন করুন', 'Correct')}</button></>}>
      <span className="da-seg">{MARKS.map(m => <button key={m} type="button" className={fix.m === m ? 'sm' : 'secondary sm'} onClick={() => setFix({ ...fix, m })}>{L(ATT_WORD[m][0], ATT_WORD[m][1])}</button>)}</span>
      <Field label={L('কেন সংশোধন (জরুরি)', 'Why (required)')} required><textarea rows={2} autoFocus value={fix.note} onChange={e => setFix({ ...fix, note: e.target.value })}
        placeholder={L('যেমন: ভুল করে অনুপস্থিত দিয়েছিলাম, উনি ৯টায় এসেছেন', 'e.g. marked absent by mistake, came at 9')} /></Field>
      <p className="muted small">{L('কর্মীকে জানানো হবে, আর সংশোধনের হিসাব থেকে যাবে।', 'The staff member is told and the correction is logged.')}</p>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </section>
}

/**
 * Riders who hold a route and are on leave / absent: whom does their route go to today?
 * Until a cover is assigned the hub's managers get a reminder every hour (8 am–8 pm).
 */
export function RouteCover({ hub }: { hub: Hub }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const [day, setDay] = useState<'today' | 'yesterday'>('today')
  const date = day === 'today' ? undefined : new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
  const q = useLoad(() => daily.covers(hub.id, date), [hub.id, date])
  const [f, setF] = useState<Record<string, { code: string; note: string }>>({})
  const [up, setUp] = useState<{ id: string; delivered: string; returned: string; note: string } | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const edit = can('ops.route.edit')
  const key = (r: OutRider) => `${r.route_id}:${r.employee_id}`
  async function assign(r: OutRider) {
    const x = f[key(r)]; if (!x?.code.trim()) return setErr(L('যিনি রুট নেবেন তার এমপ্লয়ি আইডি দিন', 'Give the cover’s employee ID'))
    setBusy(true); setErr('')
    try { await daily.assign(r.route_id, r.employee_id, x.code.trim(), x.note, date); setF({ ...f, [key(r)]: { code: '', note: '' } }); await q.reload(); toast(L('রুট এসাইন হয়েছে — উনি নোটিফিকেশন পাবেন', 'Assigned — they are notified')) }
    catch (e) { setErr(dailyFriendly(e)) } finally { setBusy(false) }
  }
  async function saveUpdate() {
    if (!up) return
    const d = Number(up.delivered); if (up.delivered.trim() === '' || !Number.isFinite(d) || d < 0) return setErr(L('কয়টা ডেলিভারি হয়েছে লিখুন', 'Give the delivered count'))
    setBusy(true); setErr('')
    try { await daily.coverUpdate(up.id, d, up.returned.trim() === '' ? null : Number(up.returned), up.note); setUp(null); await q.reload(); toast(L('আপডেট হয়েছে', 'Updated')) }
    catch (e) { setErr(dailyFriendly(e)) } finally { setBusy(false) }
  }
  const rows = q.data ?? []
  const open = rows.filter(r => !r.cover).length
  if (q.error) return <p className="da-error">{dailyFriendly(q.error)}</p>
  return <section className={`panel cover${open ? ' warn' : ''}`}>{node}
    <div className="da-bar"><h2>{L('ছুটিতে / অনুপস্থিত রাইডারের রুট', 'Routes of riders who are out')} {open > 0 && <Badge tone="bad">{L(`${n(open)}টি রুট খালি`, `${open} uncovered`)}</Badge>}</h2>
      <span className="da-seg"><button className={day === 'today' ? 'sm' : 'secondary sm'} onClick={() => setDay('today')}>{L('আজ', 'Today')}</button>
        <button className={day === 'yesterday' ? 'sm' : 'secondary sm'} onClick={() => setDay('yesterday')}>{L('গতকাল', 'Yesterday')}</button></span></div>
    {!q.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : !rows.length ? <p className="muted">{L('রুট আছে এমন সব রাইডার কাজে আছেন।', 'Every rider with a route is working.')}</p> : <>
      <p className="muted small">{L('রুট কাকে দিচ্ছেন এসাইন না করা পর্যন্ত সকাল ৮টা–রাত ৮টা প্রতি ঘণ্টায় মনে করানো হবে। যিনি রুট নিলেন তার ডেলিভারি হিসাব খাতায় উঠলে নিজেই দেখাবে; না উঠলে রাত ১২টার রিপোর্টে "আপডেট নেই" যাবে।',
        'Until a cover is assigned you are reminded every hour (8 am–8 pm). The cover’s deliveries show from the sheet; if missing, the midnight report says "no update".')}</p>
      <div className="cover-rows">{rows.map(r => { const c = r.cover; const x = f[key(r)] ?? { code: '', note: '' }
        const got = c?.sheet?.delivery ?? c?.delivered ?? null
        return <article key={key(r)} className={`cover-row${c ? '' : ' empty'}`}>
          <header><b>{r.route_name}</b><Badge tone={r.reason === 'leave' ? 'info' : 'bad'}>{r.full_name} — {L(OUT_WORD[r.reason][0], OUT_WORD[r.reason][1])}</Badge></header>
          {r.areas.length > 0 && <div className="myday-chips">{r.areas.slice(0, 10).map(a => <span key={a}>{a}</span>)}</div>}
          {c ? <div className="cover-who"><Icon name="user" size={15} /><span><b>{c.name}</b>{c.employee_code ? ` · ${c.employee_code}` : ''} {L('রুট নিয়েছেন', 'covers it')}{c.by ? ` · ${L('এসাইন', 'by')} ${c.by}` : ''}</span>
              {c.phone && <a className="crew-call" href={`tel:${c.phone}`}><Icon name="phone" size={13} />{c.phone}</a>}</div>
            : <p className="bad small"><Icon name="alert" size={14} /> {L('রুট খালি — কাকে দিচ্ছেন?', 'No cover yet — who takes it?')}</p>}
          {c && <div className="cover-del">{got !== null ? <Badge tone="ok">{L(`ডেলিভারি ${n(got)}টি`, `${got} delivered`)}{c.sheet ? L(' (খাতা থেকে)', ' (sheet)') : ''}{c.returned != null ? L(` · ফেরত ${n(c.returned)}`, ` · ${c.returned} returned`) : ''}</Badge>
            : <Badge tone="warn">{L('ডেলিভারির আপডেট এখনো নেই', 'No delivery update yet')}</Badge>}
            {c.update_note && <span className="muted small">{c.update_note}</span>}
            {edit && !c.sheet && <button className="secondary sm" onClick={() => { setErr(''); setUp({ id: c.id, delivered: c.delivered?.toString() ?? '', returned: c.returned?.toString() ?? '', note: c.update_note ?? '' }) }}>{L('আপডেট দিন', 'Update')}</button>}</div>}
          {edit && <div className="cover-assign">
            <input inputMode="numeric" placeholder={c ? L('বদলাতে নতুন আইডি', 'New ID to change') : L('যিনি রুট নেবেন — এমপ্লয়ি আইডি', 'Cover’s employee ID')} value={x.code} onChange={e => setF({ ...f, [key(r)]: { ...x, code: e.target.value } })} />
            <input placeholder={L('নোট (ইচ্ছা হলে)', 'Note (optional)')} value={x.note} onChange={e => setF({ ...f, [key(r)]: { ...x, note: e.target.value } })} />
            <button className={c ? 'secondary sm' : 'sm'} disabled={busy} onClick={() => void assign(r)}>{c ? L('বদলান', 'Change') : L('এসাইন', 'Assign')}</button></div>}
        </article> })}</div></>}
    {err && !up && <p className="da-error">{err}</p>}
    {up && <Modal title={L('ডেলিভারির আপডেট', 'Delivery update')} onClose={() => setUp(null)}
      actions={<><button className="secondary" onClick={() => setUp(null)}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void saveUpdate()}>{L('সেভ', 'Save')}</button></>}>
      <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label={L('ডেলিভারি হয়েছে', 'Delivered')} required><input inputMode="numeric" value={up.delivered} onChange={e => setUp({ ...up, delivered: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label={L('ফেরত', 'Returned')}><input inputMode="numeric" value={up.returned} onChange={e => setUp({ ...up, returned: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label={L('নোট', 'Note')} wide><input value={up.note} onChange={e => setUp({ ...up, note: e.target.value })} /></Field>
      </div>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </section>
}
