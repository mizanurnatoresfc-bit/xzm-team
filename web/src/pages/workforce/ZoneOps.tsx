import { Contact } from '../../components/Contact'
import { usePrefs } from '../../lib/prefs'
import { LIVE, useLiveLoad, wf, wfFriendly, type OpsReport, type OpsTotals } from '../../lib/workforce'
import { Stat } from '../accounts/ui'
import { Empty, Loading, RangeBar, Section, Who, WmTable, fmtDay, fmtWeekday, useRange, type WCol } from './shared'

/**
 * জোনের পিকআপ · রিটার্ন · ডেলিভারি — the four numbers staff give, summed over every hub the zonal manager may see.
 * A report (no editing); a hub's own corrections are on that hub's "দৈনিক রিপোর্ট" tab of the attendance page.
 */
const KEYS = ['pickup', 'pickup_return', 'delivery', 'delivery_return'] as const

export function ZoneOps({ zone }: { zone: string }) {
  const { L, n, lang } = usePrefs()
  const r = useRange('today')
  const { from, to } = r
  const range = `${fmtDay(from, lang)}${from !== to ? ` – ${fmtDay(to, lang)}` : ''}`
  const q = useLiveLoad<OpsReport>(() => wf.opsReport({ zone: zone || null }, from, to), [zone, from, to], LIVE.manage)
  const d = q.data
  const label = (k: typeof KEYS[number]) => k === 'pickup' ? L('পিকআপ', 'Pickup') : k === 'pickup_return' ? L('পিকআপ রিটার্ন', 'Pickup return') : k === 'delivery' ? L('ডেলিভারি', 'Delivery') : L('ডেলিভারি রিটার্ন', 'Delivery return')
  const nums = <T extends OpsTotals>(foot: OpsTotals): Array<WCol<T>> => KEYS.map(k => ({ key: k, label: label(k), num: true, sort: true, text: (x: T) => x[k], cell: (x: T) => n(x[k]), foot: <b>{n(foot[k])}</b> }))
  const title = L('পিকআপ · রিটার্ন · ডেলিভারি', 'Pickup · return · delivery')

  return <>
    <Section title={title} hint={L('কর্মীরা নিজের দেওয়া সংখ্যা — হাব ও জোন অনুযায়ী জমা।', 'Numbers staff gave themselves, collected by hub and zone.')}>
      <RangeBar r={r} presets={['today', '7d', 'month', 'custom']} />
      {q.error && !d ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
      {!d && !q.error ? <Loading /> : null}
      {d && <div className={`da-stats${q.loading ? ' wm-stale' : ''}`}>
        {KEYS.map((k, i) => <Stat key={k} icon={i % 2 ? 'swap' : i ? 'truck' : 'box'} label={label(k)} value={n(d.totals[k])} />)}
        <Stat icon="users" label={L('কতজন দিয়েছেন', 'People gave')} value={n(d.totals.people)} sub={L(`${n(d.totals.entries)}টি এন্ট্রি`, `${d.totals.entries} entries`)} />
        <Stat icon="alert" tone={d.missing_today.length ? 'warn' : 'ok'} label={L('আজ এখনো দেননি', 'Not given today')} value={n(d.missing_today.length)} />
      </div>}
    </Section>
    {d && <div className={q.loading ? 'wm-stale' : ''}>
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
    </div>}
  </>
}
