import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Contact } from '../../components/Contact'
import { usePrefs } from '../../lib/prefs'
import { ACTION_META, APP_META, LIVE, monthOf, useLiveLoad, wf, wfFriendly,
  type AbsenceApp, type AppStatus, type History, type Mark, type OpsReport, type OpsTotals, type ZoneHubRow, type ZoneOverview } from '../../lib/workforce'
import { Badge, Field, Stat } from '../accounts/ui'
import { ChipTabs, Empty, KindBadge, LiveDot, Loading, MarkBadge, RangeBar, Section, Who, WmTable, fmtDay, fmtStamp, fmtWeekday, monthName, recordLabel, siteDetail, siteText, useHubList, useRange,
  type WCol } from './shared'
import { ZoneFinal } from './ZoneFinal'
import { ZoneWindows } from './ZoneWindows'

/**
 * জোনাল ওয়ার্কফোর্স রিপোর্ট — everything the zonal manager may see, all hubs side by side.
 * A report: it reads the same shared tables through wf_zone_overview / wf_marks / wf_applications / wf_ops_report / wf_att_history
 * and has no approve or return buttons — a tap on a hub opens that hub's own page, where the database decides what the person may do.
 * The one setting here (tab "সেটিং", hr.attendance.configure): opening earlier dates of the attendance book for the zone (ZoneWindows).
 */
type ZTab = 'final' | 'apps' | 'ops' | 'history' | 'setting'
const ZTABS: ZTab[] = ['final', 'apps', 'ops', 'history', 'setting']

