import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { askConfirm, askReason } from '../../components/ask'
import { Icon } from '../../components/Icon'
import { addDays, todayDhaka } from '../../lib/dailyAccounts'
import { STATE_META, morning, type AttPolicy, type MorningForm, type MorningPerson, type MorningState, type PlanMorning, type PublishedPlan, type TypedState, type ZoneMorning, type ZoneMorningHub } from '../../lib/morning'
import { usePrefs } from '../../lib/prefs'
import { useLiveLoad, wfFriendly } from '../../lib/workforce'
import { Badge, Field, Stat, useLoad, useToast } from '../accounts/ui'
import { Empty, Loading, Section, Who, fmtDay, fmtLong, fmtStamp, fmtTime } from './shared'
import '../../morning.css'

/**
 * সকালের জনবল — step one of the day. The hub manager says who came, who did not and who is still unchecked, and submits it to the
 * zonal manager. Approved leave sits in by itself. At the cut-off the server submits whatever is typed (blank rows stay unchecked).
 * After the submit the hub manager sees a receipt only; the lines are for the zonal manager, who may send the form back with a reason.
 * Every rule is in the database (wf_morning_*); this page only shows and calls it.
 */
const TYPED: TypedState[] = ['present', 'absent', 'unknown']

export function MorningTab({ hubId }: { hubId: string }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const q = useLiveLoad<MorningForm>(() => morning.get(hubId), [hubId])
  const f = q.data && q.data.hub.id === hubId ? q.data : null
  const [marks, setMarks] = useState<Record<string, TypedState>>({})
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState<'' | 'saving' | 'saved' | 'failed'>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const timer = useRef(0)

  // what the server holds is the truth until the manager types something
  useEffect(() => {
    if (!f?.people || dirty) return
    setMarks(Object.fromEntries(f.people.filter(p => p.state !== 'leave').map(p => [p.id, p.state as TypedState])))
  }, [f, dirty])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const lines = useMemo(() => Object.entries(marks).map(([employee_id, state]) => ({ employee_id, state })), [marks])
  const people = f?.people ?? []
  const stateOf = (p: MorningPerson): MorningState => p.state === 'leave' ? 'leave' : marks[p.id] ?? 'unknown'
  const count = (s: MorningState) => people.filter(p => stateOf(p) === s).length

  function change(next: Record<string, TypedState>) {
    setMarks(next); setDirty(true); setSaved('saving'); window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      morning.save(hubId, Object.entries(next).map(([employee_id, state]) => ({ employee_id, state })))
        .then(() => setSaved('saved')).catch(() => setSaved('failed'))
    }, 700)
  }
  const set = (id: string, s: TypedState) => change({ ...marks, [id]: s })
  const allCame = () => change({ ...marks, ...Object.fromEntries(people.filter(p => p.state !== 'leave').map(p => [p.id, 'present' as TypedState])) })

  async function submit() {
    const left = people.filter(p => stateOf(p) === 'unknown').length
    const sure = await askConfirm(left ? L(`${n(left)} জনের অবস্থা বাকি থাকছে। তবুও জোনে জমা দেবেন?`, `${left} people stay unchecked. Submit to the zone anyway?`) : L('জোনাল ম্যানেজারের কাছে সকালের ইনপুট জমা দেবেন?', 'Submit the morning input to the zonal manager?'),
      { ok: L('জমা দিন', 'Submit'), detail: L('জমার পর এই ফর্ম লক হবে। জোনাল ম্যানেজার ফেরত না দিলে বদলানো যাবে না।', 'The form locks. It can only change if the zonal manager sends it back.') })
    if (!sure) return
    window.clearTimeout(timer.current); setBusy(true); setErr('')
    try { const r = await morning.submit(hubId, lines); setDirty(false); toast(r.already ? L('এটি আগেই জমা হয়ে গেছে।', 'Already submitted.') : L('সকালের ইনপুট জমা হয়েছে।', 'Morning input submitted.')); await q.reload() }
    catch (e) { setErr(wfFriendly(e)) } finally { setBusy(false) }
  }

  if (q.error && !f) return <p className="da-error" role="alert">{wfFriendly(q.error)}</p>
  if (!f) return <Loading />
  const due = fmtTime(f.due, lang)

  // after the submit: a receipt (and, for the zone, the lines)
  if (f.status === 'submitted' && f.receipt) return <>
    {node}
    <Section title={L('সকালের ইনপুট জমা হয়েছে', 'Morning input submitted')}>
      <div className="mo-receipt" role="status">
        <Icon name="checkall" size={22} />
        <div><b>{fmtLong(f.date, lang)}</b>
          <p className="muted small">{f.receipt.mode === 'auto' ? L(`কাট-অফ সময় পেরোনোয় সার্ভার নিজে জমা দিয়েছে (${fmtStamp(f.receipt.submitted_at, lang)})`, `Submitted by the server at the cut-off (${fmtStamp(f.receipt.submitted_at, lang)})`)
            : L(`${f.receipt.submitted_by_name ?? 'ম্যানেজার'} জমা দিয়েছেন (${fmtStamp(f.receipt.submitted_at, lang)})`, `Submitted by ${f.receipt.submitted_by_name ?? 'the manager'} (${fmtStamp(f.receipt.submitted_at, lang)})`)}
            {f.receipt.revision > 1 && ` · ${L('সংস্করণ', 'Revision')} ${n(f.receipt.revision)}`}</p></div>
      </div>
      <p className="muted small">{L('ফর্ম এখন লক। জোনাল ম্যানেজার কারণসহ ফেরত দিলে এখানে আবার খুলবে।', 'The form is locked. It opens here again if the zonal manager sends it back with a reason.')}</p>
      {f.can.review && f.people && <MorningLines people={f.people.map(p => ({ id: p.id, name: p.name, code: p.code, post: p.post, state: p.state, ref: p.leave?.ref ?? null }))} />}
    </Section>
  </>

  return <>
    {node}
    <Section title={`${L('সকালের জনবল', 'Morning input')} — ${fmtLong(f.date, lang)}`}
      hint={L(`কে এসেছে, কে আসেনি, কার তথ্য এখনও যাচাই বাকি — বেছে জোনাল ম্যানেজারের কাছে জমা দিন। ${due}-এর পর সবার অবস্থা বসানো থাকলে সার্ভার নিজে জমা করবে; খালি বা অসম্পূর্ণ থাকলে ফর্ম খোলা থাকবে এবং আপনাকে ও জোনাল ম্যানেজারকে জানানো হবে।`,
        `Say who came, who did not and who is still unchecked, then submit to the zonal manager. After ${due} the server submits it only when everybody has an answer; if it is empty or unfinished it stays open and you and the zonal manager are told.`)}
      tools={f.can.fill ? <button type="button" className="secondary sm" onClick={allCame}><Icon name="checkall" size={14} />{L('সবাইকে "এসেছে" দিন', 'Mark everyone as came')}</button> : null}>
      {f.hold && <p className="da-error" role="alert"><Icon name="alert" size={16} /> <b>{L('সার্ভার সকালের ইনপুট জমা দেয়নি', 'The server did not submit the morning input')}</b> — {f.hold.reason === 'empty' ? L('কিছুই লেখা হয়নি।', 'nothing was written.') : L(`${n(f.hold.gap_count)} জনের অবস্থা বসানো হয়নি`, `${f.hold.gap_count} people are not marked`)}. {L('সবার অবস্থা বসিয়ে জমা দিন। হাব ও জোনাল ম্যানেজারকে জানানো হয়েছে।', 'Mark everybody and submit. The hub and zonal managers were told.')}</p>}
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
              : <select className={`mo-state s-${stateOf(p)}`} value={stateOf(p)} disabled={!f.can.fill || busy} aria-label={`${p.name} — ${L('সকালের অবস্থা', 'morning state')}`} onChange={e => set(p.id, e.target.value as TypedState)}>
                {TYPED.map(s => <option key={s} value={s}>{L(STATE_META[s].bn, STATE_META[s].en)}</option>)}</select>}</td>
          </tr>)}</tbody></table></div>}
      {err && <p className="da-error" role="alert">{err}</p>}
      {f.can.fill && <div className="mo-bar">
        <button type="button" disabled={busy || !people.length} onClick={() => void submit()}><Icon name="bell" size={16} />{busy ? L('জমা হচ্ছে…', 'Submitting…') : L('জোনে জমা দিন', 'Submit to the zone')}</button>
        <span className="muted small" role="status">{saved === 'saving' ? L('সেভ হচ্ছে…', 'Saving…') : saved === 'saved' ? L('খসড়া সেভ হয়েছে', 'Draft saved') : saved === 'failed' ? L('সেভ করা যায়নি — আবার চেষ্টা করুন', 'Could not save — try again') : ''}</span>
      </div>}
    </Section>
  </>
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
              : h.state === 'open' ? <Badge tone="warn">{h.returned ? L('ফেরত — সংশোধন চলছে', 'Sent back — being corrected') : L('লেখা চলছে', 'Being typed')}</Badge>
              : <Badge tone="bad">{L('শুরু হয়নি', 'Not started')}</Badge>}</header>
          {h.state !== 'submitted' && <p className="muted small">{L(`${n(h.staff)} জন কর্মী · অটো জমা ${fmtTime(h.due, lang)}-এ`, `${h.staff} staff · auto-submit at ${fmtTime(h.due, lang)}`)}{h.returned?.reason ? ` · ${L('কারণ', 'Reason')}: ${h.returned.reason}` : ''}</p>}
          {h.state === 'submitted' && <>
            <div className="mo-counts"><span className="ok">{L('এসেছে', 'Came')} <b>{n(h.present)}</b></span><span className="bad">{L('আসেনি', 'Not came')} <b>{n(h.absent)}</b></span>
              <span>{L('ছুটি', 'Leave')} <b>{n(h.leave)}</b></span><span className="warn">{L('যাচাই বাকি', 'Unchecked')} <b>{n(h.unknown)}</b></span></div>
            {h.cover && h.cover.length > 0 && <div className="mo-cover" role="status"><b><Icon name="map" size={14} /> {L('কভার লাগা রুট', 'Routes needing cover')}</b>
              <ul>{h.cover.map(c => <li key={c.id}>{c.code} · {c.name}{c.regular.length ? <span className="muted small"> — {L('মূল', 'regular')}: {c.regular.join(', ')}</span> : <span className="muted small"> — {L('কোনো রাইডার নেই', 'no rider')}</span>}</li>)}</ul></div>}
            {h.people && <details open={open === h.id} onToggle={e => setOpen((e.target as HTMLDetailsElement).open ? h.id : '')}><summary className="muted small">{L('কে কী অবস্থায়', 'Who is in which state')}</summary>
              {open === h.id && <MorningLines people={h.people.map(p => ({ id: p.id, name: p.name, code: p.code, state: p.state, ref: p.leave_ref }))} />}</details>}
          </>}
          <div className="mo-acts">
            <button type="button" className="secondary sm" onClick={() => nav(`/app/routes/plan?hub=${h.id}`)}><Icon name="map" size={14} />{L('রুট প্ল্যান খুলুন', 'Open the route plan')}</button>
            {h.state === 'submitted' && <button type="button" className="secondary sm" onClick={() => void sendBack(h)}><Icon name="back" size={14} />{L('সংশোধনের জন্য ফেরত', 'Send back')}</button>}
            {h.plan && <Badge tone={h.plan.status === 'approved' ? 'ok' : h.plan.status === 'sent' ? 'warn' : 'info'}>{h.plan.status === 'approved' ? `${L('রুট প্ল্যান প্রকাশিত', 'Plan published')} · ${L('সংস্করণ', 'v')}${n(h.plan.published_version)}` : h.plan.status === 'sent' ? L('প্ল্যান অনুমোদনের অপেক্ষায়', 'Plan waiting for approval') : L('প্ল্যান খসড়া', 'Plan draft')}</Badge>}
          </div>
        </article>)}</div>
      </div>}
    </Section>
  </>
}

