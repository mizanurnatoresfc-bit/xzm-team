import { useWorkHubBlocker } from '../../lib/workHub'
import { useAuth } from '../../auth/AuthProvider'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { FINAL_OPTIONS, LIVE_MONTH, LIVE_SHEET, REASON_META, att, isPresentLike, lineProblem,
  type DaySheet, type FinalStatus, type LineInput, type LineValue, type MonthCell, type MonthRegister, type MonthSheet, type SheetPerson, type VersionLines } from '../../lib/attSheet'
import { addDays, todayDhaka } from '../../lib/dailyAccounts'
import { usePrefs } from '../../lib/prefs'
import { announceWfChange, monthOf, useLiveLoad, wfFriendly, type IsoDate } from '../../lib/workforce'
import { Badge, Field, Modal, Stat, useToast } from '../accounts/ui'
import { askReason } from '../../components/ask'
import { Empty, KindBadge, Loading, NoteDialog, Notice, Section, Who, exportRows, fmtDay, fmtLong, fmtStamp, fmtTime, fmtWeekday, lastMonths, monthName } from './shared'
import '../../att-sheet.css'

/**
 * দৈনিক ফাইনাল হাজিরা খাতা — one register per hub per day, kept by the hub manager.
 * What a staff member gave is filled in; the manager answers yes / no, sets the final status and what goes with it, and
 * submits. Submitted = locked; only the zonal manager unlocks. The zonal manager also sends it to the hub's managers,
 * who mark it ঠিক আছে here. Every rule is checked again in the database (att_sheet_* functions).
 */
const EMPTY: LineValue = { manager_ok: null, final_status: null, late_time: null, online_marked: null, online_reason: null,
  absence_app_date: null, absence_app_ref: null, unauthorized: false, note: null, online_at: null, absence_reason: null, leave_ref: null, leave_applied_on: null, leave_pending: null }

const STATUS_EXTRA: Record<string, [string, string]> = { pending_leave: ['ছুটির আবেদন বিচারাধীন', 'Leave request waiting'], unchecked: ['যাচাই বাকি', 'Not checked'] }
const statusLabel = (st: FinalStatus | null, lang: 'bn' | 'en') => {
  if (!st) return '—'
  const x = STATUS_EXTRA[st]; if (x) return lang === 'bn' ? x[0] : x[1]
  const o = FINAL_OPTIONS.find(f => f.key === st); return o ? (lang === 'bn' ? o.bn : o.en) : st
}

