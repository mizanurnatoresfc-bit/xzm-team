import { useWorkHubBlocker } from '../../lib/workHub'
import { useAuth } from '../../auth/AuthProvider'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { askConfirm, askReason } from '../../components/ask'
import { Icon } from '../../components/Icon'
import { addDays, todayDhaka } from '../../lib/dailyAccounts'
import { STATE_META, morning, type AttPolicy, type MorningForm, type MorningPerson, type MorningState, type PlanMorning, type PublishedPlan, type TypedState, type ZoneMorning, type ZoneMorningHub } from '../../lib/morning'
import { usePrefs } from '../../lib/prefs'
import { useLiveLoad, wfFriendly } from '../../lib/workforce'
import { Badge, Field, Stat, useLoad, useToast } from '../accounts/ui'
import { Empty, Loading, Section, Who, fmtDay, fmtStamp, fmtTime } from './shared'
import '../../morning.css'

const TYPED: TypedState[] = ['present', 'absent', 'unknown']

export function MorningTab({ hubId }: { hubId: string }) {
  const { L } = usePrefs()
  const { toast, node } = useToast()
  const { data: form, reload, error } = useLoad(() => morning.get(hubId), [hubId])
  const [expired, setExpired] = useState<MorningForm | null>(null)
  const [submitted, setSubmitted] = useState('')
  const formKey = form ? `${form.date}:${form.revision}` : ''
  const clock = form ? Date.parse(form.now) : 0
  const opensAt = form ? Date.parse(form.opens_at) : 0
  const dueAt = form ? Date.parse(form.due) : 0

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void reload() }
    const poll = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [reload])

  useEffect(() => {
    if (!form) return
    const beforeOpen = clock < opensAt
    const boundary = beforeOpen ? opensAt : dueAt
    if (boundary <= clock || !Number.isFinite(boundary - clock)) return
    const timer = window.setTimeout(() => {
      if (!beforeOpen) setExpired(form)
      void reload()
    }, boundary - clock)
    return () => window.clearTimeout(timer)
  }, [form, clock, opensAt, dueAt, reload])

  if (error && !form) return <p className="da-error" role="alert">{wfFriendly(error)}</p>

  const active = form?.can.fill && form.status === 'open' && clock >= opensAt && clock < dueAt &&
    expired !== form && submitted !== formKey
  return <>
    {node}
    {active && <MorningFormCard key={formKey} f={form} onReload={reload} onSubmitted={already => {
      setSubmitted(formKey)
      toast(already ? L('এটি আগেই জমা হয়ে গেছে।', 'Already submitted.') : L('সকালের ইনপুট জমা হয়েছে।', 'Morning input submitted.'))
      void reload()
    }} />}
  </>
}

