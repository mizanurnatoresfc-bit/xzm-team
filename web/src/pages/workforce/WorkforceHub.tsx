import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell, refreshShellCounts } from '../../components/AppShell'
import { Contact } from '../../components/Contact'
import { Icon } from '../../components/Icon'
import { todayDhaka } from '../../lib/dailyAccounts'
import { usePrefs } from '../../lib/prefs'
import { ACTION_META, APP_META, CELL_META, LIVE, monthOf, useLiveLoad, wf, wfFriendly,
  type AbsenceApp, type AppStatus, type BookCell, type CellCode, type Can, type Decided, type History, type HubBook, type HubBookPerson, type HubOverview, type HubPerson,
  type IsoDate, type Mark, type MarkStatus, type OpsReport, type OpsTotals } from '../../lib/workforce'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { AS_OPTIONS, ChipTabs, Empty, KindBadge, LiveDot, Loading, MarkBadge, NoteDialog, Notice, RangeBar, Section, Who, WmTable, decideMarks, exportRows,
  fmtDay, fmtLong, fmtStamp, fmtTime, fmtTsDay, fmtWeekday, lastMonths, monthName, prevMonth, recordLabel, rememberHub, siteDetail, siteText, storedHub, toneOfRecord, useHubList, useRange,
  type WCol } from './shared'

/**
 * হাজিরা বই ও দৈনিক রিপোর্ট — the hub manager's panel (one hub at a time).
 * Everything comes from the shared tables through the wf_* functions (row security + permission scope are decided in the database);
 * this screen only shows what `can` allows. Reloads by itself when anything changes (LIVE.manage).
 */
type TabKey = 'today' | 'book' | 'approve' | 'apps' | 'ops' | 'history'
const TAB_KEYS: TabKey[] = ['today', 'book', 'approve', 'apps', 'ops', 'history']
const isTab = (t: string | null): t is TabKey => !!t && (TAB_KEYS as string[]).includes(t)