export function FinalSheetTab({ hubId }: { hubId: string }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const [sp, setSp] = useSearchParams()
  const today = todayDhaka()
  const asked = sp.get('date')
  const date: IsoDate = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today
  const setDate = (d: string) => setSp(p => { const q = new URLSearchParams(p); q.set('date', d); return q }, { replace: true })
  const q = useLiveLoad<DaySheet>(() => att.sheet(hubId, date), [hubId, date], LIVE_SHEET)
  const d = q.data && q.data.hub.id === hubId && q.data.date === date ? q.data : null
  const edit = !!d?.can.edit
  const locked = d?.sheet?.status === 'submitted'

  // the manager's edits stay on screen while the page refreshes in the background
  const [vals, setVals] = useState<Record<string, LineValue>>({})
  const [dirty, setDirty] = useState(false)
  const lastKey = useRef('')
  useEffect(() => {
    if (!d) return
    const key = `${hubId}|${date}|${d.sheet?.status ?? 'new'}`
    if (key === lastKey.current && dirty && edit) return   // keep unsaved edits of the same register
    lastKey.current = key
    setDirty(false)
    setVals(Object.fromEntries(d.people.map(p => [p.employee_id, { ...EMPTY, ...p.value }])))
  }, [d]) // eslint-disable-line react-hooks/exhaustive-deps

  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const { session } = useAuth()
  useWorkHubBlocker(session?.user.id ?? '', dirty || busy)
  const [preview, setPreview] = useState(false)
  const [unlock, setUnlock] = useState(false)
  const [sendAsk, setSendAsk] = useState(false)
  const [old, setOld] = useState<VersionLines | null>(null)
  const [filter, setFilter] = useState<'all' | 'todo' | 'gave' | 'notgave'>('all')

  const people = d?.people ?? []
  const val = (p: SheetPerson): LineValue => vals[p.employee_id] ?? { ...EMPTY, ...p.value }
  const set = (id: string, patch: Partial<LineValue>) => { setDirty(true); setVals(v => ({ ...v, [id]: { ...(v[id] ?? EMPTY), ...patch } })) }
  const problems = useMemo(() => Object.fromEntries(people.map(p => [p.employee_id, lineProblem(p, val(p), lang)])), [people, vals, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const todo = people.filter(p => problems[p.employee_id]).length
  const shown = people.filter(p => filter === 'all' || (filter === 'todo' ? !!problems[p.employee_id] : filter === 'gave' ? !!p.mark : !p.mark))
  const lines = (): LineInput[] => people.map(p => ({ employee_id: p.employee_id, ...val(p) }))

  // counts by position from what is on screen now (the database sends the same numbers for the saved state)
  const byPos = useMemo(() => {
    const m = new Map<string, { position: string; total: number; not_given: number; present: number; late: number; absent: number; unauthorized: number; off: number; blank: number }>()
    for (const p of people) {
      const k = p.position ?? '—'; const v = val(p)
      const r = m.get(k) ?? { position: k, total: 0, not_given: 0, present: 0, late: 0, absent: 0, unauthorized: 0, off: 0, blank: 0 }
      r.total++; if (!p.mark) r.not_given++
      if (isPresentLike(v.final_status)) r.present++
      if (v.final_status === 'late') r.late++
      if (v.final_status === 'absent') r.absent++
      if (v.unauthorized) r.unauthorized++
      if (v.final_status === 'leave' || v.final_status === 'holiday' || v.final_status === 'weekly_off') r.off++
      if (!v.final_status) r.blank++
      m.set(k, r)
    }
    return [...m.values()]
  }, [people, vals]) // eslint-disable-line react-hooks/exhaustive-deps
  const tot = byPos.reduce((a, r) => ({ total: a.total + r.total, not_given: a.not_given + r.not_given, present: a.present + r.present, late: a.late + r.late,
    absent: a.absent + r.absent, unauthorized: a.unauthorized + r.unauthorized, off: a.off + r.off, blank: a.blank + r.blank }),
    { total: 0, not_given: 0, present: 0, late: 0, absent: 0, unauthorized: 0, off: 0, blank: 0 })

  /** `fn` may return its own message (a string) for the toast. */
  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true); setErr('')
    try { const r = await fn(); setDirty(false); toast(typeof r === 'string' && r ? r : msg); announceWfChange(); await q.reload() }
    catch (e) { setErr(wfFriendly(e)) } finally { setBusy(false) }
  }
  const restPresent = () => { for (const p of people) { const v = val(p); if (!v.final_status || v.final_status === 'unchecked') set(p.employee_id, { final_status: 'present', ...(p.mark ? { manager_ok: v.manager_ok ?? true } : {}) }) } }

  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, -i)), [today])

  return <>
    {node}
    <Section title={L('দৈনিক ফাইনাল হাজিরা খাতা', 'Final attendance register of the day')}
      hint={L('কর্মী নিজে যা দিয়েছেন তা আগে থেকেই বসানো। প্রত্যেকের জন্য হ্যাঁ/না, হাজিরা, অনলাইন হাজিরা, দেরির সময় বা আবেদনের তারিখ দিয়ে সাবমিট করুন — সাবমিটের পর খাতা লক হয়, শুধু জোনাল ম্যানেজার খুলতে পারেন।',
        'What staff gave is filled in. Give yes/no, the status, online marking, the late time or the application date, then submit — it locks; only the zonal manager unlocks.')}
      tools={<Field label={L('তারিখ', 'Date')}>
        <input type="date" value={date} max={today} onChange={e => e.target.value && setDate(e.target.value)} /></Field>}>
      <div className="as-days no-print" role="group" aria-label={L('শেষ ৭ দিন', 'Last 7 days')}>
        {dates.map(x => <button key={x} type="button" className={`wm-chip${x === date ? ' on' : ''}`} aria-pressed={x === date} onClick={() => setDate(x)}>
          {x === today ? L('আজ', 'Today') : `${fmtDay(x, lang)} · ${fmtWeekday(x, lang)}`}</button>)}
      </div>

      {q.error && !d ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
      {!d && !q.error ? <Loading /> : null}

      {d && <>
        <div className={`as-state ${locked ? 'lock' : 'open'}`} role="status">
          <Icon name={locked ? 'shield' : 'edit'} size={18} />
          <span>{locked
            ? <><b>{L('সাবমিট হয়েছে — খাতা লক', 'Submitted — locked')}</b> · {L('সংস্করণ', 'version')} {n(d.sheet?.version ?? 1)} · {d.sheet?.mode === 'auto' ? L('সার্ভার নিজে সাবমিট করেছে', 'submitted by the server') : d.sheet?.submitted_by_name ?? ''} · {fmtStamp(d.sheet?.submitted_at, lang)}</>
            : d.sheet ? <><b>{L('খসড়া — এখনো সাবমিট হয়নি', 'Draft — not submitted yet')}</b>{d.sheet.unlocked_at && <> · {L('জোনাল ম্যানেজার খুলে দিয়েছেন', 'Unlocked by the zonal manager')}: {d.sheet.unlock_note}</>}</>
              : <b>{L(`${fmtLong(date, lang)} — এখনো শুরু হয়নি`, `${fmtLong(date, lang)} — not started`)}</b>}</span>
        </div>
        {d.hold && !locked && <p className="da-error as-hold" role="alert"><Icon name="alert" size={16} /> <b>{L('সার্ভার এই খাতা জমা দেয়নি', 'The server did not submit this register')}</b> — {d.hold.reason === 'empty' ? L('কিছুই লেখা হয়নি।', 'nothing was written.') : L(`${n(d.hold.gap_count)} জনের হাজিরা অসম্পূর্ণ`, `${d.hold.gap_count} lines are unfinished`)}
          {d.hold.gaps.length > 0 && d.hold.reason !== 'empty' ? ` (${d.hold.gaps.slice(0, 5).map(g => g.name).join(', ')})` : ''}. {L('অসম্পূর্ণ হাজিরা কখনো জমা হয় না — পূরণ করে জমা দিন। হাব ও জোনাল ম্যানেজারকে জানানো হয়েছে।', 'An unfinished register is never submitted — finish it and submit. The hub and zonal managers were told.')}</p>}
        {!locked && date <= today && <p className="muted small as-due" role="note"><Icon name="clock" size={14} /> {date === today
          ? L(`আজকের খাতা সারাদিন খোলা। তারিখ বদলালে সার্ভার ${fmtStamp(d.due, lang)}-এ সাবমিট করবে — শুধু যদি প্রতিজনের হাজিরা সম্পূর্ণ লেখা থাকে। খালি বা অসম্পূর্ণ থাকলে খাতা খোলা থাকবে এবং হাব ও জোনাল ম্যানেজারকে জানানো হবে।`, `Today’s register stays open all day. After the date changes the server submits it at ${fmtStamp(d.due, lang)} — only when every person has an answer. If it is empty or unfinished it stays open and the hub and zonal managers are told.`)
          : d.window ? L(`জোনাল ম্যানেজার ${fmtStamp(d.window.expires_at, lang)} পর্যন্ত এই দিন খুলে রেখেছেন (${d.window.reason}) — সময় পেরোলে সার্ভার সাবমিট করবে (সম্পূর্ণ থাকলে; নইলে খোলা রেখে ম্যানেজারদের জানাবে)।`, `The zonal manager opened this day until ${fmtStamp(d.window.expires_at, lang)} (${d.window.reason}) — after that the server submits it if it is complete; otherwise it stays open and the managers are told.`)
          : L(`এই দিনের খাতা সার্ভার ${fmtStamp(d.due, lang)}-এ সাবমিট করবে (সম্পূর্ণ থাকলে)।`, `The server submits this day at ${fmtStamp(d.due, lang)} if it is complete.`)}</p>}
        {!edit && !locked && !d.window && date < today && <p className="notice wm-note" role="status">{L('এই দিনের খাতা বন্ধ। লিখতে হলে জোনাল ম্যানেজারকে সংশোধনের জন্য খুলে দিতে বলুন।', 'This day is closed. Ask the zonal manager to open it for correction.')}</p>}
        {(d.versions ?? []).length > 0 && <details className="as-versions"><summary className="muted small">{L(`সংস্করণ (${n((d.versions ?? []).length)}টি)`, `Versions (${(d.versions ?? []).length})`)}</summary>
          <ul>{(d.versions ?? []).map(v => <li key={v.no}><b>{L('সংস্করণ', 'v')} {n(v.no)}</b> · {v.mode === 'auto' ? L('সার্ভার', 'server') : v.by ?? ''} · {fmtStamp(v.at, lang)}
            {d.sheet && <>{' '}<button type="button" className="secondary sm" onClick={() => void att.version(d.sheet!.id, v.no).then(setOld).catch(e => setErr(wfFriendly(e)))}>{L('দেখুন', 'View')}</button></>}</li>)}</ul></details>}

        {d.my_check && <div className="as-check" role="status">
          {d.my_check.ok_at ? <span><Icon name="check" size={16} /> {L(`আপনি সংস্করণ ${n(d.my_check.version_no)}-কে “ঠিক আছে” দিয়েছেন — ${fmtStamp(d.my_check.ok_at, lang)}`, `You marked version ${d.my_check.version_no} OK — ${fmtStamp(d.my_check.ok_at, lang)}`)}</span>
            : d.my_check.returned_at ? <span><Icon name="alert" size={16} /> {L('আপনি সংশোধনের জন্য ফেরত পাঠিয়েছেন', 'You sent it back for correction')}: {d.my_check.return_reason} <small className="muted">({fmtStamp(d.my_check.returned_at, lang)})</small></span>
            : <><span>{L(`জোনাল ম্যানেজার এই খাতার সংস্করণ ${n(d.my_check.version_no)} আপনাকে যাচাইয়ে পাঠিয়েছেন। দেখে ঠিক থাকলে চাপুন:`, `The zonal manager sent version ${d.my_check.version_no} for your check. If it is right:`)}</span>
              <button type="button" disabled={busy || !d.sheet} onClick={() => d.sheet && void run(() => att.checkOk(d.sheet!.id), L('“ঠিক আছে” দেওয়া হয়েছে', 'Marked OK'))}>
                <Icon name="check" size={16} />{L('ঠিক আছে — হ্যাঁ', 'It is right — yes')}</button>
              <button type="button" className="secondary" disabled={busy || !d.sheet} onClick={async () => { const why = await askReason(L('কী সংশোধন করতে হবে?', 'What must be corrected?')); if (why && d.sheet) await run(() => att.checkReturn(d.sheet!.id, why), L('সংশোধনের অনুরোধ গেছে', 'Sent back')) }}>
                <Icon name="back" size={16} />{L('সংশোধন চাই', 'Needs correction')}</button></>}
        </div>}

        <h3 className="wm-sub">{L('পদবী অনুযায়ী', 'By position')}</h3>
        <div className="wm-scroll" tabIndex={0} role="region" aria-label={L('পদবী অনুযায়ী হিসাব', 'Counts by position')}>
          <table className="wm-tbl as-pos">
            <thead><tr><th scope="col" className="pri">{L('পদবী', 'Position')}</th><th scope="col" className="num">{L('মোট', 'Total')}</th>
              <th scope="col" className="num">{L('নিজে দেননি', 'Gave nothing')}</th><th scope="col" className="num">{L('উপস্থিত', 'Present')}</th>
              <th scope="col" className="num">{L('দেরি', 'Late')}</th><th scope="col" className="num">{L('অনুপস্থিত', 'Absent')}</th>
              <th scope="col" className="num">{L('না জানিয়ে', 'Without telling')}</th><th scope="col" className="num">{L('ছুটি', 'Off')}</th><th scope="col" className="num">{L('বাকি', 'Blank')}</th></tr></thead>
            <tbody>{byPos.map(r => <tr key={r.position}><th scope="row" className="pri">{r.position}</th><td className="num">{n(r.total)}</td>
              <td className={`num${r.not_given ? ' warn' : ''}`}>{n(r.not_given)}</td><td className="num">{n(r.present)}</td><td className="num">{n(r.late)}</td>
              <td className={`num${r.absent ? ' bad' : ''}`}>{n(r.absent)}</td><td className={`num${r.unauthorized ? ' bad' : ''}`}>{n(r.unauthorized)}</td>
              <td className="num">{n(r.off)}</td><td className={`num${r.blank ? ' warn' : ''}`}>{n(r.blank)}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row" className="pri">{L('মোট', 'Total')}</th><td className="num">{n(tot.total)}</td><td className="num">{n(tot.not_given)}</td>
              <td className="num">{n(tot.present)}</td><td className="num">{n(tot.late)}</td><td className="num">{n(tot.absent)}</td><td className="num">{n(tot.unauthorized)}</td>
              <td className="num">{n(tot.off)}</td><td className="num">{n(tot.blank)}</td></tr></tfoot>
          </table>
        </div>

        <div className="wm-filters no-print">
          <div className="wm-chips" role="group" aria-label={L('ফিল্টার', 'Filter')}>
            {([['all', 'সবাই', 'All', people.length], ['todo', 'অসম্পূর্ণ', 'Incomplete', todo], ['gave', 'নিজে দিয়েছেন', 'Gave', people.filter(p => p.mark).length],
              ['notgave', 'নিজে দেননি', 'Gave nothing', people.filter(p => !p.mark).length]] as const).map(([k, bn, en, c]) =>
              <button key={k} type="button" className={`wm-chip${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{L(bn, en)}<b className="plain">{n(c)}</b></button>)}
          </div>
          {edit && tot.blank > 0 && <button type="button" className="secondary sm" onClick={restPresent}><Icon name="checkall" size={15} />{L('বাকি সবাই উপস্থিত', 'Rest present')}</button>}
        </div>

        {!people.length ? <Empty>{L('এই হাবে কোনো সক্রিয় কর্মী নেই।', 'No active staff in this hub.')}</Empty> :
          <ul className="as-list">{shown.map(p => <PersonLine key={p.employee_id} p={p} v={val(p)} edit={edit} problem={problems[p.employee_id]} onChange={patch => set(p.employee_id, patch)} />)}</ul>}

        {err ? <p className="da-error" role="alert">{err}</p> : null}

        <div className="as-bar no-print">
          {edit && <>
            <span className="as-left">{todo ? L(`${n(todo)} জনের সারি অসম্পূর্ণ`, `${todo} lines incomplete`) : L('সব সারি পূর্ণ', 'All lines complete')}</span>
            <button type="button" className="secondary" disabled={busy || !dirty} onClick={() => void run(() => att.save(hubId, date, lines()), L('খসড়া সেভ হয়েছে', 'Draft saved'))}>
              <Icon name="save" size={16} />{L('সেভ করুন', 'Save')}</button>
            <button type="button" disabled={busy || todo > 0} onClick={() => setPreview(true)}><Icon name="check" size={16} />{L('সাবমিট করুন…', 'Submit…')}</button></>}
          {!edit && !locked && <span className="muted small">{L('এই খাতা লেখার অনুমতি আপনার নেই — শুধু দেখতে পারেন।', 'You may only look at this register.')}</span>}
          {d.can.send && d.sheet && <button type="button" className="secondary" disabled={busy} onClick={() => setSendAsk(true)}>
            <Icon name="bell" size={16} />{d.sheet.sent_at ? L('আবার যাচাইয়ে পাঠান', 'Send for checking again') : L('ম্যানেজারদের যাচাইয়ে পাঠান…', 'Send to managers for checking…')}</button>}
          {d.can.unlock && d.sheet && <button type="button" className="danger" disabled={busy} onClick={() => setUnlock(true)}><Icon name="key" size={16} />{L('খাতা খুলে দিন…', 'Unlock…')}</button>}
        </div>

        {d.checks.length > 0 && <div className="as-checks">
          <b>{L(`ম্যানেজারদের যাচাই (সংস্করণ ${n(d.sheet?.version ?? 1)})`, `Managers’ check (version ${d.sheet?.version ?? 1})`)}</b>
          <ul>{d.checks.map(c => <li key={c.profile_id}>{c.name ?? '—'} — {c.ok_at ? <Badge tone="ok">{L('ঠিক আছে', 'OK')} · {fmtStamp(c.ok_at, lang)}</Badge> : c.returned_at ? <Badge tone="bad">{L('সংশোধন চেয়েছেন', 'Wants a correction')}</Badge> : <Badge tone="warn">{L('এখনো দেখেননি', 'Not yet')}</Badge>}{c.return_reason ? <span className="muted small"> — {c.return_reason}</span> : null}</li>)}</ul>
        </div>}
      </>}
    </Section>

    {preview && d && <Modal wide title={L('সাবমিটের আগে দেখে নিন', 'Check before submitting')} onClose={() => setPreview(false)} actions={<>
      <button type="button" className="secondary" onClick={() => setPreview(false)}>{L('ফিরে যান', 'Back')}</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => {
        const r = await att.submit(hubId, date, lines()); setPreview(false)
        return r.asked ? L(`সাবমিট হয়েছে — খাতা লক, ${n(r.asked)}টি ব্যাখ্যা চাওয়া হয়েছে`, `Submitted — locked, ${r.asked} explanations asked`) : ''
      }, L('সাবমিট হয়েছে — খাতা লক', 'Submitted — locked'))}>{L('সাবমিট করুন', 'Submit')}</button></>}>
      <p>{fmtLong(date, lang)} · {d.hub.name}</p>
      <ul className="wm-sum">
        <li><b>{n(tot.present)}</b> {L('জন উপস্থিত', 'present')} ({L('দেরি', 'late')} {n(tot.late)})</li>
        <li><b>{n(tot.absent)}</b> {L('জন অনুপস্থিত', 'absent')} ({L('না জানিয়ে', 'without telling')} {n(tot.unauthorized)})</li>
        <li><b>{n(tot.off)}</b> {L('জন ছুটিতে', 'off')}</li>
        <li><b>{n(people.filter(p => p.mark && val(p).manager_ok === false).length)}</b> {L('জনের দেওয়া হাজিরায় “না”', '“no” on what was given')}</li>
      </ul>
      <p className="muted small">{L('“না”, দেরি আর না জানিয়ে অনুপস্থিত — এঁদের কাছে স্টাফ প্যানেলে ব্যাখ্যা চাওয়া হবে। সাবমিটের পর খাতা লক হবে।', 'Those with “no”, late or absent without telling are asked to explain in the staff panel. The register locks after submitting.')}</p>
      {err ? <p className="da-error" role="alert">{err}</p> : null}
    </Modal>}

    {old && <Modal wide title={L(`সংস্করণ ${n(old.no)} — ${fmtLong(old.date, lang)}`, `Version ${old.no} — ${fmtLong(old.date, lang)}`)} onClose={() => setOld(null)} actions={<button type="button" onClick={() => setOld(null)}>{L('বন্ধ করুন', 'Close')}</button>}>
      <p className="muted small">{old.mode === 'auto' ? L('সার্ভার সাবমিট করেছিল', 'Submitted by the server') : old.by} · {fmtStamp(old.at, lang)}</p>
      <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('কর্মী', 'Person')}</th><th>{L('হাজিরা', 'Status')}</th><th>{L('বিবরণ', 'Details')}</th></tr></thead>
        <tbody>{old.lines.map(x => <tr key={x.employee_id}><td>{x.name}</td><td>{statusLabel(x.final_status, lang)}</td>
          <td className="wm-wrap">{[x.late_time && `${L('আসা', 'at')} ${x.late_time}`, x.unauthorized ? L('না জানিয়ে', 'without telling') : null, x.absence_reason, x.leave_ref, x.absence_app_date && `${L('আবেদন', 'applied')} ${x.absence_app_date}`, x.note].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody></table></div>
    </Modal>}

    {unlock && d?.sheet && <NoteDialog title={L('খাতা খুলে দিন', 'Unlock the register')} label={L('কেন খুলছেন?', 'Why?')} confirm={L('খুলে দিন', 'Unlock')} danger
      hint={L('ম্যানেজার আবার সংশোধন করে সাবমিট দেবেন।', 'The manager corrects it and submits again.')} onClose={() => setUnlock(false)}
      onConfirm={async note => { await att.unlock(d.sheet!.id, note); setUnlock(false); toast(L('খাতা খোলা হয়েছে', 'Unlocked')); announceWfChange(); await q.reload() }} />}

    {sendAsk && d?.sheet && <Modal title={L('ম্যানেজারদের যাচাইয়ে পাঠান', 'Send for checking')} onClose={() => setSendAsk(false)} actions={<>
      <button type="button" className="secondary" onClick={() => setSendAsk(false)}>{L('বাতিল', 'Cancel')}</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => { const k = await att.send(d.sheet!.id); setSendAsk(false)
        return k ? L(`${n(k)} জন ম্যানেজারকে পাঠানো হয়েছে`, `Sent to ${k} managers`) : L('সবাইকে আগেই পাঠানো হয়েছে', 'Already sent to everyone') }, L('পাঠানো হয়েছে', 'Sent'))}>
        {L('পাঠান', 'Send')}</button></>}>
      <p>{L(`${d.hub.name} · ${fmtLong(date, lang)} — এই খাতা (উপরে যেমন দেখছেন) হাবের সব ম্যানেজার ও সহকারী ম্যানেজারের কাছে যাবে। তাঁরা দেখে “ঠিক আছে — হ্যাঁ” দেবেন।`,
        `${d.hub.name} · ${fmtLong(date, lang)} — this register (as shown above) goes to every manager and assistant manager of the hub; they mark it OK.`)}</p>
      <ul className="wm-sum"><li><b>{n(tot.present)}</b> {L('উপস্থিত', 'present')}</li><li><b>{n(tot.absent)}</b> {L('অনুপস্থিত', 'absent')}</li><li><b>{n(tot.late)}</b> {L('দেরি', 'late')}</li></ul>
      {err ? <p className="da-error" role="alert">{err}</p> : null}
    </Modal>}
  </>
}

function PersonLine({ p, v, edit, problem, onChange }: { p: SheetPerson; v: LineValue; edit: boolean; problem: string | null; onChange: (patch: Partial<LineValue>) => void }) {
  const { L, lang } = usePrefs()
  const yesNo = (cur: boolean | null, on: (b: boolean) => void, label: string) => <span className="as-yn" role="group" aria-label={label}>
    <button type="button" className={`wm-chip${cur === true ? ' on ok' : ''}`} aria-pressed={cur === true} disabled={!edit} onClick={() => on(true)}>{L('হ্যাঁ', 'Yes')}</button>
    <button type="button" className={`wm-chip${cur === false ? ' on bad' : ''}`} aria-pressed={cur === false} disabled={!edit} onClick={() => on(false)}>{L('না', 'No')}</button></span>
  const pick = (s: FinalStatus) => onChange({ final_status: s, ...(s !== 'late' ? { late_time: null } : {}), ...(s !== 'absent' ? { unauthorized: false, absence_app_date: null, absence_app_ref: null, absence_reason: null } : {}),
    ...(!isPresentLike(s) ? { online_marked: null, online_reason: null } : {}) })
  const onLeave = v.final_status === 'leave' && !!v.leave_ref          // approved leave puts itself on the line and cannot be changed here
  const markedOnline = p.mark?.kind === 'present'                      // "marked online" is the person's own mark, with the server time of it

  return <li className={`as-line${problem && edit ? ' todo' : ''}`}>
    <div className="as-head">
      <Who name={p.name} code={p.code} position={p.position} />
      <span className="as-given">{p.mark
        ? <><KindBadge k={p.mark.kind} /><small>{L('নিজে দিয়েছেন', 'gave')} · {fmtTime(p.mark.marked_at, lang)}</small>{p.mark.note && <small className="wm-wrap">“{p.mark.note}”</small>}</>
        : <Badge tone="neutral">{L('নিজে দেননি', 'Gave nothing')}</Badge>}</span>
    </div>

    {p.mark && <div className="as-row"><span className="as-k">{L('কর্মী যা দিয়েছেন — ঠিক আছে?', 'Is what they gave right?')}</span>
      {yesNo(v.manager_ok, b => onChange({ manager_ok: b }), L('ঠিক আছে কি না', 'Right or not'))}
      {v.manager_ok === false && <small className="muted">{L('সাবমিটের পর কর্মীর কাছে ব্যাখ্যা চাওয়া হবে', 'They are asked to explain after submitting')}</small>}</div>}

    {onLeave && <div className="as-row"><span className="as-k">{L('হাজিরা', 'Attendance')}</span>
      <Badge tone="info">{L('অনুমোদিত ছুটি', 'Approved leave')}</Badge>
      <small className="muted">{v.leave_ref}{v.leave_applied_on ? ` · ${L('আবেদনের তারিখ', 'applied on')} ${fmtDay(v.leave_applied_on, lang)}` : ''}</small></div>}
    {!onLeave && v.leave_pending && <div className="as-row"><span className="as-k">{L('ছুটির আবেদন', 'Leave request')}</span>
      <Badge tone="warn">{L('বিচারাধীন', 'Waiting')}</Badge><small className="muted">{v.leave_pending.ref} · {L('আবেদনের তারিখ', 'applied on')} {fmtDay(v.leave_pending.applied_on, lang)} — {L('অনুমোদন না হওয়া পর্যন্ত নিজে হাজিরা বাছুন', 'choose the attendance yourself until it is decided')}</small></div>}
    {v.final_status === 'unchecked' && <div className="as-row"><Badge tone="warn">{L('যাচাই বাকি', 'Not checked')}</Badge></div>}

    {!onLeave && <div className="as-row"><span className="as-k">{L('হাজিরা', 'Attendance')}</span>
      {(v.final_status === 'holiday' || v.final_status === 'half_day') && <Badge tone="info">{statusLabel(v.final_status, lang)}</Badge>}
      <span className="wm-chips">{FINAL_OPTIONS.filter(o => o.key !== 'holiday' && o.key !== 'half_day' && (o.key !== 'leave' || v.final_status === 'leave')).map(o => <button key={o.key} type="button" className={`wm-chip${v.final_status === o.key ? ' on' : ''}`} aria-pressed={v.final_status === o.key}
        disabled={!edit} onClick={() => pick(o.key)}>{L(o.bn, o.en)}</button>)}</span></div>}

    {v.final_status === 'late' && <div className="as-row"><span className="as-k">{L('কখন এসেছেন', 'Arrived at')}</span>
      <input type="time" value={v.late_time ?? ''} disabled={!edit} onChange={e => onChange({ late_time: e.target.value || null })} aria-label={L('আসার সময়', 'Arrival time')} /></div>}

    {isPresentLike(v.final_status) && <div className="as-row"><span className="as-k">{L('অনলাইন হাজিরা', 'Online attendance')}</span>
      {markedOnline ? <><Badge tone="ok">{L('হ্যাঁ', 'Yes')}</Badge><small className="muted">{L('কর্মীর নিজের হাজিরা', 'their own mark')} · {fmtStamp(p.mark!.marked_at, lang)}</small></>
        : <><Badge tone="warn">{L('না', 'No')}</Badge>
          <input type="text" className="as-in" value={v.online_reason ?? ''} disabled={!edit} maxLength={500}
            placeholder={L('অনলাইনে না দেওয়ার কারণ লিখুন', 'Why no online attendance — reason')} aria-label={L('অনলাইনে না দেওয়ার কারণ', 'Reason')} onChange={e => onChange({ online_reason: e.target.value })} /></>}</div>}

    {v.final_status === 'absent' && <div className="as-row as-abs">
      <label className="wm-ck"><input type="checkbox" checked={v.unauthorized} disabled={!edit} onChange={e => onChange({ unauthorized: e.target.checked, ...(e.target.checked ? { absence_app_date: null, absence_app_ref: null, absence_reason: null } : {}) })} />
        <span>{L('না জানিয়ে অনুপস্থিত (কারণ অজানা)', 'Absent without telling (reason unknown)')}</span></label>
      {!v.unauthorized && <>
        <Field label={L('কারণ (জানা থাকলে)', 'Reason (if known)')}><input type="text" value={v.absence_reason ?? ''} disabled={!edit} maxLength={500} onChange={e => onChange({ absence_reason: e.target.value || null })} /></Field>
        <Field label={L('অনলাইন আবেদনের তারিখ', 'Online application date')}><input type="date" value={v.absence_app_date ?? ''} disabled={!edit} max={todayDhaka()} onChange={e => onChange({ absence_app_date: e.target.value || null })} /></Field>
        <Field label={L('আবেদন নম্বর (থাকলে)', 'Application no. (if any)')}><input type="text" value={v.absence_app_ref ?? ''} disabled={!edit} maxLength={60} onChange={e => onChange({ absence_app_ref: e.target.value || null })} /></Field></>}
    </div>}

    {p.explanations.length > 0 && <div className="as-expl">{p.explanations.map(x => <p key={x.id}>
      <Badge tone={x.reply ? 'info' : 'warn'}>{L(REASON_META[x.reason].bn, REASON_META[x.reason].en)}</Badge>{' '}
      {x.reply ? <><b>{L('জবাব:', 'Reply:')}</b> {x.reply} <small className="muted">({fmtStamp(x.replied_at, lang)})</small></> : <span className="muted">{L('ব্যাখ্যা চাওয়া হয়েছে — জবাবের অপেক্ষায়', 'Asked — waiting for the reply')}</span>}</p>)}</div>}

    {problem && edit && <p className="as-prob"><Icon name="alert" size={14} /> {problem}</p>}
  </li>
}

// ====================================================================================== মাসিক খাতা
const CELL: Record<MonthCell, { bn: string; en: string; cls: string }> = {
  P: { bn: 'উ', en: 'P', cls: 't-ok' }, A: { bn: 'অ', en: 'A', cls: 't-bad' }, U: { bn: 'বা', en: 'U', cls: 't-warn' }, O: { bn: 'ছু', en: 'O', cls: 't-neutral' }, '': { bn: '', en: '', cls: 't-neutral f' },
}

export function MonthSheetTab({ hubId }: { hubId: string }) {
  const { L, n, lang } = usePrefs()
  const today = todayDhaka()
  const [month, setMonth] = useState<IsoDate>(monthOf(today))
  const q = useLiveLoad<MonthSheet>(() => att.month(hubId, month), [hubId, month], ['att_day_sheets'])
  const b = q.data && q.data.hub.id === hubId && q.data.month === month ? q.data : null
  const months = useMemo(() => lastMonths(today, 12), [today])
  const submitted = new Set((b?.days ?? []).filter(x => x.status === 'submitted').map(x => x.date))

  function excel() {
    if (!b) return
    const heads = [L('আইডি', 'ID'), L('নাম', 'Name'), L('পদবী', 'Position'), ...b.dates.map(x => String(Number(x.slice(8)))), L('উপস্থিত', 'Present'), L('অনুপস্থিত', 'Absent'), L('ছুটি', 'Off')]
    const rows = b.people.map(p => [p.code, p.name, p.position, ...p.cells.map(c => c === 'P' ? L('উপস্থিত', 'Present') : c === 'A' ? L('অনুপস্থিত', 'Absent') : c === 'O' ? L('ছুটি', 'Off') : c === 'U' ? L('যাচাই বাকি', 'Not checked') : ''), p.present, p.absent, p.off])
    exportRows(L('মাসিক হাজিরা খাতা', 'Monthly attendance register'), `${b.hub.name ?? ''} · ${monthName(b.month, lang)}`, heads, rows, `monthly-attendance-${b.month.slice(0, 7)}`)
  }

  return <>
  <MonthSubmission hubId={hubId} month={month} />
  <Section title={L('মাসিক হাজিরা খাতা', 'Monthly attendance register')}
    hint={L('প্রতিদিনের সাবমিট করা ফাইনাল খাতা থেকে — উপস্থিত (দেরি ও অর্ধদিবসসহ) আর অনুপস্থিত। যে দিনের খাতা সাবমিট হয়নি, সেই কলাম ফাঁকা।',
      'From the submitted daily registers — present (late and half day included) and absent. A day not submitted stays blank.')}
    tools={<>
      <Field label={L('মাস', 'Month')}><select value={month} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={m} value={m}>{monthName(m, lang)}</option>)}</select></Field>
      {b && <button type="button" className="secondary sm" onClick={excel}><Icon name="xls" size={15} />{L('এক্সেল', 'Excel')}</button>}</>}>
    {q.error && !b ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
    {!b && !q.error ? <Loading /> : null}
    {b && <>
      <div className="da-stats">
        <Stat icon="cal" label={L('সাবমিট হওয়া দিন', 'Days submitted')} value={`${n(submitted.size)}/${n(b.dates.length)}`} />
        <Stat icon="check" tone="ok" label={L('মোট উপস্থিত', 'Present')} value={n(b.people.reduce((a, p) => a + p.present, 0))} />
        <Stat icon="x" tone="bad" label={L('মোট অনুপস্থিত', 'Absent')} value={n(b.people.reduce((a, p) => a + p.absent, 0))} />
      </div>
      {!b.people.length ? <Empty>{L('এই হাবে কোনো কর্মী নেই।', 'No staff.')}</Empty> : !b.dates.length ? <Notice>{L('এই মাসের কোনো দিন এখনো আসেনি।', 'No day of this month yet.')}</Notice> :
        <div className="wm-scroll wm-book" tabIndex={0} role="region" aria-label={L('মাসিক খাতার ছক', 'Monthly grid')}>
          <table className="wm-grid">
            <thead><tr><th scope="col" className="pri">{L('কর্মী', 'Person')}</th>
              {b.dates.map(x => <th key={x} scope="col" className={submitted.has(x) ? '' : 'as-nosub'} title={submitted.has(x) ? '' : L('সাবমিট হয়নি', 'Not submitted')}>
                <b>{n(Number(x.slice(8)))}</b><small>{fmtWeekday(x, lang)}</small></th>)}
              <th scope="col" className="sum">{L('উ', 'P')}</th><th scope="col" className="sum">{L('অ', 'A')}</th></tr></thead>
            <tbody>{b.people.map(p => <tr key={p.employee_id}><th scope="row" className="pri"><Who name={p.name} code={p.code} position={p.position} /></th>
              {p.cells.map((c, i) => <td key={i}><span className={`wm-cell ${CELL[c].cls}`} aria-label={c === 'P' ? L('উপস্থিত', 'Present') : c === 'A' ? L('অনুপস্থিত', 'Absent') : c === 'O' ? L('ছুটি', 'Off') : c === 'U' ? L('যাচাই বাকি', 'Not checked') : L('খাতা নেই', 'No register')}>
                {lang === 'bn' ? CELL[c].bn : CELL[c].en}</span></td>)}
              <td className="sum">{n(p.present)}</td><td className="sum bad">{n(p.absent)}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row" className="pri">{L('মোট উপস্থিত', 'Present, total')}</th>
              {b.dates.map((x, i) => <td key={x}>{submitted.has(x) ? n(b.people.filter(p => p.cells[i] === 'P').length) : ''}</td>)}
              <td className="sum">{n(b.people.reduce((a, p) => a + p.present, 0))}</td><td className="sum bad">{n(b.people.reduce((a, p) => a + p.absent, 0))}</td></tr></tfoot>
          </table>
        </div>}
    </>}
  </Section>
  </>
}

/** মাসের জমা — the month is submitted from the daily registers' versions. A missing day is named; after a day is corrected the month is submitted again. */
function MonthSubmission({ hubId, month }: { hubId: string; month: IsoDate }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const q = useLiveLoad<MonthRegister>(() => att.monthGet(hubId, month), [hubId, month], LIVE_MONTH)
  const r = q.data && q.data.hub.id === hubId && q.data.month === month ? q.data : null
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  if (q.error && !r) return <p className="da-error" role="alert">{wfFriendly(q.error)}</p>
  if (!r) return null
  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true); setErr('')
    try { const x = await fn(); toast(typeof x === 'string' && x ? x : msg); announceWfChange(); await q.reload() } catch (e) { setErr(wfFriendly(e)) } finally { setBusy(false) }
  }
  const missing = r.missing, sub = r.sub
  const need = !sub || r.changed
  return <Section title={L('মাসের খাতা জমা', 'Submit the month')}
    hint={L('মাসের হিসাব দৈনিক খাতার সংস্করণ থেকে হয়। কোনো দিনের খাতা বাকি থাকলে সেই তারিখ দেখানো হয়। দিনের খাতা সংশোধন হলে মাস আবার জমা দিতে হয়; আগের মাসিক সংস্করণ রাখা থাকে।',
      'The month is made from the daily registers’ versions. A day not submitted is named. After a day is corrected the month must be submitted again; the earlier monthly version is kept.')}>
    {node}
    {sub ? <p className="as-state lock"><Icon name="shield" size={18} /> <span><b>{L(`মাসের খাতা জমা — সংস্করণ ${n(sub.version_no)}`, `Month submitted — version ${sub.version_no}`)}</b> · {sub.by ?? ''} · {fmtStamp(sub.at, lang)} · {L(`${n(Object.keys(sub.days).length)} দিন`, `${Object.keys(sub.days).length} days`)}</span></p>
      : <p className="muted">{L('এই মাসের খাতা এখনো জমা হয়নি।', 'This month has not been submitted yet.')}</p>}
    {r.changed && <p className="da-error" role="alert">{L('দৈনিক খাতা বদলেছে — পুনঃসাবমিট দরকার', 'A daily register changed — submit again')}: {r.changed_days.map(x => fmtDay(x, lang)).join(', ')}</p>}
    {missing.length > 0 && <p className="notice wm-note" role="status"><Icon name="alert" size={14} /> {L('দৈনিক খাতা বাকি', 'Daily register missing')}: <b>{missing.slice(0, 6).map(x => fmtDay(x, lang)).join(', ')}{missing.length > 6 ? ` +${n(missing.length - 6)}` : ''}</b></p>}
    {err ? <p className="da-error" role="alert">{err}</p> : null}
    <div className="as-bar no-print">
      {r.can.submit && need && <button type="button" disabled={busy || missing.length > 0 || !Object.keys(r.days).length} onClick={() => void run(async () => (await att.monthSubmit(hubId, month)).already ? L('একই সংস্করণ আগেই জমা আছে', 'Already submitted') : '', sub ? L('পুনরায় জমা হয়েছে', 'Submitted again') : L('মাসের খাতা জমা হয়েছে', 'Month submitted'))}>
        <Icon name="check" size={16} />{sub ? L('মাস আবার জমা দিন', 'Submit the month again') : L('মাসের খাতা জমা দিন', 'Submit the month')}</button>}
      {r.can.send && sub && <button type="button" className="secondary" disabled={busy} onClick={() => void run(async () => { const k = await att.monthSend(sub.id); return k ? L(`${n(k)} জন ম্যানেজারকে পাঠানো হয়েছে`, `Sent to ${k} managers`) : L('সবাইকে আগেই পাঠানো হয়েছে', 'Already sent') }, L('পাঠানো হয়েছে', 'Sent'))}>
        <Icon name="bell" size={16} />{L('এই সংস্করণ হাব ম্যানেজারদের যাচাইয়ে পাঠান', 'Send this version for checking')}</button>}
    </div>
    {r.my_check && sub && <div className="as-check" role="status">
      {r.my_check.ok_at ? <span><Icon name="check" size={16} /> {L('আপনি “ঠিক আছে” দিয়েছেন', 'You marked it OK')} — {fmtStamp(r.my_check.ok_at, lang)}</span>
        : r.my_check.returned_at ? <span><Icon name="alert" size={16} /> {L('আপনি সংশোধনের জন্য ফেরত পাঠিয়েছেন', 'You sent it back')}: {r.my_check.return_reason}</span>
        : <><span>{L(`জোনাল ম্যানেজার মাসের খাতার সংস্করণ ${n(sub.version_no)} যাচাইয়ে পাঠিয়েছেন:`, `The zonal manager sent version ${sub.version_no} of the month for your check:`)}</span>
          <button type="button" disabled={busy} onClick={() => void run(() => att.monthOk(sub.id), L('“ঠিক আছে” দেওয়া হয়েছে', 'Marked OK'))}><Icon name="check" size={16} />{L('ঠিক আছে — হ্যাঁ', 'It is right — yes')}</button>
          <button type="button" className="secondary" disabled={busy} onClick={async () => { const why = await askReason(L('কী সংশোধন করতে হবে?', 'What must be corrected?')); if (why) await run(() => att.monthReturn(sub.id, why), L('সংশোধনের অনুরোধ গেছে', 'Sent back')) }}>
            <Icon name="back" size={16} />{L('সংশোধন চাই', 'Needs correction')}</button></>}
    </div>}
    {r.checks.length > 0 && <div className="as-checks"><b>{L('ম্যানেজারদের যাচাই', 'Managers’ check')}</b>
      <ul>{r.checks.map(c => <li key={c.profile_id}>{c.name ?? '—'} — {c.ok_at ? <Badge tone="ok">{L('ঠিক আছে', 'OK')} · {fmtStamp(c.ok_at, lang)}</Badge> : c.returned_at ? <Badge tone="bad">{L('সংশোধন চেয়েছেন', 'Wants a correction')}</Badge> : <Badge tone="warn">{L('এখনো দেখেননি', 'Not yet')}</Badge>}{c.return_reason ? <span className="muted small"> — {c.return_reason}</span> : null}</li>)}</ul></div>}
    {r.history.length > 1 && <details className="as-versions"><summary className="muted small">{L(`মাসিক সংস্করণ (${n(r.history.length)}টি)`, `Monthly versions (${r.history.length})`)}</summary>
      <ul>{r.history.map(h => <li key={h.version_no}><b>{L('সংস্করণ', 'v')} {n(h.version_no)}</b> · {h.by ?? ''} · {fmtStamp(h.at, lang)} · {L(`${n(h.days)} দিন`, `${h.days} days`)}</li>)}</ul></details>}
  </Section>
}