// ====================================================================================== সময় সেটিং
/** Zone setting: the morning cut-off and the extra minutes (the day-close time is kept beside it for the daily register). */
export function MorningPolicy({ zone }: { zone: string }) {
  const { L, lang } = usePrefs()
  const { toast, node } = useToast()
  const q = useLoad<AttPolicy | null>(() => zone ? morning.policy(zone) : Promise.resolve(null), [zone])
  const p = q.data
  const [cut, setCut] = useState(''); const [extra, setExtra] = useState(''); const [day, setDay] = useState(''); const [dayExtra, setDayExtra] = useState('')
  useEffect(() => { if (p) { setCut(p.morning_cutoff); setExtra(String(p.morning_extra)); setDay(p.day_time); setDayExtra(String(p.day_extra)) } }, [p])
  if (!zone) return <Section title={L('সকালের ইনপুটের সময়', 'Morning input time')}><Empty>{L('উপরে একটি জোন বেছে নিন।', 'Pick a zone above.')}</Empty></Section>
  if (q.error) return <p className="da-error" role="alert">{wfFriendly(q.error)}</p>
  if (!p) return <Loading />
  async function save() {
    try { await morning.savePolicy(zone, { morning_cutoff: cut, morning_extra: Number(extra), day_time: day, day_extra: Number(dayExtra) }); toast(L('সময় সেভ হয়েছে।', 'Times saved.')); await q.reload() }
    catch (e) { toast(wfFriendly(e)) }
  }
  return <Section title={L('অটো সাবমিটের সময়', 'Auto-submit times')}
    hint={L(`সকালের ইনপুট কাট-অফ ও অতিরিক্ত মিনিটের পর, আর ঢাকার তারিখ বদলালে দৈনিক খাতা পরদিনের নির্ধারিত সময়ের পর সার্ভার নিজে জমা করে (ঢাকার সময়) — শুধু যদি প্রতিজনের অবস্থা বসানো থাকে; খালি বা অসম্পূর্ণ হলে খোলা রাখে এবং হাব ও জোনাল ম্যানেজারকে জানায়। আজকের সকালের অটো জমা: ${fmtTime(p.today_due, lang)}।`,
      `The server submits the morning input after the cut-off plus the extra minutes, and a daily register after the set time of the next day (Dhaka time) — only when everybody has an answer; an empty or unfinished one stays open and the hub and zonal managers are told. Today’s morning: ${fmtTime(p.today_due, lang)}.`)}>
    {node}
    <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
      <Field label={L('সকালের কাট-অফ', 'Morning cut-off')}><input type="time" value={cut} disabled={!p.can_edit} onChange={e => setCut(e.target.value)} /></Field>
      <Field label={L('অতিরিক্ত মিনিট (০–৩৬০)', 'Extra minutes (0–360)')}><input type="number" min={0} max={360} value={extra} disabled={!p.can_edit} onChange={e => setExtra(e.target.value)} /></Field>
      <Field label={L('পরদিন দৈনিক খাতা বন্ধের সময়', 'Daily register closes (next day)')}><input type="time" value={day} disabled={!p.can_edit} onChange={e => setDay(e.target.value)} /></Field>
      <Field label={L('খাতায় অতিরিক্ত মিনিট (০–৩৬০)', 'Register extra minutes (0–360)')}><input type="number" min={0} max={360} value={dayExtra} disabled={!p.can_edit} onChange={e => setDayExtra(e.target.value)} /></Field>
    </div>
    {p.can_edit ? <p><button type="button" onClick={() => void save()}>{L('সময় সেভ করুন', 'Save the times')}</button></p> : <p className="muted small">{L('সময় বদলানোর অনুমতি আপনার নেই।', 'You may not change the times.')}</p>}
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