export function WorkforceHub() {
  const { L, n, lang } = usePrefs()
  const { can: auth } = useAuth()
  const [sp, setSp] = useSearchParams()
  const hubsQ = useHubList()
  const hubs = useMemo(() => hubsQ.data?.hubs ?? [], [hubsQ.data])
  const want = sp.get('hub') || storedHub()
  const hubId = hubs.find(h => h.id === want)?.id ?? hubs[0]?.id ?? ''
  const hub = hubs.find(h => h.id === hubId) ?? null
  useEffect(() => { if (hubId) rememberHub(hubId) }, [hubId])
  const ovQ = useLiveLoad<HubOverview | null>(() => hubId ? wf.hubOverview(hubId) : Promise.resolve(null), [hubId], LIVE.manage)
  const ov = ovQ.data && ovQ.data.hub.id === hubId ? ovQ.data : null
  const can = ov?.can
  const today = ov?.date ?? todayDhaka()

  const visible: Record<TabKey, boolean> = { today: true, book: !!can?.attendance, approve: !!can?.attendance, apps: !!can?.attendance, ops: !!can?.ops, history: !!can?.attendance }
  const asked = sp.get('tab')
  const tab: TabKey = isTab(asked) && (visible[asked] || !ov) ? asked : 'today'
  const blocked = !!ov && isTab(asked) && !visible[asked]
  const go = (t: TabKey) => setSp(p => { const q = new URLSearchParams(p); q.set('tab', t); return q }, { replace: true })
  const pickHub = (id: string) => { rememberHub(id); refreshShellCounts(); setSp(p => { const q = new URLSearchParams(p); q.set('hub', id); return q }, { replace: true }) }

  const tabs: Array<{ key: TabKey; label: string; count?: number; tone?: 'warn' | 'bad' }> = [
    { key: 'today', label: L('আজ', 'Today') },
    { key: 'book', label: L('হাজিরা বই', 'Attendance book') },
    { key: 'approve', label: L('অনুমোদন', 'Approvals'), count: ov?.pending.marks },
    { key: 'apps', label: L('আবেদন', 'Applications'), count: ov?.pending.applications },
    { key: 'ops', label: L('দৈনিক রিপোর্ট', 'Daily report') },
    { key: 'history', label: L('ইতিহাস', 'History') },
  ]
  const shown = tabs.filter(t => visible[t.key])
  const reload = () => void ovQ.reload()

  return <AppShell title={L('হাজিরা বই ও দৈনিক রিপোর্ট', 'Attendance book & daily report')}
    subtitle={hub ? `${hub.name} · ${fmtLong(today, lang)}` : undefined}>
    <div className="wm">
      <section className="panel wm-top no-print">
        <Field label={L('হাব', 'Hub')}>
          <select value={hubId} onChange={e => pickHub(e.target.value)} disabled={!hubs.length}>
            {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
        <div className="wm-top-r">
          <LiveDot on={ovQ.live} />
          {auth('zonal.dashboard.view') && <Link to="/app/workforce/zone" className="wm-lnk"><Icon name="chart" size={16} />{L('সব হাবের জোনাল রিপোর্ট', 'Zonal report (all hubs)')}</Link>}
        </div>
      </section>

      {hubsQ.error ? <p className="da-error" role="alert">{wfFriendly(hubsQ.error)}</p> : null}
      {hubsQ.data && !hubs.length ? <Notice>{L('আপনার দেখার মতো কোনো হাব নেই।', 'There is no hub you can see.')}</Notice> : null}
      {ovQ.error && !ov ? <p className="da-error" role="alert">{wfFriendly(ovQ.error)}</p> : null}
      {hubId && !ov && !ovQ.error ? <Loading /> : null}

      {ov && can && <>
        {tab !== 'approve' && can.attendance && ov.pending.marks > 0 &&
          <button type="button" className="wm-alert" onClick={() => go('approve')}><Icon name="alert" size={20} />
            <span><b>{L(`${n(ov.pending.marks)}টি হাজিরা অনুমোদনের অপেক্ষায়`, `${ov.pending.marks} attendance inputs wait for approval`)}</b></span><Icon name="chev" size={18} /></button>}
        {tab !== 'apps' && can.attendance && ov.pending.applications > 0 &&
          <button type="button" className="wm-alert" onClick={() => go('apps')}><Icon name="form" size={20} />
            <span><b>{L(`${n(ov.pending.applications)}টি অনুপস্থিতির আবেদন সিদ্ধান্তের অপেক্ষায়`, `${ov.pending.applications} absence applications wait for a decision`)}</b></span><Icon name="chev" size={18} /></button>}
        {blocked && <Notice>{L('এই অংশ দেখার অনুমতি আপনার নেই — আজকের অংশ দেখানো হচ্ছে।', 'You may not open that part — showing today instead.')}</Notice>}

        <ChipTabs tabs={shown} value={tab} onChange={go} label={L('হাজিরা বিভাগ', 'Sections')} />

        <div key={`${hubId}-${tab}`}>
          {tab === 'today' && <TodayTab ov={ov} hubId={hubId} go={go} reload={reload} />}
          {tab === 'book' && <BookTab hubId={hubId} can={can} today={today} go={go} />}
          {tab === 'approve' && <ApproveTab hubId={hubId} can={can} go={go} onChanged={reload} />}
          {tab === 'apps' && <AppsTab hubId={hubId} can={can} onChanged={reload} />}
          {tab === 'ops' && <OpsTab hubId={hubId} />}
          {tab === 'history' && <HistoryTab hubId={hubId} today={today} />}
        </div>
      </>}
    </div>
  </AppShell>
}

// ====================================================================================== আজ
type PF = 'all' | 'missing' | 'waiting' | 'absent' | 'present'
type PState = 'present' | 'absent' | 'off' | 'waiting' | 'returned' | 'missing'
const personState = (p: HubPerson): PState => {
  const r = p.record_status
  if (r === 'present' || r === 'late' || r === 'half_day') return 'present'
  if (r === 'absent') return 'absent'
  if (r) return 'off'
  if (p.mark_status === 'waiting') return 'waiting'
  if (p.mark_status === 'rejected') return 'returned'
  return 'missing'
}

function TodayTab({ ov, hubId, go, reload }: { ov: HubOverview; hubId: string; go: (t: TabKey) => void; reload: () => void }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const [q, setQ] = useState(''); const [f, setF] = useState<PF>('all')
  const [tap, setTap] = useState<{ marks: Mark[] } | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const a = ov.attendance; const o = ov.ops
  const att = ov.can.attendance

  const states = useMemo(() => ov.people.map(p => [p, personState(p)] as const), [ov.people])
  const count = (k: PF) => states.filter(([, s]) => k === 'all' ? true : k === 'missing' ? s === 'missing' || s === 'returned' : k === 'present' ? s === 'present' : s === k).length
  const word = q.trim().toLowerCase()
  const list = states.filter(([p, s]) => (f === 'all' || (f === 'missing' ? s === 'missing' || s === 'returned' : f === 'present' ? s === 'present' : s === f))
    && (!word || `${p.name} ${p.code ?? ''} ${p.position ?? ''} ${p.mobile ?? ''}`.toLowerCase().includes(word)))

  async function openOneTap() {
    setErr(''); setBusy(true)
    try { const marks = await wf.marks({ hub: hubId }, prevMonth(ov.date), ov.date, 'waiting'); setTap({ marks }) }
    catch (e) { setErr(wfFriendly(e)) } finally { setBusy(false) }
  }
  const rest = tap ? tap.marks.filter(m => !m.application_id) : []
  const inApp = tap ? tap.marks.length - rest.length : 0
  async function confirmOneTap() {
    setBusy(true); setErr('')
    const r = await decideMarks(rest, 'given')
    setBusy(false)
    if (r.failed.length) { setErr(L(`${n(r.done)}টি অনুমোদিত হয়েছে। বাকিগুলো হয়নি: ${r.failed.join('; ')}`, `${r.done} approved. The rest failed: ${r.failed.join('; ')}`)); reload(); return }
    setTap(null); toast(L(`${n(r.done)}টি হাজিরা অনুমোদিত হয়েছে`, `${r.done} approved`)); reload()
  }

  const chip = (k: PF, bn: string, en: string) => <button key={k} type="button" className={`wm-chip${f === k ? ' on' : ''}`} aria-pressed={f === k} onClick={() => setF(k)}>
    {L(bn, en)}<b className="plain">{n(count(k))}</b></button>

  return <>
    {node}
    {att && <Section title={L('আজকের হাজিরা', "Today's attendance")} hint={fmtLong(ov.date, lang)}
      tools={att && ov.can.decide && ov.pending.marks > 0 ? <button type="button" disabled={busy} onClick={() => void openOneTap()}><Icon name="checkall" size={16} />{L(`সব অপেক্ষমাণ অনুমোদন (${n(ov.pending.marks)})`, `Approve all waiting (${ov.pending.marks})`)}</button> : undefined}>
      {err && !tap ? <p className="da-error" role="alert">{err}</p> : null}
      <div className="da-stats">
        <Stat icon="users" label={L('মোট কর্মী', 'Staff')} value={n(ov.staff_total)} />
        {att && <>
          <Stat icon="check" tone="ok" label={L('উপস্থিত', 'Present')} value={n(a.present)} />
          <Stat icon="clock" tone={a.late ? 'warn' : undefined} label={L('দেরি', 'Late')} value={n(a.late)} />
          <Stat icon="clock" label={L('অর্ধদিবস', 'Half day')} value={n(a.half_day)} />
          <Stat icon="x" tone={a.absent ? 'bad' : undefined} label={L('অনুপস্থিত', 'Absent')} value={n(a.absent)} />
          <Stat icon="cal" label={L('ছুটি', 'Leave')} value={n(a.leave)} />
          <Stat icon="alert" tone={a.not_given ? 'warn' : 'ok'} label={L('হাজিরা বাকি', 'Not given')} value={n(a.not_given)} />
          <Stat icon="log" tone={ov.pending.marks ? 'warn' : undefined} label={L('অনুমোদনের অপেক্ষায়', 'Waiting approval')} value={n(ov.pending.marks)} />
          <Stat icon="form" tone={ov.pending.applications ? 'warn' : undefined} label={L('আবেদন অপেক্ষায়', 'Applications waiting')} value={n(ov.pending.applications)} /></>}
      </div>
    </Section>}

    {o && <Section title={L('আজকের পিকআপ · রিটার্ন · ডেলিভারি', "Today's pickup · return · delivery")} tools={<button type="button" className="secondary sm" onClick={() => go('ops')}>{L('বিস্তারিত রিপোর্ট', 'Full report')}</button>}>
      <div className="da-stats">
        {!att && <Stat icon="users" label={L('মোট কর্মী', 'Staff')} value={n(ov.staff_total)} />}
        <Stat icon="box" label={L('পিকআপ', 'Pickup')} value={n(o.pickup)} />
        <Stat icon="swap" label={L('পিকআপ রিটার্ন', 'Pickup return')} value={n(o.pickup_return)} />
        <Stat icon="truck" label={L('ডেলিভারি', 'Delivery')} value={n(o.delivery)} />
        <Stat icon="swap" label={L('ডেলিভারি রিটার্ন', 'Delivery return')} value={n(o.delivery_return)} />
        <Stat icon="usercheck" tone={o.missing ? 'warn' : 'ok'} label={L('সাবমিট করেছেন', 'Submitted')} value={`${n(o.submitted)}/${n(o.submitted + o.missing)}`}
          sub={o.missing ? L(`${n(o.missing)} জন বাকি`, `${o.missing} still to give`) : L('সবাই দিয়েছেন', 'Everyone gave')} />
      </div>
    </Section>}

    <Section title={L('কর্মীদের আজকের অবস্থা', 'Where everyone stands today')}>
      <div className="wm-filters no-print">
        {att && <div className="wm-chips" role="group" aria-label={L('ফিল্টার', 'Filter')}>
          {chip('all', 'সবাই', 'All')}{chip('missing', 'বাকি', 'Not given')}{chip('waiting', 'অপেক্ষায়', 'Waiting')}{chip('absent', 'অনুপস্থিত', 'Absent')}{chip('present', 'উপস্থিত', 'Present')}</div>}
        <input type="search" className="wm-search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('নাম, আইডি বা মোবাইল খুঁজুন…', 'Search name, ID or mobile…')} aria-label={L('খুঁজুন', 'Search')} />
      </div>
      {!list.length ? <Empty>{ov.people.length ? L('এই ফিল্টারে কেউ নেই।', 'No one matches.') : L('এই হাবে কোনো সক্রিয় কর্মী নেই।', 'No active staff in this hub.')}</Empty> :
        <ul className="wm-people">{list.map(([p, s]) => <li key={p.employee_id} className={`wm-prow s-${s}`}>
          <Who name={p.name} code={p.code} position={p.position} />
          <span className="wm-pst">
            {!att ? null : s === 'present' || s === 'absent' || s === 'off' ? <Badge tone={toneOfRecord(p.record_status)}>{recordLabel(p.record_status, lang)}</Badge>
              : s === 'waiting' ? <Badge tone="info">{L('দিয়েছেন', 'Given')}{p.mark_kind ? ` · ${p.mark_kind === 'present' ? L('উপস্থিত', 'present') : L('অনুপস্থিত', 'absent')}` : ''} · {L('অপেক্ষায়', 'waiting')}</Badge>
                : s === 'returned' ? <Badge tone="bad">{L('ফেরত — আবার দেবেন', 'Returned')}</Badge> : <Badge tone="warn">{L('বাকি', 'Not given')}</Badge>}
            {p.ops_submitted !== null && <Badge tone={p.ops_submitted ? 'ok' : 'neutral'}>{p.ops_submitted ? L('হিসাব দিয়েছেন', 'Numbers given') : L('হিসাব বাকি', 'Numbers due')}</Badge>}
          </span>
          <Contact phone={p.mobile} showNumber={false} text={s === 'missing' ? L('আজকের হাজিরা দিন', 'Please give today’s attendance') : undefined} />
        </li>)}</ul>}
    </Section>

    {tap && <Modal title={L('সব অপেক্ষমাণ অনুমোদন', 'Approve all waiting')} onClose={() => setTap(null)} actions={<>
      <button type="button" className="secondary" onClick={() => setTap(null)}>{L('বাতিল', 'Cancel')}</button>
      <button type="button" disabled={busy || !rest.length} onClick={() => void confirmOneTap()}>{L(`অনুমোদন দিন (${n(rest.length)})`, `Approve (${rest.length})`)}</button></>}>
      {rest.length ? <>
        <p>{L('কর্মী যেমন দিয়েছেন তেমনই খাতায় উঠবে:', 'Each goes on the register as the person gave it:')}</p>
        <ul className="wm-sum">
          <li><b>{n(rest.filter(m => m.kind === 'present').length)}</b> {L('জন — উপস্থিত', '— present')}</li>
          <li><b>{n(rest.filter(m => m.kind === 'absent').length)}</b> {L('জন — অনুপস্থিত (ওয়েবসাইটে আবেদন করা আছে)', '— absent (applied on the website)')}</li></ul></>
        : <p>{L('এখানে অনুমোদনের মতো আলাদা হাজিরা নেই।', 'Nothing here to approve on its own.')}</p>}
      {inApp > 0 && <p className="muted small">{L(`${n(inApp)}টি তারিখ অনুপস্থিতির আবেদনের সাথে — সেগুলোতে “আবেদন” অংশ থেকে সিদ্ধান্ত দিন।`, `${inApp} dates belong to absence applications — decide those under Applications.`)}</p>}
      {err ? <p className="da-error" role="alert">{err}</p> : null}
    </Modal>}
  </>
}

// ====================================================================================== হাজিরা বই
const CELL_LABEL: Record<CellCode, [string, string]> = {
  P: ['উপস্থিত', 'Present'], L: ['দেরিতে', 'Late'], H: ['অর্ধদিবস', 'Half day'], A: ['অনুপস্থিত', 'Absent'], V: ['ছুটি', 'Leave'], O: ['সাপ্তাহিক / সরকারি ছুটি', 'Weekly off / holiday'],
  w: ['কর্মী দিয়েছেন — অনুমোদনের অপেক্ষায়', 'Given — waiting'], r: ['ফেরত দেওয়া হয়েছে', 'Returned'], m: ['এখনো দেননি', 'Not given'], f: ['তারিখ আসেনি', 'Not yet'], c: ['বন্ধ — কিছু দেননি', 'Closed, nothing given'],
}
const LEGEND: CellCode[] = ['P', 'L', 'H', 'A', 'V', 'O', 'w', 'r', 'm', 'c']
const PRESENT_CELLS: CellCode[] = ['P', 'L', 'H']

function BookTab({ hubId, can, today, go }: { hubId: string; can: Can; today: IsoDate; go: (t: TabKey) => void }) {
  const { L, n, lang } = usePrefs()
  const [month, setMonth] = useState<IsoDate>(monthOf(today))
  const q = useLiveLoad<HubBook>(() => wf.hubBook(hubId, month), [hubId, month], LIVE.manage)
  const [sheet, setSheet] = useState<{ p: HubBookPerson; i: number } | null>(null)
  const { toast, node } = useToast()
  const b = q.data
  const months = useMemo(() => lastMonths(today, 12), [today])
  const stale = !!b && b.month !== month

  const present = (p: HubBookPerson, i: number) => PRESENT_CELLS.includes(p.cells[i]?.s)
  function excel() {
    if (!b) return
    const heads = [L('আইডি', 'ID'), L('নাম', 'Name'), ...b.dates.map(d => d.slice(8).replace(/^0/, '')), L('উপস্থিত', 'Present'), L('দেরি', 'Late'), L('অর্ধদিবস', 'Half day'), L('অনুপস্থিত', 'Absent'), L('ছুটি', 'Leave'), L('অপেক্ষায়', 'Waiting'), L('ফেরত', 'Returned'), L('বাকি', 'Missing')]
    const rows = b.people.map(p => [p.code, p.name, ...p.cells.map(c => CELL_META[c.s].en), p.summary.present, p.summary.late, p.summary.half_day, p.summary.absent, p.summary.leave, p.summary.waiting, p.summary.returned, p.summary.missing])
    exportRows(L('হাজিরা বই', 'Attendance book'), `${b.hub.name} · ${monthName(b.month, lang)}`, heads, rows, `attendance-${b.hub.code ?? 'hub'}-${b.month.slice(0, 7)}`)
  }

  return <>
    {node}
    <Section title={L('হাজিরা বই', 'Attendance book')} tools={<>
      <Field label={L('মাস (আর্কাইভ)', 'Month (archive)')}><select value={month} onChange={e => setMonth(e.target.value)}>
        {months.map(m => <option key={m} value={m}>{monthName(m, lang)}</option>)}</select></Field>
      {b && <button type="button" className="secondary sm" onClick={excel}><Icon name="xls" size={15} />{L('এক্সেল', 'Excel')}</button>}</>}
      hint={b ? (b.catch_up ? L(`জোনাল ম্যানেজার আগের তারিখ খুলে দিয়েছেন — ${fmtDay(b.catch_up.date_from, lang)} থেকে ${fmtDay(b.catch_up.date_to, lang)}, ${fmtDay(b.catch_up.open_until, lang)} পর্যন্ত কর্মীরা দিতে পারবেন। যা আসবে, অনুমোদন তালিকায় পাবেন।`,
          `The zonal manager opened earlier dates — ${fmtDay(b.catch_up.date_from, lang)} to ${fmtDay(b.catch_up.date_to, lang)}, until ${fmtDay(b.catch_up.open_until, lang)}. Inputs arrive in the approval list.`)
        : b.open ? L(`বই খোলা আছে — প্রতি মাসের ${n(b.window.from_day)}–${n(b.window.to_day)} তারিখ পর্যন্ত কর্মীরা নিজে দেন। ঘরে ট্যাপ করলে বিস্তারিত।`, `The book is open (days ${b.window.from_day}–${b.window.to_day}). Tap a cell for details.`)
        : L('এই মাসের বই বন্ধ (আর্কাইভ) — দেখা যায়, দরকারে সংশোধন করা যায়। ঘরে ট্যাপ করলে বিস্তারিত।', 'This month is closed (archive) — corrections still possible. Tap a cell.')) : undefined}>
      {q.error && !b ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
      {!b && !q.error ? <Loading /> : null}
      {b && <div className={stale || q.loading ? 'wm-stale' : ''}>
        <div className="wm-legend no-print" aria-label={L('চিহ্নের অর্থ', 'Legend')}>
          {LEGEND.map(c => <span key={c} className="wm-lg"><i className={`wm-cell mini t-${CELL_META[c].tone}`}>{lang === 'bn' ? CELL_META[c].bn : CELL_META[c].en}</i>{lang === 'bn' ? CELL_LABEL[c][0] : CELL_LABEL[c][1]}</span>)}</div>
        <div className="da-stats wm-bsum">
          <Stat icon="check" tone="ok" label={L('উপস্থিত', 'Present')} value={n(b.totals.present)} />
          <Stat icon="clock" label={L('দেরি / অর্ধদিবস', 'Late / half day')} value={`${n(b.totals.late)} / ${n(b.totals.half_day)}`} />
          <Stat icon="x" tone={b.totals.absent ? 'bad' : undefined} label={L('অনুপস্থিত', 'Absent')} value={n(b.totals.absent)} />
          <Stat icon="log" tone={b.totals.waiting + b.totals.returned ? 'warn' : undefined} label={L('অপেক্ষায় / ফেরত', 'Waiting / returned')} value={`${n(b.totals.waiting)} / ${n(b.totals.returned)}`} />
          <Stat icon="alert" tone={b.totals.missing ? 'warn' : undefined} label={L('এখনো বাকি', 'Missing')} value={n(b.totals.missing)} />
        </div>
        {!b.people.length ? <Empty>{L('এই হাবে কোনো কর্মী নেই।', 'No staff in this hub.')}</Empty> :
          <div className="wm-scroll wm-book" tabIndex={0} role="region" aria-label={L('হাজিরা বইয়ের ছক', 'Attendance grid')}>
            <table className="wm-grid">
              <thead><tr>
                <th scope="col" className="pri">{L('কর্মী', 'Person')}</th>
                {b.dates.map(d => <th key={d} scope="col" className={d === b.today ? 'today' : ''}><b>{n(Number(d.slice(8)))}</b><small>{fmtWeekday(d, lang)}</small></th>)}
                <th scope="col" className="sum" title={L('উপস্থিত', 'Present')}>{L('উ', 'P')}</th><th scope="col" className="sum" title={L('দেরি', 'Late')}>{L('দে', 'L')}</th>
                <th scope="col" className="sum" title={L('অনুপস্থিত', 'Absent')}>{L('অ', 'A')}</th><th scope="col" className="sum" title={L('বাকি', 'Missing')}>{L('বাকি', 'Due')}</th></tr></thead>
              <tbody>{b.people.map(p => <tr key={p.employee_id}>
                <th scope="row" className="pri"><Who name={p.name} code={p.code} position={p.position} /></th>
                {p.cells.map((c, i) => <td key={i} className={b.dates[i] === b.today ? 'today' : ''}>{cellButton(p, c, i)}</td>)}
                <td className="sum">{n(p.summary.present)}</td><td className="sum">{n(p.summary.late)}</td><td className="sum bad">{n(p.summary.absent)}</td>
                <td className="sum warn">{n(p.summary.missing + p.summary.returned)}</td></tr>)}</tbody>
              <tfoot><tr>
                <th scope="row" className="pri">{L('মোট উপস্থিত', 'Present, total')}</th>
                {b.dates.map((d, i) => <td key={d} className={d === b.today ? 'today' : ''}>{n(b.people.filter(p => present(p, i)).length)}</td>)}
                <td className="sum">{n(b.totals.present)}</td><td className="sum">{n(b.totals.late)}</td><td className="sum bad">{n(b.totals.absent)}</td><td className="sum warn">{n(b.totals.missing + b.totals.returned)}</td></tr></tfoot>
            </table>
          </div>}
      </div>}
    </Section>
    {sheet && b && <DaySheet hubId={hubId} can={can} person={sheet.p} date={b.dates[sheet.i]} cell={sheet.p.cells[sheet.i]} go={go}
      onClose={() => setSheet(null)} onChanged={msg => { setSheet(null); void q.reload(); toast(msg) }} />}
  </>

  function cellButton(p: HubBookPerson, c: BookCell, i: number) {
    const m = CELL_META[c.s]; const label = lang === 'bn' ? m.bn : m.en
    if (c.s === 'f') return <span className="wm-cell t-neutral f" aria-hidden="true">{label}</span>
    return <button type="button" className={`wm-cell t-${m.tone} c-${c.s}`} aria-label={`${p.name}, ${fmtDay(b!.dates[i], lang)}: ${lang === 'bn' ? CELL_LABEL[c.s][0] : CELL_LABEL[c.s][1]}`}
      onClick={() => setSheet({ p, i })}>{label}</button>
  }
}

/** One person on one date: what they gave, the website answer, the application, the history — and approve / return / correct when allowed. */
function DaySheet({ hubId, can, person, date, cell, go, onClose, onChanged }: {
  hubId: string; can: Can; person: HubBookPerson; date: IsoDate; cell: BookCell; go: (t: TabKey) => void; onClose: () => void; onChanged: (msg: string) => void
}) {
  const { L, n, lang } = usePrefs()
  const d = useLoad(async () => {
    const [marks, hist, apps] = await Promise.all([
      wf.marks({ hub: hubId }, date, date),
      wf.history({ hub: hubId, employee: person.employee_id }, monthOf(date), 100).catch(() => [] as History[]),
      wf.applications({ hub: hubId }, null, monthOf(date)).catch(() => [] as AbsenceApp[]),
    ])
    const mark = marks.find(m => m.id === cell.id) ?? marks.find(m => m.employee_id === person.employee_id) ?? null
    return { mark, hist: hist.filter(h => h.work_date === date), app: mark?.application_id ? apps.find(a => a.id === mark.application_id) ?? null : null }
  }, [hubId, person.employee_id, date])
  const mark = d.data?.mark ?? null
  const [mode, setMode] = useState<'return' | 'correct' | null>(null)
  const [as, setAs] = useState<Decided>('present'); const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); setErr(''); try { await fn(); onChanged(msg) } catch (e) { setErr(wfFriendly(e)); setBusy(false) } }
  const tone = CELL_META[cell.s].tone

  return <Modal title={person.name} onClose={onClose} actions={<button type="button" className="secondary" onClick={onClose}>{L('বন্ধ করুন', 'Close')}</button>}>
    <p className="wm-sheet-sub"><span className="muted small">{fmtLong(date, lang)}{person.code ? ` · ${n(person.code)}` : ''}</span>
      <Badge tone={tone}>{lang === 'bn' ? CELL_LABEL[cell.s][0] : CELL_LABEL[cell.s][1]}</Badge></p>
    {d.loading && !d.data ? <Loading /> : d.error ? <p className="da-error" role="alert">{wfFriendly(d.error)}</p> : <>
      {mark ? <dl className="wm-dl">
        <dt>{L('কর্মী যা দিয়েছেন', 'What the person gave')}</dt><dd><KindBadge k={mark.kind} /> <MarkBadge s={mark.status} /></dd>
        {mark.kind === 'absent' && <><dt>{L('ওয়েবসাইটে আবেদন', 'Website application')}</dt><dd>{mark.applied_on_site === true ? `${L('হ্যাঁ, করা আছে', 'Yes')}${siteDetail(mark, lang) ? ` · ${siteDetail(mark, lang)}` : ''}` : mark.applied_on_site === false ? L('না — এখান থেকে আবেদন পাঠিয়েছেন', 'No — applied here') : '—'}</dd></>}
        {mark.note && <><dt>{L('কর্মীর কথা', 'Their note')}</dt><dd>{mark.note}</dd></>}
        <dt>{L('কখন দিয়েছেন', 'Given at')}</dt><dd>{fmtStamp(mark.marked_at, lang)} · {mark.via === 'book' ? L('হাজিরা বই থেকে', 'from the book') : L('আজকের এক ট্যাপে', 'one tap')}</dd>
        {mark.status !== 'waiting' && <><dt>{L('সিদ্ধান্ত', 'Decision')}</dt><dd>{mark.decided_as ? recordLabel(mark.decided_as, lang) : MARK_TEXT(mark.status, lang)}{mark.decided_by_name ? ` · ${mark.decided_by_name}` : ''}{mark.decided_at ? ` · ${fmtStamp(mark.decided_at, lang)}` : ''}</dd></>}
        {mark.decide_note && <><dt>{L('ম্যানেজারের কথা', 'Manager’s note')}</dt><dd>{mark.decide_note}</dd></>}
        {d.data?.app && <><dt>{L('আবেদন', 'Application')}</dt><dd><b>{d.data.app.application_no}</b> · <Badge tone={APP_META[d.data.app.status].tone}>{lang === 'bn' ? APP_META[d.data.app.status].bn : APP_META[d.data.app.status].en}</Badge></dd></>}
        {!d.data?.app && mark.application_no && <><dt>{L('আবেদন', 'Application')}</dt><dd><b>{mark.application_no}</b></dd></>}
      </dl> : <p className="muted">{cell.s === 'm' || cell.s === 'c' || cell.s === 'r' ? L('কর্মী এই তারিখে কিছু দেননি।', 'The person gave nothing for this date.')
        : L('এই তারিখের হাজিরা সরাসরি খাতায় লেখা — কর্মীর নিজের দেওয়া কিছু নেই।', 'This date was written on the register directly — nothing was given by the person.')}</p>}
      {mark?.record_status && <p className="small muted">{L('খাতায় আছে:', 'On the register:')} <b>{recordLabel(mark.record_status, lang)}</b></p>}

      {mark && mark.status === 'waiting' && can.decide && (mark.application_id
        ? <div className="wm-act-box"><p className="muted small">{L('এটি অনুপস্থিতির আবেদনের তারিখ — আবেদন একসাথে অনুমোদন বা বাতিল হয়।', 'This date belongs to an application — it is decided with the application.')}</p>
          <button type="button" className="secondary" onClick={() => { onClose(); go('apps') }}>{L('আবেদন অংশে যান', 'Go to applications')}</button></div>
        : <div className="wm-act-box">
          <b>{L('অনুমোদন দিন:', 'Approve as:')}</b>
          <div className="wm-chips">{AS_OPTIONS.map(o => <button key={o.key} type="button" className="wm-chip" disabled={busy}
            onClick={() => void run(async () => { const r = await decideMarks([mark], o.key); if (r.failed.length) throw new Error(r.failed[0]) }, L('অনুমোদন হয়েছে', 'Approved'))}>{L(o.bn, o.en)}</button>)}</div>
          <button type="button" className="danger" disabled={busy} onClick={() => setMode('return')}>{L('ফেরত দিন…', 'Return…')}</button></div>)}
      {mark && mark.status === 'waiting' && !can.decide && <Notice>{L('অনুমোদন দেওয়ার অনুমতি আপনার নেই।', 'You may not approve.')}</Notice>}

      {mark && mark.status === 'approved' && can.correct && <div className="wm-act-box">
        {mode !== 'correct' ? <button type="button" className="secondary" onClick={() => { setMode('correct'); setAs((mark.decided_as ?? 'present') as Decided) }}><Icon name="edit" size={16} />{L('সংশোধন করুন', 'Correct')}</button> : <>
          <b>{L('সংশোধন — কী হবে?', 'Correct to:')}</b>
          <div className="wm-chips">{AS_OPTIONS.map(o => <button key={o.key} type="button" className={`wm-chip${as === o.key ? ' on' : ''}`} aria-pressed={as === o.key} onClick={() => setAs(o.key)}>{L(o.bn, o.en)}</button>)}</div>
          <Field label={L('কারণ লিখুন', 'Reason')} required><textarea rows={2} value={why} onChange={e => setWhy(e.target.value)} /></Field>
          <div className="wm-acts"><button type="button" className="secondary" onClick={() => setMode(null)}>{L('থাক', 'Not now')}</button>
            <button type="button" disabled={busy || !why.trim()} onClick={() => void run(() => wf.correct(mark.id, as, why.trim()), L('সংশোধন হয়েছে', 'Corrected'))}>{L('সংশোধন সেভ করুন', 'Save correction')}</button></div></>}</div>}
      {mark && mark.status === 'approved' && !can.correct && <p className="muted small">{L('সংশোধনের অনুমতি আপনার নেই।', 'You may not correct this.')}</p>}

      {!mark && can.decide && cell.s !== 'f' && <p className="wm-act-box"><Link to="/app/hub/attendance" className="wm-lnk" onClick={onClose}><Icon name="cal" size={16} />{L('হাব হাজিরা খাতায় লিখুন', 'Write it in the hub register')}</Link></p>}

      {err ? <p className="da-error" role="alert">{err}</p> : null}
      {(d.data?.hist.length ?? 0) > 0 && <div className="wm-hist"><b>{L('এই তারিখের ইতিহাস', 'History of this date')}</b>
        <ol>{d.data!.hist.map(h => <li key={h.id}><span className="wm-ha">{lang === 'bn' ? ACTION_META[h.action].bn : ACTION_META[h.action].en}</span>
          <span>{h.by_name ?? '—'} · {fmtStamp(h.at, lang)}{h.to_as ? ` · ${recordLabel(h.to_as, lang)}` : ''}{h.note ? ` — ${h.note}` : ''}</span></li>)}</ol></div>}
    </>}
    {mode === 'return' && mark && <NoteDialog title={L('ফেরত দিন', 'Return it')} label={L('কেন ফেরত দিচ্ছেন?', 'Why is it returned?')} confirm={L('ফেরত দিন', 'Return')} danger
      hint={L('কর্মী আবার দিতে পারবেন।', 'The person can give it again.')} onClose={() => setMode(null)}
      onConfirm={async note => { const r = await decideMarks([mark], 'given', false, note); if (r.failed.length) throw new Error(r.failed[0]); onChanged(L('ফেরত দেওয়া হয়েছে', 'Returned')) }} />}
  </Modal>
}
const MARK_TEXT = (s: MarkStatus, lang: 'bn' | 'en') => s === 'rejected' ? (lang === 'bn' ? 'ফেরত' : 'Returned') : s === 'approved' ? (lang === 'bn' ? 'অনুমোদিত' : 'Approved') : (lang === 'bn' ? 'অপেক্ষায়' : 'Waiting')