export function WorkforceZone() {
  const { L, n, lang } = usePrefs()
  const { can } = useAuth()
  const canSet = can('hr.attendance.configure')
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const hubsQ = useHubList()
  const zones = useMemo(() => hubsQ.data?.zones ?? [], [hubsQ.data])
  const zoneAsked = sp.get('zone') ?? ''
  const zone = zones.some(z => z.id === zoneAsked) ? zoneAsked : ''
  const r = useRange('today')
  const q = useLiveLoad<ZoneOverview>(() => wf.zone(zone || null, r.from, r.to), [zone, r.from, r.to], LIVE.manage)
  const d = q.data
  const tabAsked = sp.get('tab')
  const tab: ZTab = ZTABS.includes(tabAsked as ZTab) && (tabAsked !== 'setting' || canSet) ? tabAsked as ZTab : 'final'
  const setTab = (t: ZTab) => setSp(p => { const x = new URLSearchParams(p); x.set('tab', t); return x }, { replace: true })
  const setZone = (id: string) => setSp(p => { const x = new URLSearchParams(p); if (id) x.set('zone', id); else x.delete('zone'); return x }, { replace: true })
  const range = `${fmtDay(r.from, lang)}${r.from !== r.to ? ` – ${fmtDay(r.to, lang)}` : ''}`
  const zoneName = d?.zone?.name ?? (zone ? zones.find(z => z.id === zone)?.name : null) ?? (zones.length === 1 ? zones[0].name : L('সব জোন', 'All zones'))

  const hasOps = !!d && (d.totals.ops !== null || d.hubs.some(h => h.ops))
  const openHub = (h: ZoneHubRow, t?: string) => { if (h.hub_id) nav(`/app/workforce/hub?hub=${h.hub_id}${t ? `&tab=${t}` : ''}`) }
  const val = (v: number, tone?: 'warn' | 'bad'): ReactNode => <span className={v ? (tone ? `wm-v ${tone}` : 'wm-v') : 'wm-v zero'}>{n(v)}</span>

  const cols: Array<WCol<ZoneHubRow>> = [
    { key: 'hub', label: L('হাব', 'Hub'), primary: true, sort: true, text: h => h.name, foot: <b>{L('মোট', 'Total')}</b>,
      cell: h => <span className="wm-hubname"><b>{h.name}</b>{h.zone_name ? <small>{h.zone_name}</small> : null}</span> },
    { key: 'staff', label: L('স্টাফ', 'Staff'), num: true, sort: true, text: h => h.staff_total, cell: h => n(h.staff_total), foot: d ? <b>{n(d.totals.staff_total)}</b> : undefined },
    { key: 'present', label: L('উপস্থিত', 'Present'), num: true, sort: true, text: h => h.att.present, cell: h => val(h.att.present), foot: d ? <b>{n(d.totals.att.present)}</b> : undefined },
    { key: 'late', label: L('দেরি', 'Late'), num: true, sort: true, text: h => h.att.late, cell: h => val(h.att.late), foot: d ? <b>{n(d.totals.att.late)}</b> : undefined },
    { key: 'half', label: L('অর্ধদিবস', 'Half day'), num: true, sort: true, text: h => h.att.half_day, cell: h => val(h.att.half_day), foot: d ? <b>{n(d.totals.att.half_day)}</b> : undefined },
    { key: 'absent', label: L('অনুপস্থিত', 'Absent'), num: true, sort: true, text: h => h.att.absent, cell: h => val(h.att.absent, 'bad'), foot: d ? <b>{n(d.totals.att.absent)}</b> : undefined },
    { key: 'leave', label: L('ছুটি', 'Leave'), num: true, sort: true, text: h => h.att.leave, cell: h => val(h.att.leave), foot: d ? <b>{n(d.totals.att.leave)}</b> : undefined },
    { key: 'todo', label: L('আজ বাকি', 'Due today'), num: true, sort: true, text: h => h.att.not_given_today, cell: h => val(h.att.not_given_today, 'warn'), foot: d ? <b>{n(d.totals.att.not_given_today)}</b> : undefined },
    { key: 'marks', label: L('অনুমোদন বাকি', 'To approve'), num: true, sort: true, text: h => h.pending_marks, cell: h => val(h.pending_marks, 'warn'), foot: d ? <b>{n(d.totals.pending_marks)}</b> : undefined },
    { key: 'apps', label: L('আবেদন', 'Applications'), num: true, sort: true, text: h => h.pending_applications, cell: h => val(h.pending_applications, 'warn'), foot: d ? <b>{n(d.totals.pending_applications)}</b> : undefined },
    ...(hasOps ? ([
      { key: 'pk', label: L('পিকআপ', 'Pickup'), num: true, sort: true, text: h => h.ops?.pickup ?? null, cell: h => h.ops ? val(h.ops.pickup) : '—', foot: d?.totals.ops ? <b>{n(d.totals.ops.pickup)}</b> : undefined },
      { key: 'pr', label: L('পিকআপ রিটার্ন', 'Pickup return'), num: true, sort: true, text: h => h.ops?.pickup_return ?? null, cell: h => h.ops ? val(h.ops.pickup_return) : '—', foot: d?.totals.ops ? <b>{n(d.totals.ops.pickup_return)}</b> : undefined },
      { key: 'dl', label: L('ডেলিভারি', 'Delivery'), num: true, sort: true, text: h => h.ops?.delivery ?? null, cell: h => h.ops ? val(h.ops.delivery) : '—', foot: d?.totals.ops ? <b>{n(d.totals.ops.delivery)}</b> : undefined },
      { key: 'dr', label: L('ডেলিভারি রিটার্ন', 'Delivery return'), num: true, sort: true, text: h => h.ops?.delivery_return ?? null, cell: h => h.ops ? val(h.ops.delivery_return) : '—', foot: d?.totals.ops ? <b>{n(d.totals.ops.delivery_return)}</b> : undefined },
      { key: 'sub', label: L('কতজন সাবমিট', 'Submitted'), num: true, sort: true, text: h => h.ops?.submitted_people ?? null,
        cell: h => h.ops ? <span className={h.ops.missing_today ? 'wm-v warn' : 'wm-v'}>{n(h.ops.submitted_people)}/{n(h.ops.submitted_people + h.ops.missing_today)}</span> : '—',
        foot: d?.totals.ops ? <b>{n(d.totals.ops.submitted_people)}/{n(d.totals.ops.submitted_people + d.totals.ops.missing_today)}</b> : undefined },
    ] as Array<WCol<ZoneHubRow>>) : []),
  ]

  return <AppShell title={L('জোনাল ওয়ার্কফোর্স রিপোর্ট', 'Zonal workforce report')} subtitle={`${zoneName} · ${range}`}>
    <div className="wm">
      <section className="panel wm-top no-print">
        {zones.length > 1 ? <Field label={L('জোন', 'Zone')}>
          <select value={zone} onChange={e => setZone(e.target.value)}><option value="">{L('সব জোন', 'All zones')}</option>
            {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field> : null}
        <RangeBar r={r} presets={['today', '7d', 'month', 'custom']} />
        <div className="wm-top-r"><LiveDot on={q.live} /></div>
      </section>

      {q.error && !d ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
      {!d && !q.error ? <Loading /> : null}

      {d && <div className={q.loading ? 'wm-stale' : ''}>
        <Section title={L('হাজিরা', 'Attendance')} hint={L('হাজিরার সংখ্যা খাতার সারি (ম্যানেজারের অনুমোদিত) — বেছে নেওয়া সময়ে। “আজ বাকি” আজকের তারিখের।', 'Counts are register rows in the chosen period. “Due today” is for today.')}>
          <div className="da-stats">
            <Stat icon="users" label={L('মোট স্টাফ', 'Staff')} value={n(d.totals.staff_total)} />
            <Stat icon="check" tone="ok" label={L('উপস্থিত', 'Present')} value={n(d.totals.att.present)} />
            <Stat icon="clock" label={L('দেরি', 'Late')} value={n(d.totals.att.late)} />
            <Stat icon="clock" label={L('অর্ধদিবস', 'Half day')} value={n(d.totals.att.half_day)} />
            <Stat icon="x" tone={d.totals.att.absent ? 'bad' : undefined} label={L('অনুপস্থিত', 'Absent')} value={n(d.totals.att.absent)} />
            <Stat icon="cal" label={L('ছুটি', 'Leave')} value={n(d.totals.att.leave)} />
            <Stat icon="alert" tone={d.totals.att.not_given_today ? 'warn' : 'ok'} label={L('আজ বাকি', 'Due today')} value={n(d.totals.att.not_given_today)} />
            <Stat icon="log" tone={d.totals.pending_marks ? 'warn' : undefined} label={L('অনুমোদন বাকি', 'To approve')} value={n(d.totals.pending_marks)} />
            <Stat icon="form" tone={d.totals.pending_applications ? 'warn' : undefined} label={L('আবেদন অপেক্ষায়', 'Applications waiting')} value={n(d.totals.pending_applications)} />
            <Stat icon="back" tone={d.totals.returned_marks ? 'warn' : undefined} label={L('ফেরত দেওয়া', 'Returned')} value={n(d.totals.returned_marks)} />
          </div>
          {d.totals.ops && <>
            <h3 className="wm-sub">{L('পিকআপ · রিটার্ন · ডেলিভারি', 'Pickup · return · delivery')}</h3>
            <div className="da-stats">
              <Stat icon="box" label={L('পিকআপ', 'Pickup')} value={n(d.totals.ops.pickup)} />
              <Stat icon="swap" label={L('পিকআপ রিটার্ন', 'Pickup return')} value={n(d.totals.ops.pickup_return)} />
              <Stat icon="truck" label={L('ডেলিভারি', 'Delivery')} value={n(d.totals.ops.delivery)} />
              <Stat icon="swap" label={L('ডেলিভারি রিটার্ন', 'Delivery return')} value={n(d.totals.ops.delivery_return)} />
              <Stat icon="usercheck" label={L('কতজন সাবমিট করেছেন', 'People submitted')} value={n(d.totals.ops.submitted_people)} />
              <Stat icon="alert" tone={d.totals.ops.missing_today ? 'warn' : 'ok'} label={L('আজ দেননি', 'Not given today')} value={n(d.totals.ops.missing_today)} />
            </div></>}
        </Section>

        <Section title={L('হাব অনুযায়ী', 'Hub by hub')} hint={L('হাবে ট্যাপ করলে সেই হাবের নিজের পাতা খোলে।', 'Tap a hub to open its own page.')}>
          <WmTable<ZoneHubRow> cols={cols} rows={d.hubs} rowKey={h => h.hub_id ?? h.name} onRow={h => openHub(h)} grid
            title={L('হাব অনুযায়ী ওয়ার্কফোর্স', 'Workforce by hub')} file={`zone-hubs-${r.from}`} sub={`${zoneName} · ${range}`}
            empty={<Empty>{L('দেখার মতো কোনো হাব নেই।', 'No hub to show.')}</Empty>} />
        </Section>
      </div>}

      {d && <>
        <ChipTabs<ZTab> tabs={[{ key: 'final', label: L('দৈনিক হাজিরার তথ্য', 'Daily attendance data') }, { key: 'apps', label: L('অনুপস্থিতি ও আবেদন', 'Absence & applications') }, { key: 'ops', label: L('পিকআপ · রিটার্ন · ডেলিভারি', 'Pickup · return · delivery') }, { key: 'history', label: L('ইতিহাস', 'History') },
            ...(canSet ? [{ key: 'setting' as const, label: L('সেটিং: হাজিরা বই', 'Setting: attendance book') }] : [])]}
          value={tab} onChange={setTab} label={L('জোনের বিভাগ', 'Zone sections')} />
        <div key={`${zone}-${tab}`}>
          {tab === 'final' && <ZoneFinal zone={zone} />}
          {tab === 'apps' && <ZoneApps zone={zone} from={r.from} to={r.to} range={range} onHub={(id, t) => nav(`/app/workforce/hub?hub=${id}&tab=${t}`)} />}
          {tab === 'ops' && <ZoneOps zone={zone} from={r.from} to={r.to} range={range} />}
          {tab === 'history' && <ZoneHistory zone={zone} month={monthOf(r.to)} />}
          {tab === 'setting' && <ZoneWindows zone={zone} />}
        </div></>}
    </div>
  </AppShell>
}

// ====================================================================================== অনুপস্থিতি ও আবেদন
function ZoneApps({ zone, from, to, range, onHub }: { zone: string; from: string; to: string; range: string; onHub: (hubId: string, tab: string) => void }) {
  const { L, n, lang } = usePrefs()
  const month = monthOf(from) === monthOf(to) ? monthOf(from) : null
  const apps = useLiveLoad<AbsenceApp[]>(() => wf.applications({ zone: zone || null }, null, month), [zone, month], LIVE.manage)
  const marks = useLiveLoad<Mark[]>(() => wf.marks({ zone: zone || null }, from, to), [zone, from, to], LIVE.manage)
  const [st, setSt] = useState<AppStatus | 'all'>('all')
  const inRange = (apps.data ?? []).filter(a => a.status === 'pending' || a.dates.some(x => x >= from && x <= to))
  const shown = inRange.filter(a => st === 'all' || a.status === st)
  const absent = (marks.data ?? []).filter(m => m.kind === 'absent').sort((a, b) => b.work_date.localeCompare(a.work_date) || a.full_name.localeCompare(b.full_name))
  const cnt = (s: AppStatus) => inRange.filter(a => a.status === s).length
  const chip = (s: AppStatus | 'all', bn: string, en: string, c: number) => <button key={s} type="button" className={`wm-chip${st === s ? ' on' : ''}`} aria-pressed={st === s} onClick={() => setSt(s)}>{L(bn, en)}<b className="plain">{n(c)}</b></button>

  const appCols: Array<WCol<AbsenceApp>> = [
    { key: 'no', label: L('নম্বর', 'No'), primary: true, sort: true, text: a => a.application_no, cell: a => <b className="wm-no">{a.application_no}</b> },
    { key: 'who', label: L('কর্মী', 'Person'), sort: true, text: a => a.employee_name, cell: a => <Who name={a.employee_name} code={a.employee_code} /> },
    { key: 'hub', label: L('হাব', 'Hub'), sort: true, text: a => a.hub_name ?? '', cell: a => a.hub_name ?? '—' },
    { key: 'dates', label: L('অনুপস্থিতির তারিখ', 'Dates'), text: a => a.dates.join(', '), cell: a => <span className="wm-dchips">{a.dates.map(x => <span key={x} className="wm-dpill">{fmtDay(x, lang)}</span>)}</span> },
    { key: 'reason', label: L('কারণ', 'Reason'), text: a => a.reason, cell: a => <span className="wm-wrap">{a.reason}</span> },
    { key: 'st', label: L('অবস্থা', 'Status'), sort: true, text: a => APP_META[a.status].bn, cell: a => <Badge tone={APP_META[a.status].tone}>{lang === 'bn' ? APP_META[a.status].bn : APP_META[a.status].en}</Badge> },
    { key: 'by', label: L('সিদ্ধান্ত', 'Decision'), text: a => [a.decided_by_name, a.decision_note].filter(Boolean).join(' — '),
      cell: a => a.status === 'pending' ? <span className="muted">—</span> : a.status === 'cancelled' ? <span className="muted">{L('তুলে নিয়েছেন', 'Withdrawn')}</span>
        : <span className="wm-wrap">{a.decided_by_name ?? '—'}{a.decision_note ? ` — ${a.decision_note}` : ''}</span> },
    { key: 'at', label: L('জমা', 'Sent'), sort: true, text: a => a.created_at, cell: a => fmtStamp(a.created_at, lang) },
  ]
  const markCols: Array<WCol<Mark>> = [
    { key: 'date', label: L('তারিখ', 'Date'), sort: true, text: m => m.work_date, cell: m => <span className="wm-dt"><b>{fmtDay(m.work_date, lang)}</b><small>{fmtWeekday(m.work_date, lang)}</small></span> },
    { key: 'who', label: L('কর্মী', 'Person'), primary: true, sort: true, text: m => m.full_name, cell: m => <Who name={m.full_name} code={m.employee_code} position={m.position} /> },
    { key: 'hub', label: L('হাব', 'Hub'), sort: true, text: m => m.hub_name ?? '', cell: m => m.hub_name ?? '—' },
    { key: 'site', label: L('ওয়েবসাইটে আবেদন', 'Website application'), text: m => [siteText(m.applied_on_site, 'bn'), siteDetail(m, 'bn')].filter(Boolean).join(' · '),
      cell: m => [siteText(m.applied_on_site, lang), siteDetail(m, lang)].filter(Boolean).join(' · ') || '—' },
    { key: 'no', label: L('আবেদন নম্বর', 'Application'), text: m => m.application_no ?? '', cell: m => m.application_no ? <b className="wm-no">{m.application_no}</b> : <span className="muted">—</span> },
    { key: 'st', label: L('অবস্থা', 'Status'), sort: true, text: m => m.status, cell: m => <span className="wm-given"><MarkBadge s={m.status} />
      {m.status !== 'waiting' && m.decided_as ? <small>{recordLabel(m.decided_as, lang)}{m.decided_by_name ? ` · ${m.decided_by_name}` : ''}</small> : null}</span> },
    { key: 'note', label: L('কর্মীর কথা', 'Note'), text: m => m.note ?? '', cell: m => m.note ? <span className="wm-wrap">{m.note}</span> : <span className="muted">—</span> },
  ]

  return <>
    <Section title={L(`অনুপস্থিতির আবেদন (${n(inRange.length)})`, `Absence applications (${inRange.length})`)} hint={L('সব হাবের আবেদন ও তাদের অবস্থা। সারিতে ট্যাপ করলে সেই হাবের আবেদন পাতা খোলে।', 'Applications of every hub with their status. Tap a row to open that hub.')}>
      <div className="wm-chips no-print" role="group" aria-label={L('অবস্থা', 'Status')}>
        {chip('all', 'সব', 'All', inRange.length)}{chip('pending', 'অপেক্ষায়', 'Pending', cnt('pending'))}{chip('approved', 'অনুমোদিত', 'Approved', cnt('approved'))}
        {chip('rejected', 'বাতিল', 'Rejected', cnt('rejected'))}{chip('cancelled', 'তুলে নেওয়া', 'Withdrawn', cnt('cancelled'))}</div>
      {apps.error && !apps.data ? <p className="da-error" role="alert">{wfFriendly(apps.error)}</p> : null}
      {!apps.data && !apps.error ? <Loading /> : <div className={apps.loading ? 'wm-stale' : ''}>
        <WmTable<AbsenceApp> cols={appCols} rows={shown} rowKey={a => a.id} onRow={a => a.hub_id && onHub(a.hub_id, 'apps')} defaultSort={{ key: 'at', dir: -1 }}
          title={L('অনুপস্থিতির আবেদন', 'Absence applications')} file={`zone-applications-${from}`} sub={range}
          empty={<Empty>{L('এই অবস্থায় কোনো আবেদন নেই।', 'No application in this state.')}</Empty>} /></div>}
    </Section>
    <Section title={L(`অনুপস্থিত — কর্মীর দেওয়া হাজিরা (${n(absent.length)})`, `Absent — as given by staff (${absent.length})`)} hint={L('“উপস্থিত ছিলাম না” দেওয়া তারিখগুলো, সব হাব একসাথে।', 'Dates staff marked as not present, all hubs together.')}>
      {marks.error && !marks.data ? <p className="da-error" role="alert">{wfFriendly(marks.error)}</p> : null}
      {!marks.data && !marks.error ? <Loading /> : <div className={marks.loading ? 'wm-stale' : ''}>
        <WmTable<Mark> cols={markCols} rows={absent} rowKey={m => m.id} onRow={m => m.hub_id && onHub(m.hub_id, 'approve')}
          title={L('অনুপস্থিত হাজিরা', 'Absent inputs')} file={`zone-absent-${from}`} sub={range}
          empty={<Empty>{L('এই সময়ে কেউ অনুপস্থিত দেননি।', 'No one marked absent in this period.')}</Empty>} /></div>}
    </Section>
  </>
}

// ====================================================================================== পিকআপ · রিটার্ন · ডেলিভারি
const KEYS = ['pickup', 'pickup_return', 'delivery', 'delivery_return'] as const
function ZoneOps({ zone, from, to, range }: { zone: string; from: string; to: string; range: string }) {
  const { L, n, lang } = usePrefs()
  const q = useLiveLoad<OpsReport>(() => wf.opsReport({ zone: zone || null }, from, to), [zone, from, to], LIVE.manage)
  const d = q.data
  const label = (k: typeof KEYS[number]) => k === 'pickup' ? L('পিকআপ', 'Pickup') : k === 'pickup_return' ? L('পিকআপ রিটার্ন', 'Pickup return') : k === 'delivery' ? L('ডেলিভারি', 'Delivery') : L('ডেলিভারি রিটার্ন', 'Delivery return')
  const nums = <T extends OpsTotals>(foot: OpsTotals): Array<WCol<T>> => KEYS.map(k => ({ key: k, label: label(k), num: true, sort: true, text: (x: T) => x[k], cell: (x: T) => n(x[k]), foot: <b>{n(foot[k])}</b> }))
  if (q.error && !d) return <Section title={L('পিকআপ · রিটার্ন · ডেলিভারি', 'Pickup · return · delivery')}><p className="da-error" role="alert">{wfFriendly(q.error)}</p></Section>
  if (!d) return <Section title={L('পিকআপ · রিটার্ন · ডেলিভারি', 'Pickup · return · delivery')}><Loading /></Section>
  return <div className={q.loading ? 'wm-stale' : ''}>
    <Section title={L('পিকআপ · রিটার্ন · ডেলিভারি', 'Pickup · return · delivery')} hint={L('কর্মীরা নিজের দেওয়া সংখ্যা — হাব ও জোন অনুযায়ী জমা।', 'Numbers staff gave themselves, collected by hub and zone.')}>
      <div className="da-stats">
        {KEYS.map((k, i) => <Stat key={k} icon={i % 2 ? 'swap' : i ? 'truck' : 'box'} label={label(k)} value={n(d.totals[k])} />)}
        <Stat icon="users" label={L('কতজন দিয়েছেন', 'People gave')} value={n(d.totals.people)} sub={L(`${n(d.totals.entries)}টি এন্ট্রি`, `${d.totals.entries} entries`)} />
        <Stat icon="alert" tone={d.missing_today.length ? 'warn' : 'ok'} label={L('আজ এখনো দেননি', 'Not given today')} value={n(d.missing_today.length)} />
      </div>
    </Section>
    <Section title={L('কর্মী অনুযায়ী', 'By person')}>
      <WmTable<OpsReport['by_person'][number]> cols={[
        { key: 'who', label: L('কর্মী', 'Person'), primary: true, sort: true, text: p => p.name, cell: p => <Who name={p.name} code={p.code} position={p.position} /> },
        { key: 'hub', label: L('হাব', 'Hub'), sort: true, text: p => p.hub_name ?? '', cell: p => p.hub_name ?? '—' },
        { key: 'days', label: L('দিন', 'Days'), num: true, sort: true, text: p => p.days, cell: p => n(p.days) },
        ...nums<OpsReport['by_person'][number]>(d.totals)]} rows={d.by_person} rowKey={p => p.employee_id} grid
        title={L('কর্মী অনুযায়ী পিকআপ-ডেলিভারি', 'Operations by person')} file={`zone-ops-person-${from}`} sub={range}
        empty={<Empty>{L('এই সময়ে কেউ কিছু দেননি।', 'No one gave numbers in this period.')}</Empty>} />
    </Section>
    <Section title={L('দিন অনুযায়ী', 'By day')}>
      <WmTable<OpsReport['by_day'][number]> cols={[
        { key: 'date', label: L('তারিখ', 'Date'), primary: true, sort: true, text: x => x.date, cell: x => <span className="wm-dt"><b>{fmtDay(x.date, lang)}</b><small>{fmtWeekday(x.date, lang)}</small></span> },
        { key: 'people', label: L('কতজন', 'People'), num: true, sort: true, text: x => x.people, cell: x => n(x.people) },
        ...nums<OpsReport['by_day'][number]>(d.totals)]} rows={d.by_day} rowKey={x => x.date} grid defaultSort={{ key: 'date', dir: -1 }}
        title={L('দিন অনুযায়ী পিকআপ-ডেলিভারি', 'Operations by day')} file={`zone-ops-day-${from}`} sub={range} />
    </Section>
    {d.missing_today.length > 0 && <Section title={L(`আজ এখনো দেননি (${n(d.missing_today.length)})`, `Not given today (${d.missing_today.length})`)}>
      <ul className="wm-people">{d.missing_today.map(p => <li key={p.employee_id} className="wm-prow">
        <Who name={p.name} code={p.code} position={[p.position, p.hub_name].filter(Boolean).join(' · ')} /><span className="wm-pst" />
        <Contact phone={p.mobile} showNumber={false} text={L('আজকের পিকআপ-ডেলিভারির সংখ্যা দিন', 'Please give today’s numbers')} /></li>)}</ul>
    </Section>}
  </div>
}

// ====================================================================================== ইতিহাস
function ZoneHistory({ zone, month }: { zone: string; month: string }) {
  const { L, lang } = usePrefs()
  const q = useLiveLoad<History[]>(() => wf.history({ zone: zone || null }, month, 200), [zone, month], LIVE.manage)
  const [find, setFind] = useState('')
  const word = find.trim().toLowerCase()
  const rows = (q.data ?? []).filter(h => !word || `${h.employee_name} ${h.employee_code ?? ''} ${h.hub_name ?? ''} ${h.by_name ?? ''} ${h.note ?? ''}`.toLowerCase().includes(word))
  return <Section title={L('সংশোধন ও সিদ্ধান্তের ইতিহাস', 'Correction & decision history')} hint={`${monthName(month, lang)} — ${L('শেষ তারিখের মাসের ইতিহাস', 'the month of the period’s last day')}`}>
    <div className="wm-filters no-print"><input type="search" className="wm-search" value={find} onChange={e => setFind(e.target.value)} placeholder={L('নাম, হাব বা কথা খুঁজুন…', 'Search name, hub or note…')} aria-label={L('খুঁজুন', 'Search')} /></div>
    {q.error && !q.data ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
    {!q.data && !q.error ? <Loading /> : <div className={q.loading ? 'wm-stale' : ''}>
      <WmTable<History> cols={[
        { key: 'at', label: L('সময়', 'When'), sort: true, text: h => h.at, cell: h => fmtStamp(h.at, lang) },
        { key: 'who', label: L('কর্মী', 'Person'), primary: true, sort: true, text: h => h.employee_name, cell: h => <Who name={h.employee_name} code={h.employee_code} /> },
        { key: 'hub', label: L('হাব', 'Hub'), sort: true, text: h => h.hub_name ?? '', cell: h => h.hub_name ?? '—' },
        { key: 'date', label: L('তারিখ', 'Date'), sort: true, text: h => h.work_date, cell: h => fmtDay(h.work_date, lang) },
        { key: 'act', label: L('কাজ', 'Action'), sort: true, text: h => ACTION_META[h.action].bn, cell: h => <Badge tone={h.action === 'returned' ? 'bad' : h.action === 'approved' ? 'ok' : h.action === 'corrected' ? 'warn' : 'info'}>{lang === 'bn' ? ACTION_META[h.action].bn : ACTION_META[h.action].en}</Badge> },
        { key: 'to', label: L('হয়েছে', 'Became'), text: h => h.to_as ? recordLabel(h.to_as, 'bn') : h.to_kind ?? '', cell: h => h.to_as ? recordLabel(h.to_as, lang) : h.to_kind ? <KindBadge k={h.to_kind} /> : '—' },
        { key: 'note', label: L('কারণ / কথা', 'Note'), text: h => h.note ?? '', cell: h => h.note ? <span className="wm-wrap">{h.note}</span> : <span className="muted">—</span> },
        { key: 'by', label: L('কে', 'By'), text: h => h.by_name ?? '', cell: h => h.by_name ?? '—' },
      ]} rows={rows} rowKey={h => h.id} title={L('হাজিরার ইতিহাস', 'Attendance history')} file={`zone-history-${month.slice(0, 7)}`} sub={monthName(month, lang)}
        empty={<Empty>{L('এই মাসে কোনো ইতিহাস নেই।', 'No history this month.')}</Empty>} />
      {(q.data?.length ?? 0) >= 200 && <p className="muted small">{L('সর্বশেষ ২০০টি দেখানো হচ্ছে।', 'Showing the latest 200.')}</p>}
    </div>}
  </Section>
}
