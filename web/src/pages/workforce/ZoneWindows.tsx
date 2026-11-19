import { scrollBehavior } from '../../lib/a11y'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { addDays } from '../../lib/dailyAccounts'
import { usePrefs } from '../../lib/prefs'
import { monthLabel, monthOf, useLiveLoad, wf, wfFriendly, type IsoDate, type WindowRow, type WindowsPage } from '../../lib/workforce'
import { Badge, Field, Modal, useToast } from '../accounts/ui'
import { shortDate } from './AbsenceApply'
import { Empty, Loading, Section, fmtStamp } from './shared'

/**
 * জোনাল সেটিং — আগের তারিখ খোলা. The zonal manager opens earlier dates of the attendance book for their zone:
 * which dates (inside one month's book days, at most two months back) and until which day staff may give them.
 * The database (wf_window_save / wf_window_end / wf_windows) checks every rule and the zone scope; this page only asks and shows.
 * When a window opens, the zone's staff are told at once and reminded every afternoon until it ends; inputs still wait for the hub manager.
 */
const nextMonth = (ym: IsoDate) => { const [y, m] = ym.slice(0, 7).split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01` }
const minIso = (a: IsoDate, b: IsoDate) => (a < b ? a : b)

export function ZoneWindows({ zone }: { zone: string }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const q = useLiveLoad<WindowsPage>(() => wf.windows(zone || null), [zone])
  const d = q.data
  const settable = useMemo(() => (d?.zones ?? []).filter(z => z.can_configure), [d])
  const [pick, setPick] = useState('')
  const target = zone && settable.some(z => z.id === zone) ? zone : settable.some(z => z.id === pick) ? pick : settable.length === 1 ? settable[0].id : ''

  // ---- the form
  const months = useMemo(() => {
    if (!d) return [] as IsoDate[]
    const out: IsoDate[] = []
    for (let m = monthOf(d.earliest); m <= monthOf(d.today); m = nextMonth(m)) out.push(m)
    return out.reverse()
  }, [d])
  const [month, setMonth] = useState<IsoDate>('')
  const [from, setFrom] = useState<IsoDate>('')
  const [to, setTo] = useState<IsoDate>('')
  const [until, setUntil] = useState<IsoDate>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const firstDay = (m: IsoDate) => d ? addDays(m, d.window.from_day - 1) : m
  const lastDay = (m: IsoDate) => d ? minIso(addDays(m, d.window.to_day - 1), d.today) : m
  const choose = (m: IsoDate) => { setMonth(m); setFrom(firstDay(m)); setTo(lastDay(m)) }
  useEffect(() => {
    if (!d || month) return
    // the current month once its book has closed; otherwise the month before (the current one is open by itself)
    const day = Number(d.today.slice(8, 10))
    const m = day > d.window.to_day ? monthOf(d.today) : months[1] ?? monthOf(d.today)
    choose(m)
    setUntil(minIso(addDays(d.today, 7), d.latest_until))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d])
  const ready = !!target && !!from && !!to && !!until && from <= to
  // on a phone the tab sits below the zone report: bring it into view once, when it has loaded (also from the dashboard shortcut)
  const top = useRef<HTMLDivElement>(null)
  const shown = useRef(false)
  useEffect(() => { if (d && !shown.current) { shown.current = true; top.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior() }) } }, [d])

  const save = async () => {
    if (!ready) return
    setBusy(true); setErr('')
    try {
      await wf.windowSave(target, from, to, until, note.trim() || null)
      setNote(''); await q.reload()
      toast(L('খুলে দেওয়া হয়েছে — জোনের স্টাফদের জানানো হয়েছে', 'Opened — the zone’s staff have been told'))
    } catch (e) { setErr(wfFriendly(e)) } finally { setBusy(false) }
  }

  // ---- closing one early
  const [ending, setEnding] = useState<WindowRow | null>(null)
  const [endNote, setEndNote] = useState('')
  const [endErr, setEndErr] = useState('')
  const doEnd = async () => {
    if (!ending) return
    setBusy(true); setEndErr('')
    try { await wf.windowEnd(ending.id, endNote.trim() || null); setEnding(null); setEndNote(''); await q.reload(); toast(L('বন্ধ করা হয়েছে', 'Closed')) }
    catch (e) { setEndErr(wfFriendly(e)) } finally { setBusy(false) }
  }

  if (q.error && !d) return <Section title={L('আগের তারিখ খোলা', 'Open earlier dates')}><p className="da-error" role="alert">{wfFriendly(q.error)}</p></Section>
  if (!d) return <Section title={L('আগের তারিখ খোলা', 'Open earlier dates')}><Loading /></Section>
  const canSet = settable.length > 0
  const STATE: Record<WindowRow['state'], [string, string, 'ok' | 'neutral']> = { open: ['খোলা', 'Open', 'ok'], expired: ['মেয়াদ শেষ', 'Expired', 'neutral'], ended: ['বন্ধ', 'Closed', 'neutral'] }

  return <>
    {node}
    <div ref={top} className="wm-win-top" aria-hidden="true" />
    {canSet && <Section title={L('আগের তারিখ খোলা', 'Open earlier dates')}
      hint={L(`হাজিরা বই প্রতি মাসের ${n(d.window.from_day)}–${n(d.window.to_day)} তারিখ নিজে থেকে খোলা থাকে। তার পরে আগের তারিখ দিতে হলে এখান থেকে খুলে দিন — স্টাফরা হাজিরা বইয়ে "একসাথে সব দিন" দিয়ে সব তারিখ এক পাতায় দেবেন, হাব ম্যানেজার অনুমোদন দেবেন। জোনের স্টাফদের সাথে সাথে জানানো হবে, আর বন্ধ না হওয়া পর্যন্ত প্রতিদিন বিকেলে মনে করানো হবে।`,
        `The book opens by itself on days ${d.window.from_day}–${d.window.to_day} of each month. To let staff give earlier dates after that, open them here — staff give them all on one page ("Give all at once"), the hub manager approves. The zone’s staff are told at once and reminded every afternoon until it closes.`)}>
      <div className="wm-win-form">
        {settable.length > 1 && !(zone && settable.some(z => z.id === zone)) && <Field label={L('জোন', 'Zone')} required>
          <select value={target} onChange={e => setPick(e.target.value)}><option value="">{L('জোন বাছুন', 'Choose a zone')}</option>
            {settable.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
        <Field label={L('মাস', 'Month')}>
          <select value={month} onChange={e => choose(e.target.value)}>{months.map(m => <option key={m} value={m}>{monthLabel(m, lang)}</option>)}</select></Field>
        <Field label={L('প্রথম তারিখ', 'First date')} required>
          <input type="date" value={from} min={month ? firstDay(month) : undefined} max={month ? lastDay(month) : undefined} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label={L('শেষ তারিখ', 'Last date')} required>
          <input type="date" value={to} min={from || undefined} max={month ? lastDay(month) : undefined} onChange={e => setTo(e.target.value)} /></Field>
        <Field label={L('কত তারিখ পর্যন্ত দেওয়া যাবে', 'Staff may give them until')} required>
          <input type="date" value={until} min={d.today} max={d.latest_until} onChange={e => setUntil(e.target.value)} /></Field>
        <Field label={L('কারণ / নোট (স্টাফরা দেখবেন)', 'Reason / note (staff see it)')} wide>
          <input value={note} maxLength={300} placeholder={L('যেমন: সাইট দেরিতে চালু হয়েছে, এবার আগের সব তারিখ দিন', 'e.g. the site came late, give every earlier date this time')} onChange={e => setNote(e.target.value)} /></Field>
      </div>
      {from && to && until && <p className="wm-win-prev">{L(`${shortDate(from, lang)} থেকে ${shortDate(to, lang)} — ${shortDate(until, lang)} পর্যন্ত স্টাফরা দিতে পারবেন`,
        `${shortDate(from, lang)} to ${shortDate(to, lang)} — staff may give them until ${shortDate(until, lang)}`)}</p>}
      {err && <p className="da-error" role="alert">{err}</p>}
      <div className="wm-win-act"><button type="button" disabled={busy || !ready} onClick={() => void save()}><Icon name="check" size={16} />{busy ? L('হচ্ছে…', 'Working…') : L('খুলে দিন', 'Open')}</button></div>
    </Section>}

    <Section title={L('খোলা ও আগের সেটিং', 'Open and earlier settings')}
      hint={canSet ? undefined : L('এই সেটিং বদলানোর অনুমতি আপনার নেই — শুধু দেখা যাবে।', 'You may not change this setting — view only.')}>
      {d.rows.length === 0 ? <Empty>{L('এখনো কোনো আগের তারিখ খোলা হয়নি।', 'No earlier dates opened yet.')}</Empty>
        : <ul className="wm-win-list">{d.rows.map(r => {
          const st = STATE[r.state]
          const mayEnd = r.state === 'open' && settable.some(z => z.id === r.zone_id)
          return <li key={r.id} className={`wm-win s-${r.state}`}>
            <div className="wm-win-h">
              <b>{monthLabel(r.month, lang)}{d.zones.length > 1 && r.zone_name ? ` · ${r.zone_name}` : ''}</b>
              <Badge tone={st[2]}>{L(st[0], st[1])}</Badge>
            </div>
            <p>{L(`${shortDate(r.date_from, lang)} থেকে ${shortDate(r.date_to, lang)} · ${shortDate(r.open_until, lang)} পর্যন্ত`,
              `${shortDate(r.date_from, lang)} to ${shortDate(r.date_to, lang)} · until ${shortDate(r.open_until, lang)}`)}</p>
            {r.note && <p className="muted">{r.note}</p>}
            {r.state === 'open' && r.people !== null && <p className="wm-win-prog">
              {L(`${n(r.people)} জন স্টাফ · ${n(r.people_left ?? 0)} জনের ${n(r.days_left ?? 0)} দিন এখনো বাকি · ${n(r.days_waiting ?? 0)} দিন অনুমোদনের অপেক্ষায়`,
                `${r.people} staff · ${r.people_left ?? 0} still have ${r.days_left ?? 0} day(s) to give · ${r.days_waiting ?? 0} day(s) wait for approval`)}</p>}
            <small className="muted">{L('খুলেছেন', 'Opened by')} {r.by_name ?? '—'} · {fmtStamp(r.created_at, lang)}
              {r.ended_at ? ` · ${L('বন্ধ', 'Closed')}: ${r.ended_by_name ?? '—'}${r.end_note ? ` — ${r.end_note}` : ''}` : ''}</small>
            {mayEnd && <div className="wm-win-act"><button type="button" className="secondary" disabled={busy} onClick={() => { setEndErr(''); setEnding(r) }}>{L('এখনই বন্ধ করুন', 'Close now')}</button></div>}
          </li>
        })}</ul>}
    </Section>

    {ending && <Modal title={L('আগের তারিখ বন্ধ করবেন?', 'Close the earlier dates?')} onClose={() => !busy && setEnding(null)}
      actions={<>
        <button type="button" className="secondary" disabled={busy} onClick={() => setEnding(null)}>{L('না, থাক', 'No, keep it')}</button>
        <button type="button" className="danger" disabled={busy} onClick={() => void doEnd()}>{busy ? L('হচ্ছে…', 'Working…') : L('হ্যাঁ, বন্ধ করুন', 'Yes, close')}</button>
      </>}>
      <p style={{ margin: 0 }}>{L('বন্ধ করলে স্টাফরা এই তারিখগুলো আর দিতে পারবেন না। যা দেওয়া হয়ে গেছে, তা হাব ম্যানেজারের অনুমোদনের অপেক্ষায় থাকবে।',
        'Staff can no longer give these dates. What was already given still waits for the hub manager.')}</p>
      <Field label={L('কারণ (ইচ্ছা হলে)', 'Reason (optional)')}><input value={endNote} maxLength={300} onChange={e => setEndNote(e.target.value)} /></Field>
      {endErr && <p className="da-error" role="alert">{endErr}</p>}
    </Modal>}
  </>
}