// ====================================================================================== অনুমোদন
function ApproveTab({ hubId, can, go, onChanged }: { hubId: string; can: Can; go: (t: TabKey) => void; onChanged: () => void }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const [status, setStatus] = useState<MarkStatus>('waiting')
  const r = useRange('open')
  const q = useLiveLoad<Mark[]>(() => wf.marks({ hub: hubId }, r.from, r.to, status), [hubId, r.from, r.to, status], LIVE.manage)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [back, setBack] = useState<Mark[] | null>(null)
  const rows = useMemo(() => [...(q.data ?? [])].sort((a, b) => status === 'waiting' ? a.work_date.localeCompare(b.work_date) || a.full_name.localeCompare(b.full_name) : b.work_date.localeCompare(a.work_date) || a.full_name.localeCompare(b.full_name)), [q.data, status])
  const pickable = rows.filter(m => m.status === 'waiting' && !m.application_id)
  const chosen = pickable.filter(m => sel.has(m.id))
  useEffect(() => { setSel(s => { const keep = new Set([...s].filter(id => pickable.some(m => m.id === id))); return keep.size === s.size ? s : keep }) }, [q.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setSel(s => { const t = new Set(s); if (t.has(id)) t.delete(id); else t.add(id); return t })

  async function approve(ms: Mark[], as: Decided | 'given') {
    if (!ms.length) return
    setBusy(true); setErr('')
    const res = await decideMarks(ms, as)
    setBusy(false)
    if (res.failed.length) setErr(L(`${n(res.done)}টি অনুমোদিত হয়েছে। বাকিগুলো হয়নি: ${res.failed.join('; ')}`, `${res.done} approved. The rest failed: ${res.failed.join('; ')}`))
    else toast(L(`${n(res.done)}টি হাজিরা অনুমোদিত হয়েছে`, `${res.done} approved`))
    setSel(new Set()); void q.reload(); onChanged()
  }

  const cols: Array<WCol<Mark>> = [
    { key: 'ck', label: L('বাছুন', 'Select'), cls: 'ck', cell: m => m.status === 'waiting' && !m.application_id && can.decide
      ? <label className="wm-ck"><input type="checkbox" checked={sel.has(m.id)} onChange={() => toggle(m.id)} aria-label={L(`${m.full_name} বাছুন`, `Select ${m.full_name}`)} /></label> : null },
    { key: 'who', label: L('কর্মী', 'Person'), primary: true, sort: true, text: m => m.full_name, cell: m => <Who name={m.full_name} code={m.employee_code} position={m.position} /> },
    { key: 'date', label: L('তারিখ', 'Date'), sort: true, text: m => m.work_date, cell: m => <span className="wm-dt"><b>{fmtDay(m.work_date, lang)}</b><small>{fmtWeekday(m.work_date, lang)}</small></span> },
    { key: 'kind', label: L('কর্মী দিয়েছেন', 'Given'), text: m => `${m.kind === 'present' ? 'উপস্থিত' : 'অনুপস্থিত'} ${siteText(m.applied_on_site, 'bn')} ${siteDetail(m, 'bn')}`.trim(),
      cell: m => <span className="wm-given"><KindBadge k={m.kind} />{m.kind === 'absent' && m.applied_on_site !== null && <small>{siteText(m.applied_on_site, lang)}</small>}
        {m.kind === 'absent' && m.site_ref && <span className="wm-no">{siteDetail(m, lang)}</span>}
        {m.application_no && <span className="wm-no">{m.application_no}</span>}</span> },
    { key: 'note', label: L('কথা', 'Note'), text: m => m.note ?? '', cell: m => m.note ? <span className="wm-wrap">{m.note}</span> : <span className="muted">—</span> },
    { key: 'st', label: L('অবস্থা', 'Status'), text: m => MARK_TEXT(m.status, 'bn'), cell: m => <span className="wm-given"><MarkBadge s={m.status} />
      {m.status !== 'waiting' && <small>{[m.decided_as ? recordLabel(m.decided_as, lang) : null, m.decided_by_name].filter(Boolean).join(' · ')}{m.decide_note ? ` — ${m.decide_note}` : ''}</small>}</span> },
    { key: 'act', label: '', cls: 'act', cell: m => m.status !== 'waiting' || !can.decide ? null : m.application_id
      ? <button type="button" className="secondary sm" onClick={() => go('apps')}>{L('আবেদনে দেখুন', 'See application')}</button>
      : <span className="wm-acts"><button type="button" className="sm" disabled={busy} onClick={() => void approve([m], 'given')}>{L('অনুমোদন', 'Approve')}</button>
        <button type="button" className="danger sm" disabled={busy} onClick={() => setBack([m])}>{L('ফেরত', 'Return')}</button></span> },
  ]
  const chip = (s: MarkStatus, bn: string, en: string) => <button key={s} type="button" className={`wm-chip${status === s ? ' on' : ''}`} aria-pressed={status === s} onClick={() => { setStatus(s); setSel(new Set()) }}>{L(bn, en)}</button>
  const waitingNow = status === 'waiting'

  return <>
    {node}
    <Section title={L('অনুমোদনের তালিকা', 'Approval queue')} hint={L('কর্মীরা যা দিয়েছেন, ম্যানেজারের সিদ্ধান্তের অপেক্ষায়। অনুমোদন দিলে খাতায় উঠে যায়; ফেরত দিলে কর্মী আবার দেবেন।', 'What staff gave, waiting for your decision. Approved ones go to the register; returned ones are given again.')}>
      <div className="wm-filters no-print">
        <div className="wm-chips" role="group" aria-label={L('অবস্থা', 'Status')}>{chip('waiting', 'অপেক্ষায়', 'Waiting')}{chip('rejected', 'ফেরত', 'Returned')}{chip('approved', 'অনুমোদিত', 'Approved')}</div>
        <RangeBar r={r} presets={['open', 'month', 'last', 'custom']} />
      </div>
      {!can.decide && <Notice>{L('আপনি দেখতে পারেন, কিন্তু অনুমোদন বা ফেরত দেওয়ার অনুমতি আপনার নেই।', 'You can see these, but you may not approve or return.')}</Notice>}
      {err ? <p className="da-error" role="alert">{err}</p> : null}
      {q.error && !q.data ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
      {!q.data && !q.error ? <Loading /> : null}
      {q.data && <div className={q.loading ? 'wm-stale' : ''}>
        {can.decide && waitingNow && pickable.length > 0 && <div className="wm-bulk no-print">
          <label className="wm-ck all"><input type="checkbox" checked={chosen.length === pickable.length} onChange={e => setSel(e.target.checked ? new Set(pickable.map(m => m.id)) : new Set())} />
            <span>{chosen.length ? L(`${n(chosen.length)}টি বাছা`, `${chosen.length} selected`) : L(`সব বাছুন (${n(pickable.length)})`, `Select all (${pickable.length})`)}</span></label>
          {chosen.length > 0 && <div className="wm-acts">
            <button type="button" disabled={busy} onClick={() => void approve(chosen, 'given')}><Icon name="check" size={16} />{L('যেমন দিয়েছেন তেমন অনুমোদন', 'Approve as given')}</button>
            {AS_OPTIONS.map(o => <button key={o.key} type="button" className="secondary" disabled={busy} onClick={() => void approve(chosen, o.key)}>{L(o.bn, o.en)}</button>)}
            <button type="button" className="danger" disabled={busy} onClick={() => setBack(chosen)}>{L('ফেরত দিন…', 'Return…')}</button></div>}
        </div>}
        <WmTable cols={cols} rows={rows} rowKey={m => m.id} rowCls={m => sel.has(m.id) ? 'sel' : ''} title={L('হাজিরা অনুমোদন', 'Attendance approvals')} file={`approvals-${r.from}`}
          sub={`${fmtDay(r.from, lang)} – ${fmtDay(r.to, lang)}`}
          empty={<Empty>{waitingNow ? L('অনুমোদনের জন্য কিছু অপেক্ষায় নেই — সব ঠিক আছে।', 'Nothing is waiting — all done.') : L('এই সময়ে কিছু নেই।', 'Nothing in this period.')}</Empty>} />
      </div>}
    </Section>
    {back && <NoteDialog title={L(`${n(back.length)}টি ফেরত দিন`, `Return ${back.length}`)} label={L('কেন ফেরত দিচ্ছেন?', 'Why are they returned?')} confirm={L('ফেরত দিন', 'Return')} danger
      hint={L('কর্মী আবার দিতে পারবেন।', 'The person can give them again.')} onClose={() => setBack(null)}
      onConfirm={async note => {
        const res = await decideMarks(back, 'given', false, note)
        if (res.failed.length) { setErr(L(`${n(res.done)}টি ফেরত হয়েছে। বাকিগুলো হয়নি: ${res.failed.join('; ')}`, `${res.done} returned. The rest failed: ${res.failed.join('; ')}`)) }
        else toast(L(`${n(res.done)}টি ফেরত দেওয়া হয়েছে`, `${res.done} returned`))
        setBack(null); setSel(new Set()); void q.reload(); onChanged()
      }} />}
  </>
}

// ====================================================================================== আবেদন
function AppsTab({ hubId, can, onChanged }: { hubId: string; can: Can; onChanged: () => void }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const today = todayDhaka()
  const [month, setMonth] = useState('')
  const [pick, setPick] = useState<AppStatus | 'all' | null>(null)
  const q = useLiveLoad<AbsenceApp[]>(() => wf.applications({ hub: hubId }, null, month || null), [hubId, month], LIVE.manage)
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const [rej, setRej] = useState<AbsenceApp | null>(null)
  const all = q.data ?? []
  const cnt = (s: AppStatus) => all.filter(a => a.status === s).length
  const eff: AppStatus | 'all' = pick ?? (cnt('pending') ? 'pending' : 'all')
  const list = useMemo(() => all.filter(a => eff === 'all' || a.status === eff).sort((a, b) => {
    const pa = a.status === 'pending' ? 0 : 1, pb = b.status === 'pending' ? 0 : 1
    return pa - pb || (pa === 0 ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at))
  }), [all, eff])
  const months = useMemo(() => lastMonths(today, 12), [today])

  async function approve(a: AbsenceApp) {
    setBusy(a.id); setErr('')
    try { const k = await wf.decideApplication(a.id, true); toast(L(`${a.application_no} অনুমোদিত — ${n(k)}টি তারিখ খাতায় উঠেছে`, `${a.application_no} approved — ${k} dates on the register`)); void q.reload(); onChanged() }
    catch (e) { setErr(wfFriendly(e)) } finally { setBusy('') }
  }
  const chip = (s: AppStatus | 'all', bn: string, en: string, c: number) => <button key={s} type="button" className={`wm-chip${eff === s ? ' on' : ''}`} aria-pressed={eff === s} onClick={() => setPick(s)}>
    {L(bn, en)}<b className="plain">{n(c)}</b></button>

  return <>
    {node}
    <Section title={L('অনুপস্থিতির আবেদন', 'Absence applications')} hint={L('কর্মী ওয়েবসাইটে আবেদন না করে থাকলে এখান থেকে আবেদন পাঠান। এখানেই সিদ্ধান্ত ও অবস্থা দেখা যায় (ট্র্যাকিং)।', 'Staff who did not apply on the website apply here. Decisions and status are tracked here.')}
      tools={<Field label={L('মাস', 'Month')}><select value={month} onChange={e => { setMonth(e.target.value); setPick(null) }}>
        <option value="">{L('সব মাস', 'All months')}</option>{months.map(m => <option key={m} value={m}>{monthName(m, lang)}</option>)}</select></Field>}>
      <div className="wm-chips no-print" role="group" aria-label={L('অবস্থা', 'Status')}>
        {chip('pending', 'অপেক্ষায়', 'Pending', cnt('pending'))}{chip('approved', 'অনুমোদিত', 'Approved', cnt('approved'))}{chip('rejected', 'বাতিল', 'Rejected', cnt('rejected'))}
        {chip('cancelled', 'তুলে নেওয়া', 'Withdrawn', cnt('cancelled'))}{chip('all', 'সব', 'All', all.length)}</div>
      {!can.decide && <Notice>{L('আপনি দেখতে পারেন, কিন্তু সিদ্ধান্ত দেওয়ার অনুমতি আপনার নেই।', 'You can see these, but you may not decide.')}</Notice>}
      {err ? <p className="da-error" role="alert">{err}</p> : null}
      {q.error && !q.data ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
      {!q.data && !q.error ? <Loading /> : null}
      {q.data && <div className={q.loading ? 'wm-stale' : ''}>
        {!list.length ? <Empty>{L('এই অবস্থায় কোনো আবেদন নেই।', 'No application in this state.')}</Empty> :
          <ul className="wm-apps">{list.map(a => <li key={a.id} className={`wm-app s-${a.status}`}>
            <div className="wm-app-h"><b className="wm-no">{a.application_no}</b><Badge tone={APP_META[a.status].tone}>{lang === 'bn' ? APP_META[a.status].bn : APP_META[a.status].en}</Badge>
              <span className="muted small">{fmtStamp(a.created_at, lang)}</span></div>
            <Who name={a.employee_name} code={a.employee_code} />
            <div className="wm-dchips">{a.dates.map(d => <span key={d} className="wm-dpill">{fmtDay(d, lang)}<small>{fmtWeekday(d, lang)}</small></span>)}</div>
            <p className="wm-reason">{a.reason}</p>
            {a.status !== 'pending' && <p className="wm-decided small muted">
              {a.status === 'cancelled' ? <>{L('কর্মী নিজে তুলে নিয়েছেন', 'Withdrawn by the person')} · {fmtStamp(a.cancelled_at, lang)}</>
                : <>{a.status === 'approved' ? L('অনুমোদন', 'Approved') : L('বাতিল', 'Rejected')}: <b>{a.decided_by_name ?? '—'}</b> · {fmtStamp(a.decided_at, lang)}{a.decision_note ? ` — ${a.decision_note}` : ''}</>}</p>}
            {a.status === 'pending' && can.decide && <div className="wm-acts">
              <button type="button" disabled={busy === a.id} onClick={() => void approve(a)}><Icon name="check" size={16} />{L('অনুমোদন', 'Approve')}</button>
              <button type="button" className="danger" disabled={busy === a.id} onClick={() => setRej(a)}>{L('বাতিল করুন…', 'Reject…')}</button></div>}
          </li>)}</ul>}
        {list.length > 0 && <div className="wm-after no-print"><button type="button" className="secondary sm" onClick={() => exportRows(L('অনুপস্থিতির আবেদন', 'Absence applications'), list[0]?.hub_name ?? '',
          [L('নম্বর', 'No'), L('আইডি', 'ID'), L('নাম', 'Name'), L('তারিখ', 'Dates'), L('কারণ', 'Reason'), L('অবস্থা', 'Status'), L('জমা', 'Sent'), L('সিদ্ধান্ত দিয়েছেন', 'Decided by'), L('সিদ্ধান্তের সময়', 'Decided at'), L('সিদ্ধান্তের কথা', 'Decision note')],
          list.map(a => [a.application_no, a.employee_code, a.employee_name, a.dates.join(', '), a.reason, APP_META[a.status].en, a.created_at.slice(0, 16).replace('T', ' '), a.decided_by_name, a.decided_at?.slice(0, 16).replace('T', ' ') ?? null, a.decision_note]),
          `applications-${month || 'all'}`)}><Icon name="xls" size={15} />{L('এক্সেল', 'Excel')}</button></div>}
      </div>}
    </Section>
    {rej && <NoteDialog title={`${rej.application_no} — ${L('আবেদন বাতিল', 'Reject application')}`} label={L('কেন বাতিল করছেন?', 'Why is it rejected?')} confirm={L('বাতিল করুন', 'Reject')} danger
      hint={`${rej.employee_name} · ${rej.dates.map(d => fmtDay(d, lang)).join(', ')}`} onClose={() => setRej(null)}
      onConfirm={async note => { await wf.decideApplication(rej.id, false, note); toast(L(`${rej.application_no} বাতিল করা হয়েছে`, `${rej.application_no} rejected`)); setRej(null); void q.reload(); onChanged() }} />}
  </>
}

// ====================================================================================== দৈনিক রিপোর্ট
const NUM_CHIPS = ['pickup', 'pickup_return', 'delivery', 'delivery_return'] as const
function OpsTab({ hubId }: { hubId: string }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const r = useRange('today')
  const q = useLiveLoad<OpsReport>(() => wf.opsReport({ hub: hubId }, r.from, r.to), [hubId, r.from, r.to], LIVE.manage)
  const d = q.data
  const [edit, setEdit] = useState<OpsReport['rows'][number] | null>(null)
  const [hist, setHist] = useState<OpsReport['rows'][number] | null>(null)
  const label = (k: typeof NUM_CHIPS[number]) => k === 'pickup' ? L('পিকআপ', 'Pickup') : k === 'pickup_return' ? L('পিকআপ রিটার্ন', 'Pickup return') : k === 'delivery' ? L('ডেলিভারি', 'Delivery') : L('ডেলিভারি রিটার্ন', 'Delivery return')
  const nums = <T extends OpsTotals>(foot?: OpsTotals | null): Array<WCol<T>> =>
    NUM_CHIPS.map(k => ({ key: k, label: label(k), num: true, sort: true, text: (x: T) => x[k], cell: (x: T) => n(x[k]), foot: foot ? <b>{n(foot[k])}</b> : undefined }))
  const sub = `${fmtDay(r.from, lang)}${r.from !== r.to ? ` – ${fmtDay(r.to, lang)}` : ''}`

  return <>
    {node}
    <Section title={L('দৈনিক অপারেশন রিপোর্ট', 'Daily operations report')} hint={L('কর্মীরা নিজের আজকের পিকআপ, রিটার্ন ও ডেলিভারির সংখ্যা দেন — হাব ও জোনসহ এখানে জমা হয়।', 'Staff give their own pickup, return and delivery numbers; they collect here by hub and zone.')}>
      <RangeBar r={r} presets={['today', 'yesterday', '7d', 'month', 'custom']} />
      {q.error && !d ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
      {!d && !q.error ? <Loading /> : null}
      {d && <div className={q.loading ? 'wm-stale' : ''}>
        <div className="da-stats">
          {NUM_CHIPS.map((k, i) => <Stat key={k} icon={i % 2 ? 'swap' : i ? 'truck' : 'box'} label={label(k)} value={n(d.totals[k])} />)}
          <Stat icon="users" label={L('কতজন দিয়েছেন', 'People gave')} value={n(d.totals.people)} sub={L(`${n(d.totals.entries)}টি এন্ট্রি`, `${d.totals.entries} entries`)} />
          <Stat icon="alert" tone={d.missing_today.length ? 'warn' : 'ok'} label={L('আজ এখনো দেননি', 'Not given today')} value={n(d.missing_today.length)} />
        </div>
      </div>}
    </Section>

    {d && <div className={q.loading ? 'wm-stale' : ''}>
      {d.missing_today.length > 0 && <Section title={L(`আজ এখনো দেননি (${n(d.missing_today.length)})`, `Not given today (${d.missing_today.length})`)} hint={L('এক ট্যাপে ফোন, এসএমএস বা হোয়াটসঅ্যাপ করুন।', 'One tap to call, text or WhatsApp.')}>
        <ul className="wm-people">{d.missing_today.map(p => <li key={p.employee_id} className="wm-prow"><Who name={p.name} code={p.code} position={p.position} /><span className="wm-pst" /><Contact phone={p.mobile} showNumber={false} text={L('আজকের পিকআপ-ডেলিভারির সংখ্যা দিন', 'Please give today’s numbers')} /></li>)}</ul>
      </Section>}

      {!d.rows.length ? <Section title={L('এই সময়ের রিপোর্ট', 'Report for this period')}><Empty>{L('এই সময়ে কেউ পিকআপ-ডেলিভারির সংখ্যা দেননি।', 'No one gave pickup / delivery numbers in this period.')}</Empty></Section> : <>
      <Section title={L('কর্মী অনুযায়ী', 'By person')}>
        <WmTable<OpsReport['by_person'][number]> cols={[
          { key: 'who', label: L('কর্মী', 'Person'), primary: true, sort: true, text: p => p.name, cell: p => <Who name={p.name} code={p.code} position={p.position} /> },
          { key: 'days', label: L('দিন', 'Days'), num: true, sort: true, text: p => p.days, cell: p => n(p.days), foot: undefined },
          ...nums<OpsReport['by_person'][number]>(d.totals)]} rows={d.by_person} rowKey={p => p.employee_id} grid
          title={L('কর্মী অনুযায়ী পিকআপ-ডেলিভারি', 'Operations by person')} file={`ops-by-person-${r.from}`} sub={sub}
          empty={<Empty>{L('এই সময়ে কেউ কিছু দেননি।', 'No one gave numbers in this period.')}</Empty>} />
      </Section>

      <Section title={L('দিন অনুযায়ী', 'By day')}>
        <WmTable<OpsReport['by_day'][number]> cols={[
          { key: 'date', label: L('তারিখ', 'Date'), primary: true, sort: true, text: x => x.date, cell: x => <span className="wm-dt"><b>{fmtDay(x.date, lang)}</b><small>{fmtWeekday(x.date, lang)}</small></span> },
          { key: 'people', label: L('কতজন', 'People'), num: true, sort: true, text: x => x.people, cell: x => n(x.people) },
          ...nums<OpsReport['by_day'][number]>(d.totals)]} rows={d.by_day} rowKey={x => x.date} grid defaultSort={{ key: 'date', dir: -1 }}
          title={L('দিন অনুযায়ী পিকআপ-ডেলিভারি', 'Operations by day')} file={`ops-by-day-${r.from}`} sub={sub} />
      </Section>

      <Section title={L('সব এন্ট্রি', 'All entries')} hint={d.can_edit ? L('ভুল হলে “সংশোধন” চাপুন — কারণ লিখতে হবে, ইতিহাসে থাকবে।', 'Use “Correct” for a wrong number — a reason is needed and it stays in the history.') : undefined}>
        <WmTable<OpsReport['rows'][number]> cols={[
          { key: 'who', label: L('কর্মী', 'Person'), primary: true, sort: true, text: x => x.employee_name, cell: x => <Who name={x.employee_name} code={x.employee_code} position={x.position} /> },
          { key: 'date', label: L('তারিখ', 'Date'), sort: true, text: x => x.work_date, cell: x => <span className="wm-dt"><b>{fmtDay(x.work_date, lang)}</b><small>{fmtWeekday(x.work_date, lang)}</small></span> },
          ...nums<OpsReport['rows'][number]>(),
          { key: 'rev', label: L('সংশোধন', 'Edits'), num: true, text: x => x.revision - 1, cell: x => x.revision > 1 ? <Badge tone="info">{n(x.revision - 1)}</Badge> : <span className="muted">—</span> },
          { key: 'note', label: L('কথা', 'Note'), text: x => x.note ?? '', cell: x => x.note ? <span className="wm-wrap">{x.note}</span> : <span className="muted">—</span> },
          { key: 'act', label: '', cls: 'act', cell: x => <span className="wm-acts">
            <button type="button" className="secondary sm" onClick={() => setHist(x)}>{L('ইতিহাস', 'History')}</button>
            {d.can_edit && <button type="button" className="secondary sm" onClick={() => setEdit(x)}><Icon name="edit" size={14} />{L('সংশোধন', 'Correct')}</button>}</span> },
        ]} rows={d.rows} rowKey={x => x.id} grid title={L('দৈনিক এন্ট্রি', 'Daily entries')} file={`ops-entries-${r.from}`} sub={sub}
          empty={<Empty>{L('এই সময়ে কোনো এন্ট্রি নেই।', 'No entries in this period.')}</Empty>} />
      </Section></>}
    </div>}

    {edit && <OpsEdit row={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void q.reload(); toast(L('সংশোধন হয়েছে', 'Corrected')) }} />}
    {hist && <OpsHistoryModal row={hist} onClose={() => setHist(null)} />}
  </>
}

function OpsEdit({ row, onClose, onDone }: { row: OpsReport['rows'][number]; onClose: () => void; onDone: () => void }) {
  const { L, lang } = usePrefs()
  const [v, setV] = useState<Record<typeof NUM_CHIPS[number], string>>({ pickup: String(row.pickup), pickup_return: String(row.pickup_return), delivery: String(row.delivery), delivery_return: String(row.delivery_return) })
  const names: Record<typeof NUM_CHIPS[number], string> = { pickup: L('পিকআপ', 'Pickup'), pickup_return: L('পিকআপ রিটার্ন', 'Pickup return'), delivery: L('ডেলিভারি', 'Delivery'), delivery_return: L('ডেলিভারি রিটার্ন', 'Delivery return') }
  const nums = NUM_CHIPS.map(k => Number(v[k]))
  const valid = nums.every(x => Number.isInteger(x) && x >= 0 && x <= 100000)
  return <NoteDialog title={`${row.employee_name} · ${fmtDay(row.work_date, lang)}`} label={L('সংশোধনের কারণ', 'Reason for the correction')} confirm={L('সংশোধন সেভ করুন', 'Save correction')} onClose={onClose}
    hint={L('কর্মীর দেওয়া সংখ্যা বদলে যাবে; আগের সংখ্যা ইতিহাসে থাকবে।', 'The number changes; the old one stays in the history.')}
    onConfirm={async note => { if (!valid) throw new Error('numbers must be non-negative'); await wf.correctOps(row.id, { pickup: nums[0], pickup_return: nums[1], delivery: nums[2], delivery_return: nums[3] }, note); onDone() }}>
    <div className="wm-numgrid">{NUM_CHIPS.map(k => <Field key={k} label={names[k]}><input type="number" inputMode="numeric" min={0} max={100000} step={1} value={v[k]} onChange={e => setV(s => ({ ...s, [k]: e.target.value }))} /></Field>)}</div>
    {!valid && <p className="da-error" role="alert">{L('সংখ্যা ০ থেকে ১,০০,০০০-এর মধ্যে পূর্ণ সংখ্যা হতে হবে।', 'Whole numbers from 0 to 100000.')}</p>}
  </NoteDialog>
}

function OpsHistoryModal({ row, onClose }: { row: OpsReport['rows'][number]; onClose: () => void }) {
  const { L, n, lang } = usePrefs()
  const q = useLoad(() => wf.opsHistory(row.id), [row.id])
  const t = (x: { pickup: number; pickup_return: number; delivery: number; delivery_return: number } | null) => x ? `${n(x.pickup)} · ${n(x.pickup_return)} · ${n(x.delivery)} · ${n(x.delivery_return)}` : '—'
  return <Modal title={`${row.employee_name} · ${fmtDay(row.work_date, lang)}`} onClose={onClose} actions={<button type="button" className="secondary" onClick={onClose}>{L('বন্ধ করুন', 'Close')}</button>}>
    <p className="muted small">{L('ক্রম: পিকআপ · পিকআপ রিটার্ন · ডেলিভারি · ডেলিভারি রিটার্ন', 'Order: pickup · pickup return · delivery · delivery return')}</p>
    {q.loading ? <Loading /> : q.error ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : !q.data?.length ? <Empty>{L('কোনো ইতিহাস নেই।', 'No history.')}</Empty> :
      <ol className="wm-hlist">{q.data.map(h => <li key={h.id}><b>{L('সংস্করণ', 'Version')} {n(h.revision)}</b> · {fmtStamp(h.at, lang)}{h.by_name ? ` · ${h.by_name}` : ''}
        <span>{h.from ? <>{t(h.from)} → </> : null}<b>{t(h.to)}</b></span>{h.note ? <span className="muted">{h.note}</span> : null}</li>)}</ol>}
  </Modal>
}

// ====================================================================================== ইতিহাস
function changeText(h: History, lang: 'bn' | 'en'): string {
  const kind = (k: string | null) => k === 'present' ? (lang === 'bn' ? 'উপস্থিত' : 'present') : k === 'absent' ? (lang === 'bn' ? 'অনুপস্থিত' : 'absent') : '—'
  const st = (s: MarkStatus | null) => s ? MARK_TEXT(s, lang) : '—'
  const parts: string[] = []
  if (h.from_kind !== h.to_kind) parts.push(`${kind(h.from_kind)} → ${kind(h.to_kind)}`)
  if (h.from_as !== h.to_as) parts.push(`${h.from_as ? recordLabel(h.from_as, lang) : '—'} → ${h.to_as ? recordLabel(h.to_as, lang) : '—'}`)
  if (h.from_status !== h.to_status) parts.push(`${st(h.from_status)} → ${st(h.to_status)}`)
  return parts.join(' · ') || '—'
}

function HistoryTab({ hubId, today }: { hubId: string; today: IsoDate }) {
  const { L, lang } = usePrefs()
  const [month, setMonth] = useState<IsoDate>(monthOf(today))
  const [find, setFind] = useState('')
  const q = useLiveLoad<History[]>(() => wf.history({ hub: hubId }, month, 200), [hubId, month], LIVE.manage)
  const months = useMemo(() => lastMonths(today, 12), [today])
  const word = find.trim().toLowerCase()
  const rows = (q.data ?? []).filter(h => !word || `${h.employee_name} ${h.employee_code ?? ''} ${h.by_name ?? ''} ${h.note ?? ''}`.toLowerCase().includes(word))
  return <Section title={L('সংশোধন ও সিদ্ধান্তের ইতিহাস', 'Correction & decision history')} hint={L('কে, কখন, কী বদলেছেন — মুছে ফেলা যায় না।', 'Who changed what and when — it cannot be deleted.')}
    tools={<Field label={L('মাস', 'Month')}><select value={month} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={m} value={m}>{monthName(m, lang)}</option>)}</select></Field>}>
    <div className="wm-filters no-print"><input type="search" className="wm-search" value={find} onChange={e => setFind(e.target.value)} placeholder={L('নাম, আইডি বা কথা খুঁজুন…', 'Search name, ID or note…')} aria-label={L('খুঁজুন', 'Search')} /></div>
    {q.error && !q.data ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
    {!q.data && !q.error ? <Loading /> : null}
    {q.data && <div className={q.loading ? 'wm-stale' : ''}>
      <WmTable<History> cols={[
        { key: 'at', label: L('সময়', 'When'), sort: true, text: h => h.at, cell: h => <span className="wm-dt"><b>{fmtTsDay(h.at, lang)}</b><small>{fmtTime(h.at, lang)}</small></span> },
        { key: 'who', label: L('কর্মী', 'Person'), primary: true, sort: true, text: h => h.employee_name, cell: h => <Who name={h.employee_name} code={h.employee_code} /> },
        { key: 'date', label: L('তারিখ', 'Date'), sort: true, text: h => h.work_date, cell: h => fmtDay(h.work_date, lang) },
        { key: 'act', label: L('কাজ', 'Action'), sort: true, text: h => ACTION_META[h.action].bn, cell: h => <Badge tone={h.action === 'returned' ? 'bad' : h.action === 'approved' ? 'ok' : h.action === 'corrected' ? 'warn' : 'info'}>{lang === 'bn' ? ACTION_META[h.action].bn : ACTION_META[h.action].en}</Badge> },
        { key: 'chg', label: L('কী বদলেছে', 'What changed'), text: h => changeText(h, 'bn'), cell: h => <span className="wm-wrap">{changeText(h, lang)}</span> },
        { key: 'note', label: L('কারণ / কথা', 'Note'), text: h => h.note ?? '', cell: h => h.note ? <span className="wm-wrap">{h.note}</span> : <span className="muted">—</span> },
        { key: 'by', label: L('কে', 'By'), text: h => h.by_name ?? '', cell: h => h.by_name ?? '—' },
      ]} rows={rows} rowKey={h => h.id} title={L('হাজিরার ইতিহাস', 'Attendance history')} file={`attendance-history-${month.slice(0, 7)}`} sub={monthName(month, lang)}
        empty={<Empty>{L('এই মাসে কোনো ইতিহাস নেই।', 'No history this month.')}</Empty>} />
      {(q.data?.length ?? 0) >= 200 && <p className="muted small">{L('সর্বশেষ ২০০টি দেখানো হচ্ছে।', 'Showing the latest 200.')}</p>}
    </div>}
  </Section>
}

