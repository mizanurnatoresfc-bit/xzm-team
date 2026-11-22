import { useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { usePrefs } from '../../lib/prefs'
import { useLiveLoad, type IsoDate } from '../../lib/workforce'
import { todayDhaka } from '../../lib/dailyAccounts'
import { BOOK_CODES, CODE_META, FORMAT_CATALOG, LIVE_BOOK, PAID_META, formatRows, mb, mbFriendly,
  type BookRules, type FormatCol, type MbSheet, type MbSubmission, type PaidRule } from '../../lib/workforceBook'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { Empty, Loading, Notice, Section, Who, exportRows, fmtDay, fmtStamp, fmtWeekday, lastMonths, monthEnd, monthName, monthStart, printRows } from './shared'
import { BookCell, DayPanel, RulesLine } from './ManagerBook'
import '../../workforce-mbook.css'

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const weekStartOf = (iso: string, ws: number) => { const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); return addDays(iso, -((dow - ws + 7) % 7)) }

/**
 * জোনাল প্যানেল — হাজিরা খাতা: everyone of the zone by name and date (all hubs), corrections, weekly / monthly submission,
 * the export in the company's format. Reads wf_mb_sheet; every rule is the database's.
 */
export function ZoneBookSheet({ zone }: { zone: string }) {
  const { L, n, lang } = usePrefs()
  const today = todayDhaka()
  const [mode, setMode] = useState<'month' | 'week'>('month')
  const [month, setMonth] = useState(monthStart(today))
  const [week, setWeek] = useState(weekStartOf(today, 6))
  const [hub, setHub] = useState('')
  const from = mode === 'month' ? month : week
  const to = mode === 'month' ? (monthEnd(month) < today ? monthEnd(month) : today) : addDays(week, 6)
  const q = useLiveLoad<MbSheet>(() => mb.sheet(zone || null, hub || null, from, to < from ? from : to), [zone, hub, from, to], LIVE_BOOK)
  const s = q.data
  const [panel, setPanel] = useState<{ hub: string; date: IsoDate } | null>(null)
  const [submit, setSubmit] = useState(false)
  const { toast, node } = useToast()
  const months = useMemo(() => lastMonths(today, 6), [today])
  const shown = s ? s.people.filter(p => !hub || p.hub_id === hub) : []

  function exportXls(print = false) {
    if (!s) return
    const { heads, rows } = formatRows(s.rules.format ?? [], shown, s.dates, lang)
    const title = L('হাজিরা খাতা — জোন', 'Attendance book — zone'), sub = `${s.zone?.name ?? L('সব জোন', 'All zones')} · ${fmtDay(s.from, lang)} – ${fmtDay(s.to, lang)}`
    if (print) printRows(title, sub, heads, rows); else exportRows(title, sub, heads, rows, `zone-attendance-${s.from}`)
  }

  return <>
    {node}
    <Section title={L('হাজিরা খাতা — নাম ও তারিখ অনুযায়ী', 'Attendance book — by name and date')} tools={<>
      <Field label={L('সময়', 'Period')}><select value={mode} onChange={e => setMode(e.target.value as 'month' | 'week')}>
        <option value="month">{L('মাসিক', 'Monthly')}</option><option value="week">{L('সাপ্তাহিক', 'Weekly')}</option></select></Field>
      {mode === 'month' ? <Field label={L('মাস', 'Month')}><select value={month} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={m} value={m}>{monthName(m, lang)}</option>)}</select></Field>
        : <Field label={L('সপ্তাহ শুরু', 'Week from')}><input type="date" value={week} max={today} onChange={e => e.target.value && setWeek(e.target.value)} /></Field>}
      {s && s.hubs.length > 1 && <Field label={L('হাব', 'Hub')}><select value={hub} onChange={e => setHub(e.target.value)}><option value="">{L('সব হাব', 'All hubs')}</option>
        {s.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>}
      {s && <button type="button" className="secondary sm" onClick={() => exportXls()}><Icon name="xls" size={15} />{L('কোম্পানির ফরম্যাটে Excel', 'Excel (company format)')}</button>}
      {s && <button type="button" className="secondary sm" onClick={() => exportXls(true)}><Icon name="print" size={15} />{L('প্রিন্ট', 'Print')}</button>}
      {s?.can.submit && <button type="button" className="sm" onClick={() => setSubmit(true)}><Icon name="shield" size={15} />{mode === 'month' ? L('মাসিক সাবমিট', 'Submit month') : L('সাপ্তাহিক সাবমিট', 'Submit week')}</button>}</>}
      hint={s ? <RulesLine r={s.rules} /> : L('জোন বাছলে সাবমিট করা যায়।', 'Pick a zone to submit.')}>
      {!zone && <Notice>{L('সাবমিট ও সংশোধনের জন্য উপরে একটি জোন বাছুন।', 'Choose one zone above to submit or correct.')}</Notice>}
      {q.error && !s ? <p className="da-error" role="alert">{mbFriendly(q.error)}</p> : null}
      {!s && !q.error ? <Loading /> : null}
      {s && <div className={q.loading ? 'wm-stale' : ''}>
        <div className="da-stats wm-bsum">
          <Stat icon="users" label={L('কর্মী', 'People')} value={n(shown.length)} />
          <Stat icon="check" tone="ok" label={L('উপস্থিত', 'Present')} value={n(s.totals.present)} />
          <Stat icon="clock" label={L('লেট', 'Late')} value={n(s.totals.late)} />
          <Stat icon="cal" label={L('ছুটি (ওয়েবসাইট)', 'Leave (website)')} value={n(s.totals.absent_site)} />
          <Stat icon="x" tone={s.totals.absent_no_site ? 'bad' : undefined} label={L('অনুপস্থিত, আবেদন নেই', 'Absent, no application')} value={n(s.totals.absent_no_site)} />
          <Stat icon="wallet" tone="ok" label={L('পেইড দিন', 'Paid days')} value={n(s.totals.paid_days)} />
          <Stat icon="wallet" tone={s.totals.unpaid_days ? 'bad' : undefined} label={L('নন-পেইড দিন', 'Unpaid days')} value={n(s.totals.unpaid_days)} />
          <Stat icon="alert" tone={s.totals.missing ? 'warn' : 'ok'} label={L('লেখা বাকি', 'Not written')} value={n(s.totals.missing)} />
        </div>
        {s.submissions.length > 0 && <p className="mb-subline"><Icon name="shield" size={15} />{s.submissions.map(x => `${x.kind === 'week' ? L('সাপ্তাহিক', 'Week') : L('মাসিক', 'Month')} ${fmtDay(x.date_from, lang)} – ${fmtDay(x.date_to, lang)} ${L('সাবমিট', 'submitted')}${x.by_name ? ` (${x.by_name})` : ''}`).join(' · ')}</p>}
        <div className="mb-hubs">{s.hubs.map(h => <span key={h.id} className={`wm-dpill${h.missing ? ' mb-miss' : ''}`}>{h.name} <small>{L(`${n(h.people)} জন · বাকি ${n(h.missing)} · ক্লোজ ${n(h.closed.length)} দিন`, `${h.people} · due ${h.missing} · closed ${h.closed.length}d`)}</small></span>)}</div>
        {!shown.length ? <Empty>{L('কেউ নেই।', 'Nobody.')}</Empty> :
          <div className="wm-scroll wm-book" tabIndex={0} role="region" aria-label={L('জোনের হাজিরা খাতা', 'Zone attendance book')}>
            <table className="wm-grid mb-grid">
              <thead><tr><th scope="col" className="pri">{L('কর্মী', 'Person')}</th>
                {s.dates.map(d => <th key={d} scope="col" className={d === s.today ? 'today' : ''}><b>{n(Number(d.slice(8)))}</b><small>{fmtWeekday(d, lang)}</small></th>)}
                <th className="sum">{L('উ', 'P')}</th><th className="sum">{L('লে', 'L')}</th><th className="sum">{L('অ', 'A')}</th>
                <th className="sum">{L('পেইড', 'Paid')}</th><th className="sum">{L('নন-পেইড', 'Unpaid')}</th><th className="sum">{L('বাকি', 'Due')}</th></tr></thead>
              <tbody>{shown.map(p => <tr key={p.employee_id}>
                <th scope="row" className="pri"><Who name={p.name} code={p.code} position={[p.position, p.hub_name].filter(Boolean).join(' · ')} /></th>
                {p.cells.map((c, i) => <td key={i} className={s.dates[i] === s.today ? 'today' : ''}>
                  <BookCell c={c} future={s.dates[i] > s.today} label={`${p.name}, ${fmtDay(s.dates[i], lang)}`}
                    onClick={p.hub_id ? () => setPanel({ hub: p.hub_id!, date: s.dates[i] }) : undefined} /></td>)}
                <td className="sum">{n(p.sum.present)}</td><td className="sum warn">{n(p.sum.late)}</td><td className="sum bad">{n(p.sum.absent)}</td>
                <td className="sum ok">{n(p.sum.paid_days)}</td><td className="sum bad">{n(p.sum.unpaid_days)}</td><td className="sum warn">{n(p.sum.missing)}</td></tr>)}</tbody>
            </table></div>}
      </div>}
    </Section>
    {panel && s && (() => {
      const i = s.dates.indexOf(panel.date)
      const h = s.hubs.find(x => x.id === panel.hub)
      const sub = s.submissions.some(x => panel.date >= x.date_from && panel.date <= x.date_to)
      return <DayPanel hubId={panel.hub} date={panel.date} rules={s.rules} index={i}
        people={s.people.filter(p => p.hub_id === panel.hub)}
        day={{ closed: !!h?.closed.includes(panel.date), submitted: sub }}
        canWrite={false} zonal={s.can.correct} onClose={() => setPanel(null)} onDone={m => { setPanel(null); void q.reload(); toast(m) }} />
    })()}
    {submit && s && zone && <SubmitDialog zone={zone} kind={mode} from={from} sheet={s} onClose={() => setSubmit(false)}
      onDone={() => { setSubmit(false); void q.reload(); toast(L('খাতা সাবমিট হয়েছে', 'Submitted')) }} />}
    <Submissions zone={zone} />
  </>
}

