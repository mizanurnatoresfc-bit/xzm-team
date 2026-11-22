import { useMemo, useState, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { usePrefs } from '../../lib/prefs'
import { monthOf, useLiveLoad, type IsoDate } from '../../lib/workforce'
import { BOOK_CODES, CODE_META, LIVE_BOOK, PAID_META, formatRows, mb, mbFriendly,
  type BookCode, type BookRules, type MbBook, type MbCell, type MbHistory, type MbItem, type MbPerson } from '../../lib/workforceBook'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { Empty, Loading, Notice, Section, Who, exportRows, fmtDay, fmtLong, fmtStamp, fmtWeekday, lastMonths, monthName, printRows } from './shared'
import '../../workforce-mbook.css'

/**
 * হাজিরা খাতা — the hub manager writes, for every person and date, one of the inputs:
 *   ১ হাবে উপস্থিত + অনলাইন হাজিরা · ২ হাবে উপস্থিত, অনলাইন হাজিরা হয়নি · লেট (সময়সহ)
 *   ৩ অনুপস্থিত — ওয়েবসাইটে আবেদন আছে (তারিখ থেকে–পর্যন্ত, নম্বর) · ৪ অনুপস্থিত — আবেদন নেই (কর্মী "এখুনি আবেদন করুন" নোটিশ পান)
 * then closes the day ("আজকের খাতা ক্লোজ") — after that only the zonal manager corrects it (with a reason), and a zonal
 * weekly / monthly submission locks it for everybody. Paid / unpaid follow the zone's setting. All rules live in the database (wf_mb_*).
 */
export function ManagerBookTab({ hubId, today, legacy }: { hubId: string; today: IsoDate; legacy?: ReactNode }) {
  const { L, n, lang } = usePrefs()
  const [month, setMonth] = useState<IsoDate>(monthOf(today))
  const [view, setView] = useState<'book' | 'staff'>('book')
  const q = useLiveLoad<MbBook>(() => mb.book(hubId, month), [hubId, month], LIVE_BOOK)
  const [panel, setPanel] = useState<{ date: IsoDate; only?: string } | null>(null)
  const [hist, setHist] = useState(false)
  const { toast, node } = useToast()
  const b = q.data
  const months = useMemo(() => lastMonths(today, 12), [today])

  if (view === 'staff' && legacy) return <>
    <p className="no-print"><button type="button" className="secondary sm" onClick={() => setView('book')}><Icon name="back" size={15} />{L('ম্যানেজারের হাজিরা খাতায় ফিরুন', 'Back to the manager’s book')}</button></p>
    {legacy}</>

  function exportXls(print = false) {
    if (!b) return
    const { heads, rows } = formatRows(b.rules.format ?? [], b.people.map(p => ({ ...p, hub_name: b.hub.name })), b.dates, lang)
    const title = L('হাজিরা খাতা', 'Attendance book'), sub = `${b.hub.name} · ${monthName(b.month, lang)}`
    if (print) printRows(title, sub, heads, rows)
    else exportRows(title, sub, heads, rows, `attendance-book-${b.hub.code ?? 'hub'}-${b.month.slice(0, 7)}`)
  }

  return <>
    {node}
    <Section title={L('হাজিরা খাতা', 'Attendance book')} tools={<>
      <Field label={L('মাস', 'Month')}><select value={month} onChange={e => setMonth(e.target.value)}>
        {months.map(m => <option key={m} value={m}>{monthName(m, lang)}</option>)}</select></Field>
      {b && <button type="button" className="secondary sm" onClick={() => exportXls()}><Icon name="xls" size={15} />{L('কোম্পানির ফরম্যাটে Excel', 'Excel (company format)')}</button>}
      {b && <button type="button" className="secondary sm" onClick={() => exportXls(true)}><Icon name="print" size={15} />{L('প্রিন্ট', 'Print')}</button>}
      {b && <button type="button" className="secondary sm" onClick={() => setHist(true)}><Icon name="log" size={15} />{L('সংশোধনের ইতিহাস', 'Change history')}</button>}
      {legacy && <button type="button" className="secondary sm" onClick={() => setView('staff')}><Icon name="users" size={15} />{L('কর্মীদের নিজের দেওয়া হাজিরা', 'What staff gave')}</button>}</>}
      hint={b ? <RulesLine r={b.rules} open={b.open} /> : undefined}>
      {q.error && !b ? <p className="da-error" role="alert">{mbFriendly(q.error)}</p> : null}
      {!b && !q.error ? <Loading /> : null}
      {b && <div className={q.loading || b.month !== month ? 'wm-stale' : ''}>
        <div className="wm-legend no-print" aria-label={L('চিহ্নের অর্থ', 'Legend')}>
          {BOOK_CODES.map(c => <span key={c} className="wm-lg"><i className={`wm-cell mini t-${CODE_META[c].tone}`}>{lang === 'bn' ? CODE_META[c].short : CODE_META[c].shortEn}</i>{lang === 'bn' ? CODE_META[c].bn : CODE_META[c].en}</span>)}
          <span className="wm-lg"><i className="wm-cell mini t-warn c-m">?</i>{L('লেখা বাকি', 'Not written')}</span>
          <span className="wm-lg"><i className="wm-cell mini t-ok mb-np">উ</i>{L('নন-পেইড দিন', 'Unpaid day')}</span>
          <span className="wm-lg"><Icon name="key" size={14} />{L('দিন ক্লোজ', 'Day closed')}</span>
        </div>
        <div className="da-stats wm-bsum">
          <Stat icon="check" tone="ok" label={L('উপস্থিত (অনলাইনসহ)', 'Present (online)')} value={n(b.totals.hub_online)} />
          <Stat icon="alert" tone={b.totals.hub_no_online ? 'warn' : undefined} label={L('অনলাইন হাজিরা হয়নি', 'No online attendance')} value={n(b.totals.hub_no_online)} />
          <Stat icon="clock" tone={b.totals.late ? 'warn' : undefined} label={L('লেট', 'Late')} value={n(b.totals.late)} />
          <Stat icon="cal" label={L('ছুটি (ওয়েবসাইট আবেদন)', 'Leave (website)')} value={n(b.totals.absent_site)} />
          <Stat icon="x" tone={b.totals.absent_no_site ? 'bad' : undefined} label={L('অনুপস্থিত, আবেদন নেই', 'Absent, no application')} value={n(b.totals.absent_no_site)} />
          <Stat icon="wallet" tone="ok" label={L('পেইড দিন', 'Paid days')} value={n(b.totals.paid_days)} />
          <Stat icon="wallet" tone={b.totals.unpaid_days ? 'bad' : undefined} label={L('নন-পেইড দিন', 'Unpaid days')} value={n(b.totals.unpaid_days)} />
          <Stat icon="alert" tone={b.totals.missing ? 'warn' : 'ok'} label={L('লেখা বাকি', 'Not written')} value={n(b.totals.missing)} />
        </div>
        {b.can.write && <TodayBar b={b} onOpen={d => setPanel({ date: d })} />}
        {!b.people.length ? <Empty>{L('এই হাবে কোনো কর্মী নেই।', 'No staff in this hub.')}</Empty> :
          <div className="wm-scroll wm-book" tabIndex={0} role="region" aria-label={L('হাজিরা খাতার ছক', 'Attendance book grid')}>
            <table className="wm-grid mb-grid">
              <thead><tr>
                <th scope="col" className="pri">{L('কর্মী', 'Person')}</th>
                {b.days.map(d => <th key={d.date} scope="col" className={d.date === b.today ? 'today' : ''}>
                  {d.future ? <span className="mb-dh"><b>{n(Number(d.date.slice(8)))}</b><small>{fmtWeekday(d.date, lang)}</small></span>
                    : <button type="button" className="mb-dh" onClick={() => setPanel({ date: d.date })}
                        aria-label={`${fmtLong(d.date, lang)} — ${d.closed ? L('ক্লোজ', 'closed') : L('খুলুন', 'open')}`}>
                      <b>{n(Number(d.date.slice(8)))}</b><small>{fmtWeekday(d.date, lang)}</small>
                      {d.submitted ? <i className="mb-st sub" title={L('জোনাল সাবমিট', 'Zonal submitted')}><Icon name="shield" size={12} /></i>
                        : d.closed ? <i className="mb-st cl" title={L('ক্লোজ', 'Closed')}><Icon name="key" size={12} /></i>
                        : d.missing ? <i className="mb-st ms">{n(d.missing)}</i> : <i className="mb-st ok"><Icon name="check" size={12} /></i>}
                    </button>}
                </th>)}
                <th scope="col" className="sum" title={L('উপস্থিত', 'Present')}>{L('উ', 'P')}</th>
                <th scope="col" className="sum" title={L('লেট', 'Late')}>{L('লে', 'L')}</th>
                <th scope="col" className="sum" title={L('অনুপস্থিত', 'Absent')}>{L('অ', 'A')}</th>
                <th scope="col" className="sum" title={L('পেইড দিন', 'Paid days')}>{L('পেইড', 'Paid')}</th>
                <th scope="col" className="sum" title={L('নন-পেইড দিন', 'Unpaid days')}>{L('নন-পেইড', 'Unpaid')}</th>
                <th scope="col" className="sum" title={L('লেখা বাকি', 'Not written')}>{L('বাকি', 'Due')}</th></tr></thead>
              <tbody>{b.people.map(p => <tr key={p.employee_id}>
                <th scope="row" className="pri"><Who name={p.name} code={p.code} position={p.position} /></th>
                {p.cells.map((c, i) => <td key={i} className={b.dates[i] === b.today ? 'today' : ''}>
                  <BookCell c={c} future={b.days[i]?.future} label={`${p.name}, ${fmtDay(b.dates[i], lang)}`} onClick={() => setPanel({ date: b.dates[i], only: p.employee_id })} /></td>)}
                <td className="sum">{n(p.sum.present)}</td><td className="sum warn">{n(p.sum.late)}</td><td className="sum bad">{n(p.sum.absent)}</td>
                <td className="sum ok">{n(p.sum.paid_days)}</td><td className="sum bad">{n(p.sum.unpaid_days)}</td><td className="sum warn">{n(p.sum.missing)}</td></tr>)}</tbody>
              <tfoot><tr>
                <th scope="row" className="pri">{L('মোট উপস্থিত', 'Present, total')}</th>
                {b.dates.map((d, i) => <td key={d} className={d === b.today ? 'today' : ''}>{n(b.people.filter(p => p.cells[i] && CODE_META[p.cells[i].c as BookCode]?.group === 'present').length)}</td>)}
                <td className="sum">{n(b.totals.present)}</td><td className="sum">{n(b.totals.late)}</td><td className="sum bad">{n(b.totals.absent)}</td>
                <td className="sum ok">{n(b.totals.paid_days)}</td><td className="sum bad">{n(b.totals.unpaid_days)}</td><td className="sum warn">{n(b.totals.missing)}</td></tr></tfoot>
            </table>
          </div>}
      </div>}
    </Section>
    {panel && b && <DayPanel hubId={hubId} date={panel.date} only={panel.only} rules={b.rules}
      people={b.people} index={b.dates.indexOf(panel.date)} day={b.days.find(d => d.date === panel.date) ?? null}
      canWrite={b.can.write} zonal={b.can.zonal} onClose={() => setPanel(null)}
      onDone={msg => { setPanel(null); void q.reload(); toast(msg) }} />}
    {hist && b && <HistoryModal hubId={hubId} month={b.month} onClose={() => setHist(false)} />}
  </>
}

/** "আজকের খাতা": how far today is, with one button into today's sheet. */
function TodayBar({ b, onOpen }: { b: MbBook; onOpen: (d: IsoDate) => void }) {
  const { L, n, lang } = usePrefs()
  const d = b.days.find(x => x.date === b.today)
  const open = b.days.filter(x => !x.future && !x.closed && !x.submitted)
  if (!d && !open.length) return null
  return <div className="mb-today no-print">
    {d && <div className="mb-today-t">
      <b>{L('আজকের খাতা', 'Today’s book')} · {fmtDay(d.date, lang)}</b>
      <span className="muted small">{d.submitted ? L('জোনাল ম্যানেজার সাবমিট করেছেন', 'Submitted by the zonal manager')
        : d.closed ? L(`ক্লোজ হয়েছে${d.closed_by_name ? ` — ${d.closed_by_name}` : ''}`, `Closed${d.closed_by_name ? ` by ${d.closed_by_name}` : ''}`)
        : d.missing ? L(`${n(d.entered)} জন লেখা হয়েছে, ${n(d.missing)} জন বাকি`, `${d.entered} written, ${d.missing} to go`)
        : L('সবার লেখা হয়েছে — এবার ক্লোজ করুন', 'Everyone is written — close the day')}</span></div>}
    {d && !d.closed && !d.submitted && <button type="button" onClick={() => onOpen(d.date)}><Icon name="edit" size={16} />{L('আজকের খাতা লিখুন / ক্লোজ', 'Write / close today')}</button>}
    {open.filter(x => x.date !== b.today).length > 0 && <span className="muted small">{L(`আরও ${n(open.filter(x => x.date !== b.today).length)} দিন ক্লোজ হয়নি — উপরে তারিখে ট্যাপ করুন`, `${open.filter(x => x.date !== b.today).length} more days not closed — tap a date above`)}</span>}
  </div>
}

export function RulesLine({ r, open }: { r: BookRules; open?: boolean }) {
  const { L, n } = usePrefs()
  const quota = Object.entries(r.paid ?? {}).filter(([, v]) => v === 'quota').map(([k]) => L(CODE_META[k as BookCode]?.bn ?? k, CODE_META[k as BookCode]?.en ?? k))
  return <>{open === false ? L('খাতা বন্ধ (আর্কাইভ বা জোনাল ম্যানেজার বন্ধ রেখেছেন) — শুধু দেখা ও জোনাল সংশোধন। ', 'The book is closed — view and zonal corrections only. ') : ''}
    {L(`খাতার দিন: প্রতি মাসের ${n(r.from_day)}–${n(r.to_day)} তারিখ। `, `Book days ${r.from_day}–${r.to_day} of the month. `)}
    {quota.length ? L(`${quota.join(', ')}: মাসে ${n(r.paid_leave_quota)} দিন পেইড, তারপর নন-পেইড। `, `${quota.join(', ')}: ${r.paid_leave_quota} paid days a month, then unpaid. `) : ''}
    {r.late_per_deduct ? L(`প্রতি ${n(r.late_per_deduct)}টি লেটে ১ দিন নন-পেইড। `, `Every ${r.late_per_deduct} lates = 1 unpaid day. `) : ''}
    {L('তারিখে ট্যাপ করে সবার হাজিরা একসাথে লিখুন, তারপর “খাতা ক্লোজ”। ক্লোজের পর শুধু জোনাল ম্যানেজার সংশোধন করেন।', 'Tap a date to write everyone, then close it. After closing only the zonal manager corrects.')}</>
}

/** One grid cell. */
export function BookCell({ c, future, label, onClick }: { c: MbCell; future?: boolean; label: string; onClick?: () => void }) {
  const { L, lang } = usePrefs()
  if (!c.b) return <span className="wm-cell f" aria-hidden="true">·</span>
  if (future) return <span className="wm-cell f" aria-hidden="true">·</span>
  const m = c.c ? CODE_META[c.c] : null
  const text = m ? (lang === 'bn' ? m.short : m.shortEn) : c.m ? '?' : '–'
  const cls = `wm-cell ${m ? `t-${m.tone}` : c.m ? 't-warn c-m' : 'c-c'}${c.c && c.p === false ? ' mb-np' : ''}${!c.c && c.sg ? ' mb-sg' : ''}`
  const what = m ? `${lang === 'bn' ? m.bn : m.en}${c.t ? ` ${c.t}` : ''}${c.p === false ? L(' · নন-পেইড', ' · unpaid') : ''}`
    : c.m ? L('লেখা বাকি', 'not written') : L('খালি', 'empty')
  const inner = <>{text}{c.c === 'late' && c.t ? <small className="mb-tm">{c.t}</small> : null}</>
  if (!onClick) return <span className={cls} title={what}>{inner}</span>
  return <button type="button" className={cls} title={what} aria-label={`${label}: ${what}`} onClick={onClick}>{inner}</button>
}

// ====================================================================================== one date, everyone (or one person)
type Draft = { code: BookCode | null; late_at: string; site_from: string; site_to: string; site_ref: string; note: string }
const fromCell = (c: MbCell | undefined, date: IsoDate): Draft => ({
  code: c?.c ?? null, late_at: c?.t ?? '', site_from: c?.sf ?? date, site_to: c?.st ?? date, site_ref: c?.ref ?? '', note: c?.n ?? '' })
const sameDraft = (a: Draft, b: Draft) => a.code === b.code && (a.code !== 'late' || a.late_at === b.late_at)
  && (a.code !== 'absent_site' || (a.site_from === b.site_from && a.site_to === b.site_to && a.site_ref.trim() === b.site_ref.trim())) && a.note.trim() === b.note.trim()
const MAIN: BookCode[] = ['hub_online', 'hub_no_online', 'late', 'absent_site', 'absent_no_site']

export function DayPanel({ hubId, date, only, rules, people, index, day, canWrite, zonal, onClose, onDone }: {
  hubId: string; date: IsoDate; only?: string; rules: BookRules; people: MbPerson[]; index: number
  day: { closed: boolean; submitted: boolean; closed_by_name?: string | null; closed_at?: string | null } | null
  canWrite: boolean; zonal: boolean; onClose: () => void; onDone: (msg: string) => void
}) {
  const { L, n, lang } = usePrefs()
  const [all, setAll] = useState(!only)
  const list = useMemo(() => people.filter(p => all || p.employee_id === only), [people, all, only])
  const start = useMemo(() => Object.fromEntries(people.map(p => [p.employee_id, fromCell(p.cells[index], date)])), [people, index, date])
  const [draft, setDraft] = useState<Record<string, Draft>>(start)
  const [reason, setReason] = useState(''); const [closeNote, setCloseNote] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const closed = !!day?.closed; const submitted = !!day?.submitted
  const editable = !submitted && (zonal || (canWrite && !closed))
  const needReason = closed && zonal
  const set = (id: string, patch: Partial<Draft>) => setDraft(d => ({ ...d, [id]: { ...d[id], ...patch } }))
  const changed = people.filter(p => draft[p.employee_id]?.code && !sameDraft(draft[p.employee_id], start[p.employee_id]))
  const mine = (p: MbPerson) => !!p.self && !zonal
  const left = people.filter(p => p.cells[index]?.m && !draft[p.employee_id]?.code && !mine(p))

  const fillRest = () => setDraft(d => { const x = { ...d }; for (const p of people) if (!x[p.employee_id].code && !mine(p) && p.cells[index]?.b) x[p.employee_id] = { ...x[p.employee_id], code: 'hub_online' }; return x })
  const fromStaff = () => setDraft(d => { const x = { ...d }; for (const p of people) { const c = p.cells[index]; if (!x[p.employee_id].code && c?.sg && !mine(p)) x[p.employee_id] = { ...x[p.employee_id], code: c.sg, site_ref: c.sr ?? '', note: c.sn ?? '' } } return x })
  const suggestions = people.filter(p => !draft[p.employee_id]?.code && p.cells[index]?.sg && !mine(p)).length

  function items(): MbItem[] {
    return changed.map(p => { const d = draft[p.employee_id]
      return { employee_id: p.employee_id, code: d.code as BookCode, late_at: d.code === 'late' ? d.late_at : null,
        site_from: d.code === 'absent_site' ? d.site_from : null, site_to: d.code === 'absent_site' ? d.site_to : null,
        site_ref: d.code === 'absent_site' ? d.site_ref.trim() || null : null, note: d.note.trim() || null } })
  }
  async function save(thenClose: boolean) {
    setBusy(true); setErr('')
    try {
      const it = items()
      if (it.length) await mb.set(hubId, date, it, needReason ? reason : null)
      if (thenClose) { await mb.close(hubId, date, closeNote); onDone(L('খাতা ক্লোজ ও সাবমিট হয়েছে — আর বদলানো যাবে না', 'The day is closed and submitted')) }
      else onDone(L(`${n(it.length)} জনের হাজিরা সেভ হয়েছে`, `${it.length} saved`))
    } catch (e) { setErr(mbFriendly(e)); setBusy(false); setConfirmClose(false) }
  }

  return <Modal wide title={`${L('হাজিরা খাতা', 'Attendance book')} · ${fmtLong(date, lang)}`} onClose={onClose}
    actions={<>
      <button type="button" className="secondary" onClick={onClose} disabled={busy}>{L('বন্ধ করুন', 'Close')}</button>
      {editable && <button type="button" className="secondary" disabled={busy || !changed.length || (needReason && !reason.trim())} onClick={() => void save(false)}>
        <Icon name="save" size={16} />{L(`সেভ (${n(changed.length)})`, `Save (${changed.length})`)}</button>}
      {editable && !closed && canWrite && <button type="button" disabled={busy} onClick={() => setConfirmClose(true)}><Icon name="key" size={16} />{L('খাতা ক্লোজ ও সাবমিট', 'Close & submit day')}</button>}
    </>}>
    {submitted ? <Notice>{L('জোনাল ম্যানেজার এই তারিখ সাবমিট করেছেন — আর বদলানো যায় না।', 'The zonal manager submitted this date — it can no longer change.')}</Notice>
      : closed ? <Notice>{L(`এই দিনের খাতা ক্লোজ হয়েছে${day?.closed_by_name ? ` (${day.closed_by_name}${day.closed_at ? `, ${fmtStamp(day.closed_at, lang)}` : ''})` : ''}।`, `This day is closed${day?.closed_by_name ? ` (${day.closed_by_name})` : ''}.`)}
          {zonal ? L(' আপনি জোনাল ম্যানেজার — কারণ লিখে সংশোধন করতে পারেন।', ' As zonal manager you may correct it with a reason.') : L(' এখন শুধু জোনাল ম্যানেজার সংশোধন করবেন।', ' Only the zonal manager corrects it now.')}</Notice>
      : !canWrite && !zonal ? <Notice>{L('এই হাবের খাতা লেখার অনুমতি আপনার নেই — শুধু দেখা।', 'You may only view this book.')}</Notice> : null}

    {editable && all && <div className="mb-quick">
      <button type="button" className="wm-chip" onClick={fillRest} disabled={!left.length}><Icon name="checkall" size={15} />{L(`বাকি সবাই: হাবে উপস্থিত + অনলাইন (${n(left.length)})`, `Rest: at hub + online (${left.length})`)}</button>
      {suggestions > 0 && <button type="button" className="wm-chip" onClick={fromStaff}><Icon name="users" size={15} />{L(`কর্মীদের নিজের দেওয়া থেকে নিন (${n(suggestions)})`, `Take what staff gave (${suggestions})`)}</button>}
      {only && <span className="muted small">{L('সবাই দেখানো হচ্ছে', 'Showing everyone')}</span>}
    </div>}
    {only && !all && <p><button type="button" className="link" onClick={() => setAll(true)}>{L('এই তারিখে সবাইকে দেখুন', 'Show everyone on this date')}</button></p>}

    <ul className="mb-rows">
      {list.map(p => {
        const d = draft[p.employee_id]; const c = p.cells[index]
        const lock = !editable || mine(p) || !c?.b
        return <li key={p.employee_id} className={`mb-row${d.code ? ` on t-${CODE_META[d.code].tone}` : c?.m ? ' miss' : ''}`}>
          <div className="mb-row-h"><Who name={p.name} code={p.code} position={p.position} />
            {c?.c && c.p === false && <Badge tone="bad">{L('নন-পেইড', 'Unpaid')}</Badge>}
            {c?.c && c.p && <Badge tone="ok">{L('পেইড', 'Paid')}</Badge>}
            {!c?.c && c?.sg && <Badge tone="info">{L('কর্মী দিয়েছেন: ', 'Staff gave: ')}{lang === 'bn' ? CODE_META[c.sg].bn : CODE_META[c.sg].en}</Badge>}
            {mine(p) && <span className="muted small">{L('নিজের হাজিরা জোনাল ম্যানেজার লিখবেন', 'Your own row is written by the zonal manager')}</span>}</div>
          <div className="mb-opts" role="radiogroup" aria-label={`${p.name}: ${L('হাজিরা', 'attendance')}`}>
            {(MAIN.concat(d.code && !MAIN.includes(d.code) ? [d.code] : [])).map(k => <button key={k} type="button" role="radio" aria-checked={d.code === k} disabled={lock}
              className={`mb-opt t-${CODE_META[k].tone}${d.code === k ? ' on' : ''}`} onClick={() => set(p.employee_id, { code: k, late_at: k === 'late' && !d.late_at ? rules.late_after || '' : d.late_at })}>
              <i>{lang === 'bn' ? CODE_META[k].short : CODE_META[k].shortEn}</i><span>{lang === 'bn' ? CODE_META[k].bn : CODE_META[k].en}</span></button>)}
            {!lock && <select className="mb-more" aria-label={L('অন্যান্য', 'Other')} value="" onChange={e => e.target.value && set(p.employee_id, { code: e.target.value as BookCode })}>
              <option value="">{L('অন্যান্য…', 'Other…')}</option>
              <option value="weekly_off">{L('সাপ্তাহিক ছুটি', 'Weekly off')}</option><option value="holiday">{L('সরকারি ছুটি', 'Holiday')}</option></select>}
          </div>
          {d.code === 'late' && <div className="mb-extra"><Field label={L('কখন এসেছেন', 'Came at')} required><input type="time" value={d.late_at} disabled={lock} onChange={e => set(p.employee_id, { late_at: e.target.value })} /></Field></div>}
          {d.code === 'absent_site' && <div className="mb-extra">
            <Field label={L('ওয়েবসাইটে আবেদন — থেকে', 'Website application — from')} required><input type="date" value={d.site_from} max={date} disabled={lock} onChange={e => set(p.employee_id, { site_from: e.target.value })} /></Field>
            <Field label={L('পর্যন্ত', 'to')} required><input type="date" value={d.site_to} min={date} disabled={lock} onChange={e => set(p.employee_id, { site_to: e.target.value })} /></Field>
            <Field label={L('আবেদন নম্বর', 'Application no.')}><input value={d.site_ref} maxLength={60} disabled={lock} onChange={e => set(p.employee_id, { site_ref: e.target.value })} /></Field></div>}
          {d.code === 'absent_no_site' && !lock && <p className="mb-warn small"><Icon name="bell" size={14} />{L('সেভ করলে কর্মী নোটিশ পাবেন: “ওয়েবসাইটে এখুনি ছুটির আবেদন করুন”', 'On save the person is told: “apply on the website now”')}</p>}
          {d.code && !lock && <details className="mb-note"><summary>{d.note ? L('নোট: ', 'Note: ') + d.note : L('নোট যোগ করুন', 'Add a note')}</summary>
            <textarea rows={2} maxLength={500} value={d.note} onChange={e => set(p.employee_id, { note: e.target.value })} /></details>}
        </li>
      })}
    </ul>
    {needReason && editable && <Field label={L('সংশোধনের কারণ (ক্লোজ হওয়া দিন)', 'Reason for correcting a closed day')} required>
      <textarea rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>}
    {err && <p className="da-error" role="alert">{err}</p>}
    {confirmClose && <Modal title={L('আজকের খাতা ক্লোজ ও সাবমিট?', 'Close and submit this day?')} onClose={() => !busy && setConfirmClose(false)}
      actions={<><button type="button" className="secondary" disabled={busy} onClick={() => setConfirmClose(false)}>{L('এখন না', 'Not now')}</button>
        <button type="button" disabled={busy} onClick={() => void save(true)}>{busy ? L('হচ্ছে…', 'Working…') : L('হ্যাঁ, ক্লোজ করুন', 'Yes, close')}</button></>}>
      <p>{L('ক্লোজ করলে এই তারিখের হাজিরা আপনি আর বদলাতে পারবেন না — দরকার হলে জোনাল ম্যানেজার কারণ লিখে সংশোধন করবেন।', 'After closing you can no longer change this date — the zonal manager corrects it if needed.')}</p>
      {left.length > 0 && <p className="da-error">{L(`এখনো ${n(left.length)} জনের হাজিরা লেখা বাকি: `, `${left.length} still not written: `)}{left.map(p => p.name).join(', ')}</p>}
      {changed.length > 0 && <p className="muted small">{L(`আগে ${n(changed.length)} জনের বদল সেভ হবে।`, `${changed.length} changes are saved first.`)}</p>}
      <Field label={L('নোট (ইচ্ছা হলে)', 'Note (optional)')}><input value={closeNote} maxLength={500} onChange={e => setCloseNote(e.target.value)} /></Field>
    </Modal>}
  </Modal>
}

// ====================================================================================== history
export function HistoryModal({ hubId, month, onClose }: { hubId: string; month: IsoDate; onClose: () => void }) {
  const { L, lang } = usePrefs()
  const h = useLoad<MbHistory[]>(() => mb.history(hubId, null, month), [hubId, month])
  const txt = (x: MbHistory['after'] | null) => !x ? '—' : `${lang === 'bn' ? CODE_META[x.code].bn : CODE_META[x.code].en}${x.late_at ? ` ${x.late_at}` : ''}${x.site_ref ? ` · ${x.site_ref}` : ''}`
  const ACT = { created: L('লেখা হয়েছে', 'Written'), changed: L('বদলেছে', 'Changed'), corrected: L('জোনাল সংশোধন', 'Zonal correction') }
  return <Modal wide title={`${L('সংশোধনের ইতিহাস', 'Change history')} · ${monthName(month, lang)}`} onClose={onClose}
    actions={<button type="button" className="secondary" onClick={onClose}>{L('বন্ধ করুন', 'Close')}</button>}>
    {h.loading && !h.data ? <Loading /> : h.error ? <p className="da-error">{mbFriendly(h.error)}</p> : !h.data?.length ? <Empty>{L('এখনো কিছু নেই।', 'Nothing yet.')}</Empty> :
      <ol className="mb-hist">{h.data.map(x => <li key={x.id}>
        <b>{x.employee_name}</b> · {fmtDay(x.work_date, lang)} · <Badge tone={x.action === 'corrected' ? 'warn' : 'neutral'}>{ACT[x.action]}</Badge>
        <div className="small">{txt(x.before)} → <b>{txt(x.after)}</b></div>
        <div className="muted small">{x.by_name ?? '—'} · {fmtStamp(x.at, lang)}{x.reason ? ` — ${x.reason}` : ''}</div></li>)}</ol>}
  </Modal>
}

export const paidText = (k: string, lang: 'bn' | 'en') => { const m = PAID_META[k as keyof typeof PAID_META]; return m ? (lang === 'bn' ? m.bn : m.en) : k }