function MorningFormCard({ f, onReload, onSubmitted }: { f: MorningForm; onReload: () => Promise<void>; onSubmitted: (already: boolean) => void }) {
  const { L, n, lang } = usePrefs()
  const hubId = f.hub.id
  const [marks, setMarks] = useState<Record<string, TypedState>>({})
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState<'' | 'saving' | 'saved' | 'failed'>('')
  const [busy, setBusy] = useState(false)
  const { session } = useAuth()
  useWorkHubBlocker(session?.user.id ?? '', (dirty && saved !== 'saved') || busy)
  const [err, setErr] = useState('')
  const timer = useRef(0)
  const revision = useRef(0)

  // what the server holds is the truth until the manager types something
  useEffect(() => {
    if (!f.people || dirty) return
    setMarks(Object.fromEntries(f.people.filter(p => p.state !== 'leave').map(p => [p.id, p.state as TypedState])))
  }, [f, dirty])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const lines = useMemo(() => Object.entries(marks).map(([employee_id, state]) => ({ employee_id, state })), [marks])
  const people = f.people ?? []
  const stateOf = (p: MorningPerson): MorningState => p.state === 'leave' ? 'leave' : marks[p.id] ?? 'unknown'
  const count = (s: MorningState) => people.filter(p => stateOf(p) === s).length

  function change(next: Record<string, TypedState>) {
    setMarks(next); setDirty(true); setSaved('saving'); window.clearTimeout(timer.current)
    const changeId = ++revision.current
    timer.current = window.setTimeout(() => {
      morning.save(hubId, Object.entries(next).map(([employee_id, state]) => ({ employee_id, state })), f.date)
        .then(() => { if (changeId === revision.current) setSaved('saved') })
        .catch(() => { if (changeId === revision.current) setSaved('failed') })
    }, 700)
  }
  const set = (id: string, s: TypedState) => change({ ...marks, [id]: s })
  const allCame = () => change({ ...marks, ...Object.fromEntries(people.filter(p => p.state !== 'leave').map(p => [p.id, 'present' as TypedState])) })

  async function submit() {
    const left = people.filter(p => stateOf(p) === 'unknown').length
    const sure = await askConfirm(left ? L(`${n(left)} জনের অবস্থা বাকি থাকছে। তবুও জোনে জমা দেবেন?`, `${left} people stay unchecked. Submit to the zone anyway?`) : L('জোনাল ম্যানেজারের কাছে সকালের ইনপুট জমা দেবেন?', 'Submit the morning input to the zonal manager?'),
      { ok: L('জমা দিন', 'Submit'), detail: L('জমার পর এই ফর্ম লক হবে। বন্ধের আগে জোনাল ম্যানেজার ফেরত দিলে সংশোধন করা যাবে।', 'The form locks. The zonal manager can send it back for correction before closing.') })
    if (!sure) return
    window.clearTimeout(timer.current); setBusy(true); setErr('')
    try {
      const r = await morning.submit(hubId, lines, f.date)
      onSubmitted(r.already)
    } catch (e) {
      setErr(wfFriendly(e))
      void onReload()
    } finally { setBusy(false) }
  }

  const due = fmtTime(f.due, lang)

  return <div className="wm">
    <Section title={`${L('রুটের সকালের হাজিরা', 'Morning route attendance')} · ${f.hub.name}`}
      hint={L(`উপস্থিতি যাচাই করে জোনাল ম্যানেজারের কাছে জমা দিন। বাংলাদেশ সময় ${due}-এ ফর্ম বন্ধ হবে।`,
        `Check attendance and submit to the zonal manager. The form closes at ${due} Bangladesh time.`)}
      tools={<button type="button" className="secondary sm" disabled={busy} onClick={allCame}><Icon name="checkall" size={14} />{L('সবাইকে "এসেছে" দিন', 'Mark everyone as came')}</button>}>
      {f.returned && <p className="notice wm-note" role="status"><b>{L('জোনাল ম্যানেজার ফেরত পাঠিয়েছেন', 'Sent back by the zonal manager')}:</b> {f.returned.reason} <span className="muted small">({fmtStamp(f.returned.at, lang)})</span></p>}
      <div className="da-stats">
        <Stat icon="users" label={L('এসেছে', 'Came')} value={n(count('present'))} tone="ok" />
        <Stat icon="alert" label={L('আসেনি', 'Did not come')} value={n(count('absent'))} tone={count('absent') ? 'bad' : undefined} />
        <Stat icon="log" label={L('অনুমোদিত ছুটি', 'On leave')} value={n(count('leave'))} />
        <Stat icon="alert" label={L('যাচাই বাকি', 'Not checked')} value={n(count('unknown'))} tone={count('unknown') ? 'warn' : 'ok'} />
      </div>
      {!people.length ? <Empty>{L('এই হাবে কোনো সক্রিয় কর্মী নেই।', 'This hub has no active staff.')}</Empty> :
        <div className="da-table-wrap"><table className="da-table mo-table">
          <thead><tr><th>{L('কর্মী', 'Person')}</th><th>{L('পদ', 'Position')}</th><th>{L('সকালের অবস্থা', 'Morning state')}</th></tr></thead>
          <tbody>{people.map(p => <tr key={p.id}>
            <td data-label={L('কর্মী', 'Person')}><Who name={p.name} code={p.code} /></td>
            <td data-label={L('পদ', 'Position')}>{p.post ?? '—'}</td>
            <td data-label={L('সকালের অবস্থা', 'Morning state')}>{p.state === 'leave'
              ? <span><Badge tone="info">{L(STATE_META.leave.bn, STATE_META.leave.en)}</Badge> <span className="muted small">{p.leave?.ref}{p.leave?.applied_on ? ` · ${L('আবেদন', 'applied')} ${fmtDay(p.leave.applied_on, lang)}` : ''}</span></span>
              : <select className={`mo-state s-${stateOf(p)}`} value={stateOf(p)} disabled={busy} aria-label={`${p.name} — ${L('সকালের অবস্থা', 'morning state')}`} onChange={e => set(p.id, e.target.value as TypedState)}>
                {TYPED.map(s => <option key={s} value={s}>{L(STATE_META[s].bn, STATE_META[s].en)}</option>)}</select>}</td>
          </tr>)}</tbody></table></div>}
      {err && <p className="da-error" role="alert">{err}</p>}
      <div className="mo-bar">
        <button type="button" disabled={busy || !people.length} onClick={() => void submit()}><Icon name="bell" size={16} />{busy ? L('জমা হচ্ছে…', 'Submitting…') : L('জোনে জমা দিন', 'Submit to the zone')}</button>
        <span className="muted small" role="status">{saved === 'saving' ? L('সেভ হচ্ছে…', 'Saving…') : saved === 'saved' ? L('খসড়া সেভ হয়েছে', 'Draft saved') : saved === 'failed' ? L('সেভ করা যায়নি — আবার চেষ্টা করুন', 'Could not save — try again') : ''}</span>
      </div>
    </Section>
  </div>
}

