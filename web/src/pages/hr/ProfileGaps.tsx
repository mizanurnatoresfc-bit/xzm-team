// Profile completeness by the "New Admin & Rider ID Create" format: what every person (old and new)
// still lacks before an ID can be opened — hub by hub, with a link to fill it in and an Excel list.
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Badge, Field, Stat, useLoad } from '../accounts/ui'
import { bn, hr, hrFriendly, MISSING, type ProfileGap } from '../../lib/hr'
import { xlsxBlob, download } from '../../lib/xlsx'
import { useOrg } from './common'

const label = (k: string) => MISSING[k] ?? k.replace(/^(field|document):/, '')
const pct = (g: ProfileGap) => Math.round(100 * (g.total_checks - g.missing.length) / Math.max(1, g.total_checks))

export function ProfileGaps() {
  const [sp, setSp] = useSearchParams()
  const hub = sp.get('hub') ?? ''
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [item, setItem] = useState('')
  const [q, setQ] = useState('')
  const o = useOrg()
  const d = useLoad(() => hr.profileGaps(null, null), [])
  const all = d.data ?? []

  // hub cards: everyone, how many still lack something
  const hubs = useMemo(() => {
    const m = new Map<string, { id: string; name: string; total: number; open: number }>()
    for (const g of all) {
      const k = g.hub_id ?? 'none'
      const x = m.get(k) ?? { id: k, name: g.hub_name ?? 'হাব নেই', total: 0, open: 0 }
      x.total++; if (g.missing.length) x.open++
      m.set(k, x)
    }
    return [...m.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))
  }, [all])

  const inHub = all.filter(g => !hub || (g.hub_id ?? 'none') === hub)
  // which item is missing most often (in the chosen hub)
  const items = useMemo(() => {
    const c = new Map<string, number>()
    for (const g of inHub) for (const k of g.missing) c.set(k, (c.get(k) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [inHub])

  const rows = inHub.filter(g => (!onlyOpen || g.missing.length > 0) && (!item || g.missing.includes(item))
    && (!q || `${g.full_name} ${g.employee_code ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const open = inHub.filter(g => g.missing.length).length
  const hubName = hub ? hubs.find(h => h.id === hub)?.name ?? '' : 'সব হাব'

  function excel() {
    download(xlsxBlob(`প্রোফাইল পূর্ণতা — ${hubName}`, 'আইডি খোলার তথ্য (New Admin & Rider ID Create ফরম্যাট)',
      ['হাব', 'আইডি', 'নাম', 'পদবি', 'অবস্থা', 'পূর্ণ %', 'যা বাকি'],
      rows.map(g => [g.hub_name ?? '', g.employee_code ?? '', g.full_name, g.position_name_bn ?? g.position_name ?? '',
        g.status === 'applicant' ? 'আবেদন' : 'সক্রিয়', pct(g), g.missing.map(label).join(', ')])),
      `profile-gaps-${hubName.replace(/[^\p{L}\p{N}]+/gu, '-')}.xlsx`)
  }

  return <AppShell title="প্রোফাইল পূর্ণতা" subtitle="আইডি খুলতে যে তথ্য লাগে — কার কী বাকি, হাব অনুযায়ী">
    {d.error ? <p className="da-error">{hrFriendly(d.error)}</p> : null}
    <p className="muted small">দেখা হয়: নাম, মোবাইল, বিকল্প মোবাইল, হাব, পদবি, Gmail (শুধু অ্যাডমিন পদ), রক্তের গ্রুপ, জন্মতারিখ, স্থায়ী ঠিকানা, রেফারেন্স,
      NID/জন্মনিবন্ধন নম্বর, কর্মীর ছবি, NID সামনে ও পেছনে, বেতন (Basic)। নতুন-পুরোনো সবার জন্য একই নিয়ম।</p>

    <div className="da-stats">
      <Stat label={`মোট কর্মী — ${hubName}`} value={bn(inHub.length)} />
      <Stat label="সম্পূর্ণ" value={bn(inHub.length - open)} tone="ok" />
      <Stat label="অসম্পূর্ণ" value={bn(open)} tone={open ? 'bad' : 'ok'} sub={inHub.length ? `${bn(Math.round(100 * (inHub.length - open) / inHub.length))}% সম্পূর্ণ` : undefined} />
    </div>

    <section className="panel">
      <h2>হাব অনুযায়ী</h2>
      <div className="pg-hubs">
        <button type="button" className={`pg-hub${!hub ? ' on' : ''}`} onClick={() => setSp({})}>
          <b>সব হাব</b><span>{bn(all.filter(g => g.missing.length).length)} / {bn(all.length)} বাকি</span></button>
        {hubs.map(h => <button key={h.id} type="button" className={`pg-hub${hub === h.id ? ' on' : ''}`} onClick={() => setSp({ hub: h.id })}>
          <b>{o.names.hub[h.id] ?? h.name}</b>
          <span>{h.open ? <Badge tone="bad">{bn(h.open)} জন বাকি</Badge> : <Badge tone="ok">সব সম্পূর্ণ</Badge>} মোট {bn(h.total)}</span>
          <i className="pg-bar"><i style={{ width: `${Math.round(100 * (h.total - h.open) / Math.max(1, h.total))}%` }} /></i>
        </button>)}
      </div>
    </section>

    {items.length > 0 && <section className="panel">
      <h2>সবচেয়ে বেশি যা বাকি — {hubName}</h2>
      <div className="da-chips">
        <button type="button" className={`chip${!item ? ' on' : ''}`} onClick={() => setItem('')}>সব</button>
        {items.map(([k, n]) => <button key={k} type="button" className={`chip${item === k ? ' on' : ''}`} onClick={() => setItem(item === k ? '' : k)}>
          {label(k)} · {bn(n)}</button>)}
      </div>
    </section>}

    <section className="panel">
      <div className="da-bar"><h2>কর্মী তালিকা ({bn(rows.length)})</h2>
        <div className="row no-print">
          <label className="da-check" style={{ margin: 0 }}><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> শুধু অসম্পূর্ণ</label>
          <button className="secondary" onClick={excel} disabled={!rows.length}>Excel</button>
        </div></div>
      <Field label="খুঁজুন"><input value={q} placeholder="নাম বা আইডি" onChange={e => setQ(e.target.value)} /></Field>
      <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>আইডি</th><th>নাম</th><th>পদবি</th><th>হাব</th><th>পূর্ণ</th><th>যা বাকি</th><th className="no-print" /></tr></thead>
        <tbody>{rows.map(g => <tr key={g.employee_id}>
          <td data-l="আইডি">{g.employee_code ? bn(g.employee_code) : <Badge tone="info">আবেদন</Badge>}</td>
          <td data-l="নাম"><b>{g.full_name}</b></td>
          <td data-l="পদবি">{g.position_name_bn ?? g.position_name ?? '—'}</td>
          <td data-l="হাব">{g.hub_id ? o.names.hub[g.hub_id] ?? g.hub_name : '—'}</td>
          <td data-l="পূর্ণ"><Badge tone={g.missing.length === 0 ? 'ok' : pct(g) >= 70 ? 'warn' : 'bad'}>{bn(pct(g))}%</Badge></td>
          <td data-l="যা বাকি">{g.missing.length ? <span className="pg-miss">{g.missing.map(k => <span key={k}>{label(k)}</span>)}</span> : <span className="muted">—</span>}</td>
          <td className="no-print"><Link className="btn-ghost pg-go" to={`/app/hr/employees/${g.employee_id}`}>{g.missing.length ? 'পূরণ করুন' : 'দেখুন'}</Link></td>
        </tr>)}
          {!d.loading && rows.length === 0 && <tr><td colSpan={7} className="muted">{onlyOpen ? 'এখানে সবার প্রোফাইল সম্পূর্ণ।' : 'কেউ নেই।'}</td></tr>}</tbody>
      </table></div>
    </section>
  </AppShell>
}