function SubmitDialog({ zone, kind, from, sheet, onClose, onDone }: { zone: string; kind: 'week' | 'month'; from: IsoDate; sheet: MbSheet; onClose: () => void; onDone: () => void }) {
  const { L, n, lang } = usePrefs()
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const go = async () => { setBusy(true); setErr(''); try { await mb.submit(zone, kind, from, note); onDone() } catch (e) { setErr(mbFriendly(e)); setBusy(false) } }
  return <Modal title={kind === 'week' ? L('সাপ্তাহিক খাতা সাবমিট', 'Submit the week') : L('মাসিক খাতা সাবমিট', 'Submit the month')} onClose={onClose}
    actions={<><button type="button" className="secondary" onClick={onClose} disabled={busy}>{L('এখন না', 'Not now')}</button>
      <button type="button" disabled={busy || sheet.totals.missing > 0} onClick={() => void go()}>{busy ? L('হচ্ছে…', 'Working…') : L('সাবমিট করুন', 'Submit')}</button></>}>
    <p>{kind === 'week' ? L(`${fmtDay(from, lang)} থেকে ৭ দিন`, `7 days from ${fmtDay(from, lang)}`) : L(`${monthName(from, lang)} — খাতার দিনগুলো`, `${monthName(from, lang)} — the book days`)}</p>
    <p>{L(`পেইড ${n(sheet.totals.paid_days)} দিন · নন-পেইড ${n(sheet.totals.unpaid_days)} দিন · লেট ${n(sheet.totals.late)}`, `Paid ${sheet.totals.paid_days} · unpaid ${sheet.totals.unpaid_days} · late ${sheet.totals.late}`)}</p>
    {sheet.totals.missing > 0 && <p className="da-error">{L(`এখনো ${n(sheet.totals.missing)}টি হাজিরা লেখা বাকি — আগে ঘরে ট্যাপ করে সংশোধন করে পূরণ করুন।`, `${sheet.totals.missing} inputs are missing — fill them first.`)}</p>}
    <p className="muted small">{L('সাবমিটের পর এই তারিখগুলো কেউ বদলাতে পারবে না (হাবের খোলা দিনগুলোও ক্লোজ হবে); হেড অফিস কারণ লিখে খুলে দিতে পারে।', 'After submitting nobody can change these dates; head office may reopen with a reason.')}</p>
    <Field label={L('নোট (ইচ্ছা হলে)', 'Note (optional)')}><input value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></Field>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

function Submissions({ zone }: { zone: string }) {
  const { L, lang } = usePrefs()
  const q = useLoad<MbSubmission[]>(() => mb.submissions(zone || null), [zone])
  const [reopen, setReopen] = useState<MbSubmission | null>(null)
  const [note, setNote] = useState(''); const [err, setErr] = useState('')
  async function download(x: MbSubmission) {
    try {
      const full = (await mb.submissions(null, x.id))[0]?.snapshot
      if (!full) return
      const { heads, rows } = formatRows(full.rules.format ?? [], full.people, full.dates, lang)
      exportRows(L('জমা দেওয়া হাজিরা খাতা', 'Submitted attendance book'), `${x.zone_name ?? ''} · ${fmtDay(x.date_from, lang)} – ${fmtDay(x.date_to, lang)}`, heads, rows, `submitted-${x.date_from}`)
    } catch (e) { setErr(mbFriendly(e)) }
  }
  if (!q.data?.length) return null
  return <Section title={L('সাবমিট করা খাতা', 'Submitted books')} hint={L('যা পাঠানো হয়েছিল ঠিক সেভাবেই রাখা আছে।', 'Kept exactly as sent.')}>
    {err && <p className="da-error">{err}</p>}
    <ul className="mb-subs">{q.data.map(x => <li key={x.id}>
      <b>{x.kind === 'week' ? L('সাপ্তাহিক', 'Week') : L('মাসিক', 'Month')} · {fmtDay(x.date_from, lang)} – {fmtDay(x.date_to, lang)}</b> {x.zone_name ? <span className="muted">· {x.zone_name}</span> : null}
      {x.reopened_at ? <Badge tone="warn">{L('খুলে দেওয়া হয়েছে', 'Reopened')}</Badge> : <Badge tone="ok">{L('সাবমিট', 'Submitted')}</Badge>}
      <div className="muted small">{x.by_name ?? '—'} · {fmtStamp(x.submitted_at, lang)} · {L('পেইড', 'Paid')} {x.totals.paid_days} · {L('নন-পেইড', 'Unpaid')} {x.totals.unpaid_days}{x.reopen_note ? ` — ${x.reopen_note}` : ''}</div>
      <div className="wm-acts"><button type="button" className="secondary sm" onClick={() => void download(x)}><Icon name="xls" size={14} />Excel</button>
        {!x.reopened_at && <button type="button" className="secondary sm" onClick={() => { setReopen(x); setNote(''); setErr('') }}>{L('খুলে দিন (হেড অফিস)', 'Reopen (head office)')}</button>}</div></li>)}</ul>
    {reopen && <Modal title={L('সাবমিট খুলে দিন', 'Reopen submission')} onClose={() => setReopen(null)}
      actions={<><button type="button" className="secondary" onClick={() => setReopen(null)}>{L('থাক', 'Cancel')}</button>
        <button type="button" disabled={!note.trim()} onClick={() => void mb.reopen(reopen.id, note).then(() => { setReopen(null); void q.reload() }, e => setErr(mbFriendly(e)))}>{L('খুলে দিন', 'Reopen')}</button></>}>
      <Field label={L('কেন খুলছেন?', 'Why?')} required><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      {err && <p className="da-error">{err}</p>}
    </Modal>}
  </Section>
}

// ====================================================================================== setting
/** হাজিরা খাতা সেটিং: book days, open or not, paid / unpaid per input, paid leave quota, late rule, export format — per zone, or the company default. */
export function ZoneBookSettings({ zone }: { zone: string }) {
  const { L, n, lang } = usePrefs()
  const [target, setTarget] = useState<string>(zone)   // '' = company default
  const q = useLoad(() => mb.rules(target || null), [target])
  const p = q.data
  const [r, setR] = useState<BookRules | null>(null)
  const [fmt, setFmt] = useState<FormatCol[] | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const { toast, node } = useToast()
  const cur = r ?? p?.effective ?? null
  const curFmt = fmt ?? p?.effective.format ?? []
  const can = !!p?.can_configure
  const upd = (patch: Partial<BookRules>) => cur && setR({ ...cur, ...patch })
  async function save(reset = false) {
    if (!cur) return
    setBusy(true); setErr('')
    try {
      const { from_day, to_day, open, paid, paid_leave_quota, late_per_deduct, late_after, week_start } = cur
      await mb.saveRules(target || null, reset ? {} : { from_day, to_day, open, paid, paid_leave_quota, late_per_deduct, late_after, week_start }, reset ? null : fmt, reset)
      setR(null); setFmt(null); await q.reload(); toast(L('সেটিং সেভ হয়েছে', 'Setting saved'))
    } catch (e) { setErr(mbFriendly(e)) } finally { setBusy(false) }
  }
  const unused = FORMAT_CATALOG.filter(c => !curFmt.some(f => f.key === c.key))
  const moveFmt = (i: number, d: number) => { const x = [...curFmt]; const j = i + d; if (j < 0 || j >= x.length) return; [x[i], x[j]] = [x[j], x[i]]; setFmt(x) }

  return <Section title={L('হাজিরা খাতা সেটিং', 'Attendance book setting')} hint={L('খাতা মাসে কোন দিনগুলো খোলা থাকবে, কোন ইনপুট পেইড/নন-পেইড, পেইড ছুটি কত দিন, লেটের নিয়ম আর কোম্পানির এক্সপোর্ট ফরম্যাট। জোনের নিজের মান না থাকলে কোম্পানির ডিফল্ট চলে।',
    'Book days, paid / unpaid per input, paid leave, late rule and the export format. A zone without its own values follows the company default.')}>
    {node}
    <Field label={L('কার সেটিং', 'Setting for')}><select value={target} onChange={e => { setTarget(e.target.value); setR(null); setFmt(null) }}>
      {p?.can_company || !zone ? <option value="">{L('কোম্পানি ডিফল্ট (সব জোন)', 'Company default')}</option> : null}
      {(p?.zones ?? []).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
    {q.error && !p ? <p className="da-error">{mbFriendly(q.error)}</p> : !cur ? <Loading /> : <>
      {!can && <Notice>{L('শুধু দেখা — বদলানোর অনুমতি নেই।', 'View only.')}</Notice>}
      {target && p?.own ? <p className="muted small">{L('এই জোনের নিজের সেটিং আছে', 'This zone has its own setting')}{p.own.by_name ? ` — ${p.own.by_name}, ${fmtStamp(p.own.updated_at, lang)}` : ''}</p>
        : target ? <p className="muted small">{L('এই জোন কোম্পানির ডিফল্ট মানছে।', 'This zone follows the company default.')}</p> : null}
      <fieldset className="mb-set" disabled={!can || busy}>
        <legend>{L('খাতা কত দিন খোলা', 'Book days')}</legend>
        <label className="mb-switch"><input type="checkbox" checked={cur.open} onChange={e => upd({ open: e.target.checked })} />{L('খাতা খোলা রাখুন (বন্ধ করলে হাব ম্যানেজার লিখতে পারবেন না)', 'Keep the book open (off: hub managers cannot write)')}</label>
        <div className="mb-set-row">
          <Field label={L('প্রথম দিন', 'First day')}><input type="number" min={1} max={28} value={cur.from_day} onChange={e => upd({ from_day: Number(e.target.value) })} /></Field>
          <Field label={L('শেষ দিন', 'Last day')} hint={L('৩১ = পুরো মাস', '31 = whole month')}><input type="number" min={1} max={31} value={cur.to_day} onChange={e => upd({ to_day: Number(e.target.value) })} /></Field>
          <Field label={L('সপ্তাহ শুরু', 'Week starts')}><select value={cur.week_start} onChange={e => upd({ week_start: Number(e.target.value) })}>
            {['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'].map((d, i) => <option key={i} value={i}>{lang === 'bn' ? d : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}</option>)}</select></Field>
        </div>
        <p className="muted small">{L(`প্রতি মাসে ${n(cur.from_day)}–${n(cur.to_day)} তারিখ = ${n(Math.max(0, cur.to_day - cur.from_day + 1))} দিন খাতায় থাকবে।`, `${Math.max(0, cur.to_day - cur.from_day + 1)} days a month.`)}</p>
      </fieldset>
      <fieldset className="mb-set" disabled={!can || busy}>
        <legend>{L('পেইড / নন-পেইড হিসাব', 'Paid / unpaid')}</legend>
        <table className="mb-paid"><tbody>{BOOK_CODES.map(c => <tr key={c}><th scope="row"><i className={`wm-cell mini t-${CODE_META[c].tone}`}>{lang === 'bn' ? CODE_META[c].short : CODE_META[c].shortEn}</i> {lang === 'bn' ? CODE_META[c].bn : CODE_META[c].en}</th>
          <td><select value={cur.paid[c]} aria-label={CODE_META[c].bn} onChange={e => upd({ paid: { ...cur.paid, [c]: e.target.value as PaidRule } })}>
            {(['paid', 'unpaid', 'quota'] as PaidRule[]).map(v => <option key={v} value={v}>{lang === 'bn' ? PAID_META[v].bn : PAID_META[v].en}</option>)}</select></td></tr>)}</tbody></table>
        <div className="mb-set-row">
          <Field label={L('মাসে পেইড ছুটি (দিন)', 'Paid leave a month (days)')} hint={L('“পেইড ছুটির কোটা থেকে” ইনপুট তারিখের ক্রমে এই কয়দিন পেইড, তারপর নন-পেইড', 'Quota inputs are paid for this many days, then unpaid')}>
            <input type="number" min={0} max={31} value={cur.paid_leave_quota} onChange={e => upd({ paid_leave_quota: Number(e.target.value) })} /></Field>
          <Field label={L('কয়টি লেটে ১ দিন নন-পেইড', 'Lates per unpaid day')} hint={L('০ = বন্ধ', '0 = off')}><input type="number" min={0} max={31} value={cur.late_per_deduct} onChange={e => upd({ late_per_deduct: Number(e.target.value) })} /></Field>
          <Field label={L('লেট ধরা হবে', 'Late after')}><input type="time" value={cur.late_after} onChange={e => upd({ late_after: e.target.value })} /></Field>
        </div>
      </fieldset>
      <fieldset className="mb-set" disabled={!can || busy}>
        <legend>{L('কোম্পানির নির্ধারিত ফরম্যাট (Excel / প্রিন্ট)', 'Company export format')}</legend>
        <ol className="mb-fmt">{curFmt.map((f, i) => <li key={f.key}>
          <span className="mb-fmt-k">{FORMAT_CATALOG.find(c => c.key === f.key)?.[lang] ?? f.key}</span>
          {f.key !== 'days' && <input aria-label={L('কলামের নাম', 'Column heading')} value={f.label} maxLength={80} placeholder={FORMAT_CATALOG.find(c => c.key === f.key)?.[lang]}
            onChange={e => setFmt(curFmt.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />}
          <button type="button" className="secondary sm" aria-label={L('উপরে', 'Up')} onClick={() => moveFmt(i, -1)}>↑</button>
          <button type="button" className="secondary sm" aria-label={L('নিচে', 'Down')} onClick={() => moveFmt(i, 1)}>↓</button>
          <button type="button" className="secondary sm" aria-label={L('সরান', 'Remove')} onClick={() => setFmt(curFmt.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button></li>)}</ol>
        {unused.length > 0 && <Field label={L('কলাম যোগ করুন', 'Add a column')}><select value="" onChange={e => e.target.value && setFmt([...curFmt, { key: e.target.value, label: '' }])}>
          <option value="">{L('বাছুন…', 'Choose…')}</option>{unused.map(c => <option key={c.key} value={c.key}>{c[lang]}</option>)}</select></Field>}
      </fieldset>
      {err && <p className="da-error" role="alert">{err}</p>}
      {can && <div className="wm-acts">
        {target && p?.own && <button type="button" className="secondary" disabled={busy} onClick={() => void save(true)}>{L('কোম্পানির ডিফল্টে ফিরুন', 'Back to company default')}</button>}
        <button type="button" disabled={busy || (!r && !fmt)} onClick={() => void save()}><Icon name="save" size={16} />{L('সেভ করুন', 'Save')}</button></div>}
    </>}
  </Section>
}