/** The lines of a submitted morning input — only the zonal side ever gets them. */
function MorningLines({ people }: { people: Array<{ id: string; name: string; code: string | null; post?: string | null; state: MorningState; ref: string | null }> }) {
  const { L } = usePrefs()
  return <div className="da-table-wrap"><table className="da-table mo-table">
    <thead><tr><th>{L('কর্মী', 'Person')}</th><th>{L('সকালের অবস্থা', 'Morning state')}</th></tr></thead>
    <tbody>{people.map(p => <tr key={p.id}><td data-label={L('কর্মী', 'Person')}><Who name={p.name} code={p.code} position={p.post} /></td>
      <td data-label={L('সকালের অবস্থা', 'Morning state')}><Badge tone={STATE_META[p.state].tone}>{L(STATE_META[p.state].bn, STATE_META[p.state].en)}</Badge>{p.ref ? <span className="muted small"> {p.ref}</span> : null}</td></tr>)}</tbody></table></div>
}

// ====================================================================================== জোনের সকাল
export function ZoneMorningTab({ zone }: { zone: string }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const nav = useNavigate()
  const today = todayDhaka()
  const [date, setDate] = useState(today)
  const q = useLiveLoad<ZoneMorning>(() => morning.zone(zone || null, date), [zone, date])
  const d = q.data && q.data.date === date ? q.data : null
  const [open, setOpen] = useState<string>('')
  const days = [today, addDays(today, -1), addDays(today, -2)]

  async function sendBack(h: ZoneMorningHub) {
    const why = await askReason(L(`${h.name}-এর সকালের ইনপুট কেন ফেরত পাঠাচ্ছেন?`, `Why do you send back the morning input of ${h.name}?`))
    if (!why) return
    try { const rev = await morning.sendBack(h.id, why, date); toast(L(`ফেরত গেছে — সংস্করণ ${n(rev)} খুলেছে।`, `Sent back — revision ${rev} opened.`)); await q.reload() }
    catch (e) { toast(wfFriendly(e)) }
  }
  const hubs = d?.hubs ?? []
  const submitted = hubs.filter(h => h.state === 'submitted')
  const total = (k: 'absent' | 'unknown') => submitted.reduce((t, h) => t + h[k], 0)
  const cover = submitted.reduce((t, h) => t + (h.cover?.length ?? 0), 0)

  return <>
    {node}
    <Section title={L('জোনের সকাল', 'The zone’s morning')}
      hint={L('হাবের জমা, আসেনি, যাচাই বাকি এবং কভার লাগা রুট। এখান থেকেই রুট প্ল্যান খুলে ব্যাকআপ বসান। ইনপুট ঠিক না হলে কারণসহ ফেরত দিন।', 'Each hub’s submission, who did not come, what is unchecked and the routes that need cover. Open the route plan from here, or send an input back with a reason.')}
      tools={<Field label={L('দিন', 'Day')}><select value={date} onChange={e => setDate(e.target.value)}>{days.map(x => <option key={x} value={x}>{fmtDay(x, lang)}{x === today ? ` (${L('আজ', 'today')})` : ''}</option>)}</select></Field>}>
      {q.error && !d ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
      {!d && !q.error ? <Loading /> : null}
      {d && <div className={q.loading ? 'wm-stale' : ''}>
        <div className="da-stats">
          <Stat icon="hub" label={L('হাব জমা দিয়েছে', 'Hubs submitted')} value={`${n(submitted.length)}/${n(hubs.length)}`} tone={submitted.length < hubs.length ? 'warn' : 'ok'} />
          <Stat icon="alert" label={L('আসেনি', 'Did not come')} value={n(total('absent'))} tone={total('absent') ? 'bad' : undefined} />
          <Stat icon="alert" label={L('যাচাই বাকি', 'Not checked')} value={n(total('unknown'))} tone={total('unknown') ? 'warn' : undefined} />
          <Stat icon="map" label={L('কভার লাগা রুট', 'Routes needing cover')} value={n(cover)} tone={cover ? 'bad' : undefined} />
        </div>
        {!hubs.length && <Empty>{L('দেখার মতো কোনো হাব নেই।', 'No hub to show.')}</Empty>}
        <div className="mo-hubs">{hubs.map(h => <article key={h.id} className="mo-hub panel">
          <header><h3>{h.name}</h3>
            {h.held ? <Badge tone="bad">{h.hold?.reason === 'empty' ? L('জমা আটকে — কিছুই লেখা হয়নি', 'Held — nothing written') : L(`জমা আটকে — ${n(h.hold?.gap_count ?? 0)} জন বাকি`, `Held — ${h.hold?.gap_count ?? 0} not marked`)}</Badge>
              : h.state === 'submitted' ? <Badge tone="ok">{h.mode === 'auto' ? L('অটো জমা', 'Auto-submitted') : L('জমা দিয়েছে', 'Submitted')} · {fmtTime(h.submitted_at!, lang)}{(h.revision ?? 1) > 1 ? ` · ${L('সংস্করণ', 'rev')} ${n(h.revision!)}` : ''}</Badge>
              : !h.window_open && Date.parse(d.now) >= Date.parse(h.due) ? <Badge tone="bad">{L('সময় শেষ · জমা হয়নি', 'Closed without submission')}</Badge>
              : h.state === 'open' ? <Badge tone="warn">{h.returned ? L('ফেরত — সংশোধন চলছে', 'Sent back — being corrected') : L('লেখা চলছে', 'Being typed')}</Badge>
              : <Badge tone="bad">{L('শুরু হয়নি', 'Not started')}</Badge>}</header>
          {h.state !== 'submitted' && <p className="muted small">{L(`${n(h.staff)} জন কর্মী · বন্ধ ${fmtTime(h.due, lang)}-এ`, `${h.staff} staff · closes at ${fmtTime(h.due, lang)}`)}{h.returned?.reason ? ` · ${L('কারণ', 'Reason')}: ${h.returned.reason}` : ''}</p>}
          {h.state === 'submitted' && <>
            <div className="mo-counts"><span className="ok">{L('এসেছে', 'Came')} <b>{n(h.present)}</b></span><span className="bad">{L('আসেনি', 'Not came')} <b>{n(h.absent)}</b></span>
              <span>{L('ছুটি', 'Leave')} <b>{n(h.leave)}</b></span><span className="warn">{L('যাচাই বাকি', 'Unchecked')} <b>{n(h.unknown)}</b></span></div>
            {h.cover && h.cover.length > 0 && <div className="mo-cover" role="status"><b><Icon name="map" size={14} /> {L('কভার লাগা রুট', 'Routes needing cover')}</b>
              <ul>{h.cover.map(c => <li key={c.id}>{c.code} · {c.name}{c.regular.length ? <span className="muted small"> — {L('মূল', 'regular')}: {c.regular.join(', ')}</span> : <span className="muted small"> — {L('কোনো রাইডার নেই', 'no rider')}</span>}</li>)}</ul></div>}
            {h.people && <details open={open === h.id} onToggle={e => setOpen((e.target as HTMLDetailsElement).open ? h.id : '')}><summary className="muted small">{L('কে কী অবস্থায়', 'Who is in which state')}</summary>
              {open === h.id && <MorningLines people={h.people.map(p => ({ id: p.id, name: p.name, code: p.code, state: p.state, ref: p.leave_ref }))} />}</details>}
          </>}
          <div className="mo-acts">
            <button type="button" className="secondary sm" onClick={() => nav(`/app/routes?tab=plan&hub=${h.id}`)}><Icon name="map" size={14} />{L('রুট প্ল্যান খুলুন', 'Open the route plan')}</button>
            {h.state === 'submitted' && h.window_open && <button type="button" className="secondary sm" onClick={() => void sendBack(h)}><Icon name="back" size={14} />{L('সংশোধনের জন্য ফেরত', 'Send back')}</button>}
            {h.plan && <Badge tone={h.plan.status === 'approved' ? 'ok' : h.plan.status === 'sent' ? 'warn' : 'info'}>{h.plan.status === 'approved' ? `${L('রুট প্ল্যান প্রকাশিত', 'Plan published')} · ${L('সংস্করণ', 'v')}${n(h.plan.published_version)}` : h.plan.status === 'sent' ? L('প্ল্যান অনুমোদনের অপেক্ষায়', 'Plan waiting for approval') : L('প্ল্যান খসড়া', 'Plan draft')}</Badge>}
          </div>
        </article>)}</div>
      </div>}
    </Section>
  </>
}

// ====================================================================================== সময় সেটিং
export function MorningPolicy({ zone, register = false }: { zone: string; register?: boolean }) {
  const { L } = usePrefs()
  const { toast, node } = useToast()
  const q = useLoad<AttPolicy | null>(() => zone ? morning.policy(zone) : Promise.resolve(null), [zone])
  const p = q.data
  const [open, setOpen] = useState('')
  const [close, setClose] = useState('')
  const [day, setDay] = useState('')
  const [dayExtra, setDayExtra] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!p) return
    setOpen(p.morning_open)
    const [hour, minute] = p.morning_cutoff.split(':').map(Number)
    const total = hour * 60 + minute + p.morning_extra
    setClose(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`)
    setDay(p.day_time)
    setDayExtra(String(p.day_extra))
  }, [p])
  if (!zone) return null
  if (q.error) return <p className="da-error" role="alert">{wfFriendly(q.error)}</p>
  if (!p) return <Loading />
  async function save() {
    setBusy(true)
    try {
      await morning.savePolicy(zone, register ? { day_time: day, day_extra: Number(dayExtra) }
        : { morning_open: open, morning_cutoff: close, morning_extra: 0 })
      toast(L('সময় সেভ হয়েছে।', 'Times saved.'))
      await q.reload()
    } catch (e) { toast(wfFriendly(e)) }
    finally { setBusy(false) }
  }
  const disabled = !p.can_edit || busy
  return <Section title={register ? L('দৈনিক খাতার সময়', 'Daily register times') : L('রুটের সকালের হাজিরার সময়', 'Morning route attendance hours')}
    hint={register ? L('সম্পূর্ণ দৈনিক খাতা পরদিন নির্ধারিত সময়ে স্বয়ংক্রিয়ভাবে জমা হয়।', 'Complete daily registers submit automatically at the scheduled time the next day.')
      : L('এই জোনের প্রতিটি হাবে প্রতিদিন বাংলাদেশ সময় অনুযায়ী ফর্ম খুলবে ও বন্ধ হবে।', 'The form opens and closes daily in Bangladesh time for every hub in this zone.')}>
    {node}
    <div className="hr-form">
      {register ? <>
        <Field label={L('পরদিন দৈনিক খাতা বন্ধের সময়', 'Daily register closes (next day)')}><input type="time" value={day} disabled={disabled} onChange={e => setDay(e.target.value)} /></Field>
        <Field label={L('খাতায় অতিরিক্ত মিনিট (০–৩৬০)', 'Register extra minutes (0–360)')}><input type="number" min={0} max={360} value={dayExtra} disabled={disabled} onChange={e => setDayExtra(e.target.value)} /></Field>
      </> : <>
        <Field label={L('খোলার সময়', 'Opening time')}><input type="time" value={open} disabled={disabled} onChange={e => setOpen(e.target.value)} /></Field>
        <Field label={L('বন্ধের সময়', 'Closing time')}><input type="time" value={close} disabled={disabled} onChange={e => setClose(e.target.value)} /></Field>
      </>}
    </div>
    {p.can_edit && <p><button type="button" disabled={disabled || (register ? !day : !open || !close || open >= close)} onClick={() => void save()}>{L('সময় সেভ করুন', 'Save the times')}</button></p>}
  </Section>
}

// ====================================================================================== পাওয়া রুট প্ল্যান
/** Hub manager (and zone): the route plan that was published — version, who got it, who was taken off, and the history. */
export function PublishedPlanTab({ hubId, canResend }: { hubId: string; canResend: boolean }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const date = todayDhaka()
  const q = useLiveLoad<PublishedPlan>(() => morning.published(hubId, date), [hubId, date], ['route_day_plans'])
  const d = q.data && q.data.date === date ? q.data : null
  const [busy, setBusy] = useState(false)
  if (q.error && !d) return <p className="da-error" role="alert">{wfFriendly(q.error)}</p>
  if (!d) return <Loading />
  if (!d.version) return <Section title={L('পাওয়া রুট প্ল্যান', 'Route plan received')}><Empty>{L('জোনাল অনুমোদনের অপেক্ষায় — অনুমোদিত হলে এখানে আসবে।', 'Waiting for the zonal manager’s approval — it appears here once approved.')}</Empty></Section>
  async function resend() {
    if (!d?.plan_id) return
    setBusy(true)
    try { const c = await morning.resend(d.plan_id); toast(L(`একই সংস্করণ ${n(c)} জনকে আবার পাঠানো হয়েছে।`, `The same version was sent again to ${c} people.`)); await q.reload() }
    catch (e) { toast(wfFriendly(e)) } finally { setBusy(false) }
  }
  const kind = (k: string) => ({ published: ['প্রকাশিত', 'Published'], resent: ['আবার পাঠানো', 'Sent again'], cancelled: ['বরাদ্দ বাতিল', 'Assignment cancelled'], morning_returned: ['সকালের ইনপুট ফেরত', 'Morning input sent back'], morning_changed: ['সকালের ইনপুট বদলেছে', 'Morning input changed'] } as Record<string, [string, string]>)[k] ?? [k, k]
  return <>
    {node}
    <Section title={`${L('পাওয়া রুট প্ল্যান', 'Route plan received')} — ${L('সংস্করণ', 'version')} ${n(d.version.no)}`}
      hint={L(`${fmtStamp(d.version.published_at, lang)}-এ ${d.version.by ?? 'জোনাল ম্যানেজার'} অনুমোদন করেছেন। রাইডারকে রুট নিতে বা বার্তা পড়তে হয় না — বরাদ্দ সরাসরি কার্যকর।`,
        `Approved ${fmtStamp(d.version.published_at, lang)} by ${d.version.by ?? 'the zonal manager'}. A rider does not have to accept or read anything — it is in force.`)}
      tools={canResend ? <button type="button" className="secondary sm" disabled={busy} onClick={() => void resend()}><Icon name="bell" size={14} />{L('অনুমোদিত প্ল্যান আবার পাঠান', 'Send the approved plan again')}</button> : null}>
      {d.reopened && <p className="notice wm-note" role="status">{L('প্ল্যানটি বদলানো হচ্ছে। নতুন সংস্করণ অনুমোদিত না হওয়া পর্যন্ত এই সংস্করণই কার্যকর।', 'The plan is being changed. This version stays in force until a new one is approved.')}</p>}
      <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>{L('রাইডার', 'Rider')}</th><th>{L('রুট', 'Routes')}</th><th>{L('পার্সেল', 'Parcels')}</th><th>{L('পিকআপ', 'Pickups')}</th><th>{L('পাঠানো', 'Sent')}</th></tr></thead>
        <tbody>{(d.lines ?? []).map(r => <tr key={r.employee_id}><td data-label={L('রাইডার', 'Rider')}><b>{r.name}</b>{r.role === 'helper' && <span className="muted small"> · {L('সহায়ক', 'helper')}</span>}</td>
          <td data-label={L('রুট', 'Routes')}>{r.routes.length ? [...new Set(r.routes)].join(', ') : '—'}</td><td data-label={L('পার্সেল', 'Parcels')}>{n(r.parcels)}</td>
          <td data-label={L('পিকআপ', 'Pickups')}>{n(r.pickups)}</td><td data-label={L('পাঠানো', 'Sent')}>{r.sent_count ? `${n(r.sent_count)}× · ${fmtTime(r.last_sent_at!, lang)}` : '—'}</td></tr>)}</tbody></table></div>
      {(d.cancelled ?? []).length > 0 && <p className="mo-cancel"><Icon name="alert" size={14} /> {L('বাদ পড়েছেন', 'Taken off')}: {(d.cancelled ?? []).map(c => `${c.name} (${L('সংস্করণ', 'v')}${n(c.in_version)})`).join(', ')}</p>}
    </Section>
    <Section title={L('প্রকাশের ইতিহাস', 'Publication history')}>
      {(d.history ?? []).length === 0 ? <Empty>{L('কিছু নেই।', 'Nothing yet.')}</Empty> : <ul className="mo-history">{(d.history ?? []).map((h, i) => <li key={i}><b>{L(...kind(h.kind) as [string, string])}</b>{h.version ? ` · ${L('সংস্করণ', 'v')}${n(h.version)}` : ''}{h.note ? ` — ${h.note}` : ''}
        <span className="muted small"> · {h.by ?? '—'} · {fmtStamp(h.at, lang)}</span></li>)}</ul>}
    </Section>
  </>
}

// ====================================================================================== রুট প্ল্যান পাতার ব্যানার
/** On the route plan page: is there a morning input, is the plan made on the latest one, and (for approvers) send the published plan again. */
export function MorningBanner({ hub, date, canResend, planId, onChanged }: { hub: string; date: string; canResend: boolean; planId?: string | null; onChanged?: () => void }) {
  const { L, n, lang } = usePrefs()
  const q = useLiveLoad<PlanMorning>(() => morning.planMorning(hub, date), [hub, date])
  const m = q.data
  const [busy, setBusy] = useState(false); const [done, setDone] = useState('')
  if (!m || !m.required) return null
  async function resend() {
    if (!planId) return
    setBusy(true)
    try { const c = await morning.resend(planId); setDone(L(`একই সংস্করণ ${n(c)} জনকে আবার পাঠানো হয়েছে।`, `The same version was sent again to ${c} people.`)); onChanged?.() }
    catch (e) { setDone(wfFriendly(e)) } finally { setBusy(false) }
  }
  if (m.waiting) return <p className="notice wm-note mo-banner" role="status"><Icon name="alert" size={16} /> {m.returned ? L('সকালের ইনপুট সংশোধনের জন্য হাবে ফেরত আছে — আবার জমা না হওয়া পর্যন্ত অনুমোদন হবে না।', 'The morning input is back with the hub — nothing can be approved until it is submitted again.')
    : L('এই হাবের সকালের ইনপুট এখনো জমা হয়নি — জমা না হলে আজকের প্ল্যান অনুমোদন হবে না।', 'The hub’s morning input is not submitted yet — today’s plan cannot be approved until it is.')}</p>
  return <div className="mo-banner panel" role="status">
    <p><Icon name="users" size={16} /> {L(`সকালের ইনপুট (সংস্করণ ${n(m.morning!.revision)}, ${fmtTime(m.morning!.submitted_at, lang)}): এসেছে ${n(m.morning!.present)}, আসেনি ${n(m.morning!.absent)}, ছুটি ${n(m.morning!.leave)}, যাচাই বাকি ${n(m.morning!.unknown)}`,
      `Morning input (rev ${m.morning!.revision}, ${fmtTime(m.morning!.submitted_at, lang)}): came ${m.morning!.present}, not ${m.morning!.absent}, leave ${m.morning!.leave}, unchecked ${m.morning!.unknown}`)}</p>
    {m.plan_stale && <p className="da-error">{L('এই প্ল্যান সকালের ইনপুটের আগের সংস্করণে বানানো — রাইডারের উপস্থিতি আবার মিলিয়ে নিন (সেভ করলে নতুন সংস্করণ ধরা হবে)।', 'This plan was made on an older morning input — check each rider again (saving picks up the latest).')}</p>}
    {m.published_stale && <p className="notice wm-note">{L('প্রকাশিত প্ল্যানের পর সকালের ইনপুট বদলেছে। প্রকাশিত প্ল্যান কার্যকর আছে; দরকার হলে "আবার খুলুন" দিয়ে রাইডার বদলে নতুন সংস্করণ অনুমোদন করুন।', 'The morning input changed after the plan was published. The published plan stays in force; reopen it to change a rider and approve a new version.')}</p>}
    {canResend && planId && <p><button type="button" className="secondary sm" disabled={busy} onClick={() => void resend()}><Icon name="bell" size={14} />{L('অনুমোদিত প্ল্যান আবার পাঠান', 'Send the approved plan again')}</button>{done && <span className="muted small"> {done}</span>}</p>}
  </div>
}
