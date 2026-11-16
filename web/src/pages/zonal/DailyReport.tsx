import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { ATT_WORD, daily, dailyFriendly, OUT_WORD, type ZoneReport } from '../../lib/daily'
import { usePrefs } from '../../lib/prefs'
import { useOrg } from '../hr/common'
import { Badge, Field, Stat, useLoad } from '../accounts/ui'

/**
 * জোনের দৈনিক রিপোর্ট — the zonal manager's day: which hubs sent the absent list (and when), routes of riders who were out
 * (covered? delivery update?), every staff member's day (attendance, sheet, route, bills, own note) and their suggestions.
 * A notice with the summary arrives just after midnight for the day before.
 */
const dhaka = (offset = 0) => new Date(Date.now() + offset * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
type Staff = ZoneReport['staff'][number]

export function DailyReport() {
  const { L, n, lang } = usePrefs()
  const o = useOrg()
  const [sp, setSp] = useSearchParams()
  const [date, setDate] = useState(sp.get('date') || dhaka())
  const zones = (o.data?.zones ?? []).filter(z => !z.archived_at)
  const [zone, setZone] = useState(sp.get('zone') || '')
  useEffect(() => { if (!zone && zones.length) setZone(zones[0].id) }, [zones.length, zone])
  useEffect(() => { setSp(p => { p.set('date', date); if (zone) p.set('zone', zone); return p }, { replace: true }) }, [date, zone])
  const q = useLoad(() => zone ? daily.zoneReport(zone, date) : Promise.resolve(null), [zone, date])
  const v = q.data
  const clock = (t: string) => new Date(t).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })
  const noCover = v?.routes.filter(r => r.problem === 'no_cover') ?? []
  const noUpd = v?.routes.filter(r => r.problem === 'no_update') ?? []
  const notSent = v?.hubs.filter(h => !h.submitted_at) ?? []
  const lateSent = v?.hubs.filter(h => h.late_submit) ?? []
  const sugg = v?.staff.filter(s => s.suggestion) ?? []
  const notes = v?.staff.filter(s => s.work || s.suggestion).length ?? 0
  const sum = (k: 'present' | 'late' | 'half_day' | 'absent' | 'leave' | 'unmarked' | 'staff') => (v?.hubs ?? []).reduce((a, h) => a + h[k], 0)

  return <AppShell title={L('জোনের দৈনিক রিপোর্ট', 'Zone day report')} subtitle={L('রাত ১২টার পর আগের দিনের রিপোর্টের নোটিফিকেশন আসে', 'A notice for the day before arrives after midnight')}>
    <section className="da-filters panel no-print hub-top">
      <Field label={L('জোন / এরিয়া', 'Zone / area')}><select value={zone} onChange={e => setZone(e.target.value)}>
        {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
      <Field label={L('তারিখ', 'Date')}><input type="date" max={dhaka()} value={date} onChange={e => setDate(e.target.value)} /></Field>
      <div className="da-seg" style={{ alignSelf: 'flex-end' }}>
        <button className={date === dhaka() ? 'sm' : 'secondary sm'} onClick={() => setDate(dhaka())}>{L('আজ', 'Today')}</button>
        <button className={date === dhaka(-1) ? 'sm' : 'secondary sm'} onClick={() => setDate(dhaka(-1))}>{L('গতকাল', 'Yesterday')}</button></div>
    </section>
    {q.error ? <p className="da-error">{dailyFriendly(q.error)}</p> : !v ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : <>
      <div className="da-stats">
        <Stat icon="users" label={L('মোট স্টাফ', 'Staff')} value={n(sum('staff'))} />
        <Stat icon="check" tone="ok" label={L('উপস্থিত', 'Present')} value={n(sum('present') + sum('late') + sum('half_day'))} sub={L(`দেরিতে ${n(sum('late'))}`, `late ${sum('late')}`)} />
        <Stat icon="x" tone={sum('absent') ? 'bad' : undefined} label={L('অনুপস্থিত', 'Absent')} value={n(sum('absent'))} sub={L(`ছুটি ${n(sum('leave'))}`, `leave ${sum('leave')}`)} />
        <Stat icon="alert" tone={noCover.length ? 'bad' : noUpd.length ? 'warn' : undefined} label={L('রুট সমস্যা', 'Route problems')} value={n(noCover.length + noUpd.length)} />
        <Stat icon="note" label={L('কাজের নোট / পরামর্শ', 'Notes / suggestions')} value={`${n(notes)} / ${n(sugg.length)}`} />
      </div>

      <section className="panel"><h2>{L('যা ঠিক হয়নি', 'What went wrong')}</h2>
        {!noCover.length && !noUpd.length && !notSent.length && !lateSent.length && !sum('unmarked')
          ? <p className="muted">{L('কোনো সমস্যা নেই।', 'Nothing.')}</p>
          : <ul className="route-ai-f dayrep-prob">
            {noCover.map((r, i) => <li key={`c${i}`} className="t-bad">{r.hub_name}: {L(`"${r.route_name}" রুটে কেউ যায়নি — ${r.absent} ${OUT_WORD[r.reason as keyof typeof OUT_WORD]?.[0] ?? ''}`, `"${r.route_name}" had no cover — ${r.absent} out`)}</li>)}
            {noUpd.map((r, i) => <li key={`u${i}`} className="t-warn">{r.hub_name}: {L(`"${r.route_name}" — ${r.cover} রুট নিয়েছেন, ডেলিভারির আপডেট আসেনি`, `"${r.route_name}" — ${r.cover} covered, no delivery update`)}</li>)}
            {notSent.map(h => <li key={`n${h.hub_id}`} className="t-bad">{h.hub_name}: {L('অনুপস্থিত তালিকা দেয়নি', 'no absent list')}</li>)}
            {lateSent.map(h => <li key={`l${h.hub_id}`} className="t-warn">{h.hub_name}: {L(`১১টার পরে দিয়েছে (${h.submitted_at ? clock(h.submitted_at) : ''})`, `sent after 11 (${h.submitted_at ? clock(h.submitted_at) : ''})`)}</li>)}
            {v.hubs.filter(h => h.unmarked > 0).map(h => <li key={`m${h.hub_id}`} className="t-info">{h.hub_name}: {L(`${n(h.unmarked)} জনের হাজিরা নেই`, `${h.unmarked} without attendance`)}</li>)}
          </ul>}
      </section>

      <section className="panel"><h2>{L('হাব অনুযায়ী হাজিরা', 'Attendance by hub')}</h2>
        <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('হাব', 'Hub')}</th><th className="r">{L('স্টাফ', 'Staff')}</th><th className="r">{L('উপস্থিত', 'Present')}</th>
          <th className="r">{L('দেরি', 'Late')}</th><th className="r">{L('অর্ধ', 'Half')}</th><th className="r">{L('অনুপস্থিত', 'Absent')}</th><th className="r">{L('ছুটি', 'Leave')}</th>
          <th className="r">{L('বাকি', 'Unmarked')}</th><th>{L('অনুপস্থিত তালিকা', 'Absent list')}</th><th className="r">{L('সংশোধন', 'Fixes')}</th></tr></thead>
          <tbody>{v.hubs.map(h => <tr key={h.hub_id}><td><strong>{h.hub_name}</strong></td><td className="r">{n(h.staff)}</td><td className="r">{n(h.present)}</td><td className="r">{n(h.late)}</td>
            <td className="r">{n(h.half_day)}</td><td className={`r${h.absent ? ' bad' : ''}`}>{n(h.absent)}</td><td className="r">{n(h.leave)}</td><td className={`r${h.unmarked ? ' bad' : ''}`}>{n(h.unmarked)}</td>
            <td>{h.submitted_at ? <Badge tone={h.late_submit ? 'warn' : 'ok'}>{clock(h.submitted_at)}{h.submitted_by ? ` · ${h.submitted_by}` : ''}</Badge> : <Badge tone="bad">{L('দেয়নি', 'Not sent')}</Badge>}</td>
            <td className="r">{n(h.corrections)}</td></tr>)}</tbody></table></div>
      </section>

      {v.routes.length > 0 && <section className="panel"><h2>{L('ছুটিতে / অনুপস্থিত রাইডারের রুট', 'Routes of riders who were out')}</h2>
        <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('হাব', 'Hub')}</th><th>{L('রুট', 'Route')}</th><th>{L('রাইডার', 'Rider')}</th>
          <th>{L('কে নিয়েছেন', 'Covered by')}</th><th>{L('ডেলিভারি', 'Delivery')}</th></tr></thead>
          <tbody>{v.routes.map((r, i) => <tr key={i}><td>{r.hub_name}</td><td><strong>{r.route_name}</strong></td>
            <td>{r.absent}{r.absent_code ? ` · ${r.absent_code}` : ''}<span className="sec">{L(OUT_WORD[r.reason as keyof typeof OUT_WORD]?.[0] ?? r.reason, OUT_WORD[r.reason as keyof typeof OUT_WORD]?.[1] ?? r.reason)}</span></td>
            <td>{r.cover ? <>{r.cover}{r.cover_phone && <span className="sec"><a href={`tel:${r.cover_phone}`}>{r.cover_phone}</a></span>}</> : <Badge tone="bad">{L('কেউ না', 'Nobody')}</Badge>}</td>
            <td>{r.sheet ? L(`${n(r.sheet.delivery)}টি (খাতা)`, `${r.sheet.delivery} (sheet)`) : r.delivered != null ? L(`${n(r.delivered)}টি`, `${r.delivered}`) : r.cover ? <Badge tone="warn">{L('আপডেট নেই', 'No update')}</Badge> : '—'}
              {r.update_note && <span className="sec">{r.update_note}</span>}</td></tr>)}</tbody></table></div>
      </section>}

      {sugg.length > 0 && <section className="panel"><h2><Icon name="note" size={17} /> {L('স্টাফদের পরামর্শ', 'Staff suggestions')} <span className="count-pill">{n(sugg.length)}</span></h2>
        <div className="dayrep-sugg">{sugg.map(s => <article key={s.employee_id}><b>{s.full_name}</b> <span className="muted small">{[s.employee_code, s.hub_name, s.position].filter(Boolean).join(' · ')}</span>
          <p className="pre-wrap" style={{ margin: '4px 0 0' }}>{s.suggestion}</p></article>)}</div></section>}

      <section className="panel">
        <DataTable<Staff> title={`${L('স্টাফের কাজের রিপোর্ট', 'Staff work report')} ${date}`} file={`zone-day-${date}`} rows={v.staff} rowKey={r => r.employee_id}
          empty={<p className="muted">{L('কেউ নেই।', 'Nobody.')}</p>}
          cols={[
            { key: 'code', label: L('আইডি', 'ID'), value: r => r.employee_code ?? '' },
            { key: 'name', label: L('নাম', 'Name'), value: r => r.full_name, render: r => <><strong>{r.full_name}</strong>{r.position && <span className="sec">{r.position}</span>}</> },
            { key: 'hub', label: L('হাব', 'Hub'), value: r => r.hub_name },
            { key: 'att', label: L('হাজিরা', 'Attendance'), value: r => r.attendance ? L(ATT_WORD[r.attendance][0], ATT_WORD[r.attendance][1]) : L('নেই', 'None'),
              render: r => r.attendance ? <Badge tone={ATT_WORD[r.attendance][2]}>{L(ATT_WORD[r.attendance][0], ATT_WORD[r.attendance][1])}</Badge> : <Badge tone="neutral">{L('নেই', 'None')}</Badge> },
            { key: 'del', label: L('ডেলিভারি', 'Delivery'), className: 'r', value: r => r.sheet ? n(r.sheet.delivery) : '' },
            { key: 'pick', label: L('পিকআপ', 'Pickup'), className: 'r', value: r => r.sheet ? n(r.sheet.pickup) : '' },
            { key: 'route', label: L('রুট', 'Route'), value: r => [r.routes, r.covered_for && L(`+ ${r.covered_for}-এর রুট`, `+ covered ${r.covered_for}`)].filter(Boolean).join(' ') },
            { key: 'bills', label: L('বিল', 'Bills'), className: 'r', value: r => r.bills ? n(r.bills) : '' },
            { key: 'work', label: L('কাজের নোট', 'Work note'), value: r => r.work ?? '', render: r => r.work ? <span className="pre-wrap">{r.work}</span> : <span className="muted">—</span> },
            { key: 'sugg', label: L('পরামর্শ', 'Suggestion'), value: r => r.suggestion ?? '' },
          ]} />
      </section>
    </>}
  </AppShell>
}
