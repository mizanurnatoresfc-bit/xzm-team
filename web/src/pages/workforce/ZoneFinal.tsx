import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LIVE_SHEET, REASON_META, att, type ZoneDay, type ZoneDayHub } from '../../lib/attSheet'
import { todayDhaka } from '../../lib/dailyAccounts'
import { usePrefs } from '../../lib/prefs'
import { useLiveLoad, wfFriendly } from '../../lib/workforce'
import { Badge, Field } from '../accounts/ui'
import { Empty, KindBadge, Loading, Section, Who, WmTable, fmtDay, fmtLong, fmtStamp, fmtTime, recordLabel, type WCol } from './shared'
import '../../att-sheet.css'

/**
 * জোনাল ম্যানেজার — দৈনিক হাজিরার তথ্য. Nothing is approved here. Three lists for one date:
 *   1. what staff gave themselves, 2. who gave nothing (by position), 3. each hub's final register (state, numbers, checks),
 * plus the explanations asked and the replies. A tap on a hub opens its register, where the zonal manager can see the
 * preview, send it to the hub's managers for checking, or unlock it.
 */
export function ZoneFinal({ zone }: { zone: string }) {
  const { L, n, lang } = usePrefs()
  const nav = useNavigate()
  const today = todayDhaka()
  const [date, setDate] = useState(today)
  const q = useLiveLoad<ZoneDay>(() => att.zoneDay(zone || null, date), [zone, date], LIVE_SHEET)
  const d = q.data && q.data.date === date ? q.data : null
  const open = (h: ZoneDayHub) => nav(`/app/workforce/hub?hub=${h.hub_id}&tab=final&date=${date}`)
  const v = (x: number, tone?: 'warn' | 'bad') => <span className={x ? (tone ? `wm-v ${tone}` : 'wm-v') : 'wm-v zero'}>{n(x)}</span>

  const cols: Array<WCol<ZoneDayHub>> = [
    { key: 'hub', label: L('হাব', 'Hub'), primary: true, sort: true, text: h => h.name ?? '', cell: h => <b>{h.name}</b> },
    { key: 'staff', label: L('স্টাফ', 'Staff'), num: true, text: h => h.staff, cell: h => n(h.staff) },
    { key: 'given', label: L('নিজে দিয়েছেন', 'Gave themself'), num: true, text: h => h.given, cell: h => v(h.given) },
    { key: 'st', label: L('ফাইনাল খাতা', 'Final register'), sort: true, text: h => h.status === 'submitted' ? 'সাবমিট' : h.status === 'draft' ? 'খসড়া' : 'শুরু হয়নি',
      cell: h => h.status === 'submitted' ? <Badge tone="ok">{L('সাবমিট', 'Submitted')} · {fmtTime(h.submitted_at!, lang)}</Badge>
        : h.status === 'draft' ? <Badge tone="warn">{L('খসড়া', 'Draft')}</Badge> : <Badge tone="bad">{L('শুরু হয়নি', 'Not started')}</Badge> },
    { key: 'p', label: L('উপস্থিত', 'Present'), num: true, text: h => h.present, cell: h => v(h.present) },
    { key: 'l', label: L('দেরি', 'Late'), num: true, text: h => h.late, cell: h => v(h.late, 'warn') },
    { key: 'a', label: L('অনুপস্থিত', 'Absent'), num: true, text: h => h.absent, cell: h => v(h.absent, 'bad') },
    { key: 'u', label: L('না জানিয়ে', 'Without telling'), num: true, text: h => h.unauthorized, cell: h => v(h.unauthorized, 'bad') },
    { key: 'ck', label: L('ম্যানেজারদের যাচাই', 'Managers’ check'), text: h => h.checks ? `${h.checks_ok}/${h.checks}` : '—',
      cell: h => h.checks ? <Badge tone={h.checks_ok === h.checks ? 'ok' : 'warn'}>{n(h.checks_ok)}/{n(h.checks)} {L('ঠিক আছে', 'OK')}</Badge> : h.status === 'submitted' ? <span className="muted small">{L('পাঠানো হয়নি', 'Not sent')}</span> : '—' },
  ]

  return <Section title={L('দৈনিক হাজিরার তথ্য (ফাইনাল খাতা)', 'Daily attendance data (final register)')}
    hint={L('এখানে কোনো অনুমোদন নেই — শুধু তথ্য। হাবে ট্যাপ করলে সেই দিনের খাতা খোলে: সেখান থেকে প্রিভিউ দেখে ম্যানেজারদের যাচাইয়ে পাঠাতে বা লক খুলে দিতে পারবেন।',
      'No approving here — data only. Tap a hub to open that day’s register: preview it, send it to the managers for checking, or unlock it.')}
    tools={<Field label={L('তারিখ', 'Date')}><input type="date" value={date} max={today} onChange={e => e.target.value && setDate(e.target.value)} /></Field>}>
    {q.error && !d ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
    {!d && !q.error ? <Loading /> : null}
    {d && <div className={q.loading ? 'wm-stale' : ''}>
      <h3 className="wm-sub">{L('৩. হাব অনুযায়ী ম্যানেজারের ফাইনাল খাতা', '3. Each hub’s final register')} — {fmtLong(date, lang)}</h3>
      <WmTable<ZoneDayHub> cols={cols} rows={d.hubs} rowKey={h => h.hub_id} onRow={open} grid title={L('ফাইনাল হাজিরা খাতা — হাব অনুযায়ী', 'Final registers by hub')}
        file={`final-registers-${date}`} sub={fmtDay(date, lang)} empty={<Empty>{L('দেখার মতো কোনো হাব নেই।', 'No hub.')}</Empty>} />

      <h3 className="wm-sub">{L('১. স্টাফের নিজের দেওয়া হাজিরা', '1. What staff gave themselves')}</h3>
      <WmTable cols={[
        { key: 'who', label: L('কর্মী', 'Person'), primary: true, sort: true, text: m => m.name, cell: m => <Who name={m.name} code={m.code} position={m.position} /> },
        { key: 'hub', label: L('হাব', 'Hub'), sort: true, text: m => m.hub ?? '', cell: m => m.hub ?? '—' },
        { key: 'k', label: L('দিয়েছেন', 'Gave'), text: m => m.kind === 'present' ? 'উপস্থিত' : 'অনুপস্থিত', cell: m => <KindBadge k={m.kind} /> },
        { key: 't', label: L('সময়', 'Time'), text: m => fmtTime(m.marked_at, lang), cell: m => fmtTime(m.marked_at, lang) },
        { key: 'n', label: L('কারণ / কথা', 'Note'), text: m => [m.note, m.site_applied_on ? `আবেদন ${m.site_applied_on}` : null, m.site_ref].filter(Boolean).join(' · '),
          cell: m => <span className="wm-wrap">{[m.note, m.site_applied_on ? `${L('আবেদন', 'Applied')} ${fmtDay(m.site_applied_on, lang)}` : null, m.site_ref].filter(Boolean).join(' · ') || '—'}</span> },
      ] as Array<WCol<ZoneDay['marks'][number]>>} rows={d.marks} rowKey={m => m.employee_id} title={L('স্টাফের নিজের দেওয়া হাজিরা', 'Staff inputs')} file={`staff-inputs-${date}`}
        empty={<Empty>{L('এই তারিখে কেউ নিজে হাজিরা দেননি।', 'No one gave their own attendance on this date.')}</Empty>} />

      <h3 className="wm-sub">{L('২. যাঁরা নিজে হাজিরা দেননি — পদবী অনুযায়ী', '2. Who gave nothing — by position')}</h3>
      {!d.missing.length ? <Empty>{L('সবাই নিজে হাজিরা দিয়েছেন।', 'Everyone gave.')}</Empty> :
        <ul className="wm-sum">{d.missing.map(m => <li key={m.position}><b>{m.position}: {n(m.count)} {L('জন', '')}</b>
          <details><summary className="muted small">{L('নাম দেখুন', 'Show names')}</summary>
            <ul className="as-zone-people">{m.people.map((p, i) => <li key={i}>{p.name}{p.code ? ` (${n(p.code)})` : ''} — {p.hub}</li>)}</ul></details></li>)}</ul>}

      <h3 className="wm-sub">{L('ব্যাখ্যা ও জবাব', 'Explanations and replies')}</h3>
      <WmTable cols={[
        { key: 'who', label: L('কর্মী', 'Person'), primary: true, sort: true, text: x => x.name, cell: x => <Who name={x.name} code={x.code} /> },
        { key: 'hub', label: L('হাব', 'Hub'), sort: true, text: x => x.hub ?? '', cell: x => x.hub ?? '—' },
        { key: 'r', label: L('কেন', 'Why'), text: x => REASON_META[x.reason].bn, cell: x => <Badge tone="warn">{L(REASON_META[x.reason].bn, REASON_META[x.reason].en)}</Badge> },
        { key: 's', label: L('খাতায় হাজিরা', 'On the register'), text: x => recordLabel(x.final_status, 'bn'), cell: x => recordLabel(x.final_status, lang) },
        { key: 'lt', label: L('দেরির সময়', 'Late time'), text: x => x.late_time ?? '', cell: x => x.late_time ?? '—' },
        { key: 'ad', label: L('আবেদনের তারিখ', 'Application date'), text: x => x.absence_app_date ?? '', cell: x => x.absence_app_date ? fmtDay(x.absence_app_date, lang) : '—' },
        { key: 'rp', label: L('জবাব', 'Reply'), text: x => x.reply ?? '', cell: x => x.reply ? <span className="wm-wrap">{x.reply} <small className="muted">({fmtStamp(x.replied_at, lang)})</small></span>
          : <Badge tone="warn">{L('জবাব বাকি', 'No reply yet')}</Badge> },
      ] as Array<WCol<ZoneDay['explanations'][number]>>} rows={d.explanations} rowKey={x => x.id} title={L('হাজিরার ব্যাখ্যা ও জবাব', 'Attendance explanations')} file={`explanations-${date}`}
        empty={<Empty>{L('এই তারিখে কোনো ব্যাখ্যা চাওয়া হয়নি।', 'No explanation asked on this date.')}</Empty>} />
    </div>}
  </Section>
}
