// মাসিক রিপোর্ট — the month's rent, electricity, wifi and other bills of every place on this side (Office or Residential),
// what is still missing, and the contracts that are ending. Read-only; Excel, PDF and print come with the lists.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { Field, Stat, Badge, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { scopePath, type OfficeScope, type Property } from '../../lib/office'
import { BILL_KIND, daysLeft, ops, opsFriendly, type Bill, type BillKind } from '../../lib/officeOps'

const KINDS: BillKind[] = ['rent', 'electricity', 'wifi', 'other']
const dhaka = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })

type Line = { p: Property; hub: string; by: Record<BillKind, number>; total: number; count: number; rentMissing: boolean }

export function Reports({ scope, places, hubName, onPick }: { scope: OfficeScope; places: Property[]; hubName: (id: string | null) => string; onPick: (id: string) => void }) {
  const { L, n, lang } = usePrefs()
  const go = useNavigate()
  const [month, setMonth] = useState(() => dhaka().slice(0, 7))
  const first = `${month}-01`
  const ids = places.map(p => p.id).sort().join(',')
  const bills = useLoad(() => ops.billsOfMonth(ids ? ids.split(',') : [], first), [ids, first])
  const current = month === dhaka().slice(0, 7)
  const today = Number(dhaka().slice(8, 10))

  const lines: Line[] = useMemo(() => places.map(p => {
    const mine = (bills.data ?? []).filter((b: Bill) => b.property_id === p.id)
    const by = Object.fromEntries(KINDS.map(k => [k, mine.filter(b => b.kind === k).reduce((s, b) => s + Number(b.amount), 0)])) as Record<BillKind, number>
    // Rent is "missing" when the place pays rent and none is written: for a past month always, for this month once the rent day has passed.
    const due = !current || (p.rent_due_day != null && today > p.rent_due_day)
    return { p, hub: hubName(p.hub_id), by, total: KINDS.reduce((s, k) => s + by[k], 0), count: mine.length, rentMissing: !!p.rent && !by.rent && due }
  }), [places, bills.data, hubName, current, today])

  const sum = (k: BillKind) => lines.reduce((s, l) => s + l.by[k], 0)
  const grand = lines.reduce((s, l) => s + l.total, 0)
  const missing = lines.filter(l => l.rentMissing)
  const tk = (v: number) => v ? `৳ ${n(Math.round(v))}` : '—'
  const monthName = new Date(first + 'T00:00:00').toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { month: 'long', year: 'numeric' })
  const open = (id: string, key: string) => { onPick(id); go(scopePath(scope, key)) }

  const contracts = places.map(p => ({ p, hub: hubName(p.hub_id), left: daysLeft(p.contract_to) }))
    .filter(c => c.left != null && c.left <= 90).sort((a, b) => (a.left ?? 0) - (b.left ?? 0))
  const side = scope === 'residential' ? L('আবাসিক', 'Residential') : L('অফিস', 'Office')

  return <>
    <section className="panel no-print">
      <div className="da-bar"><h2>{L(`${side} — মাসিক খরচ`, `${side} — monthly costs`)}</h2>
        <Field label={L('মাস', 'Month')}><input type="month" value={month} max={dhaka().slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} /></Field></div>
    </section>
    <div className="da-stats">
      <Stat icon="cash" label={L('মোট খরচ', 'Total')} value={bills.data ? tk(grand) : '…'} sub={monthName} />
      {KINDS.filter(k => k !== 'other' || sum('other')).map(k => <Stat key={k} icon={BILL_KIND[k][2]} label={L(BILL_KIND[k][0], BILL_KIND[k][1])} value={bills.data ? tk(sum(k)) : '…'} />)}
      <Stat icon="alert" label={L('ভাড়া লেখা হয়নি', 'Rent not recorded')} value={bills.data ? n(missing.length) : '…'} tone={missing.length ? 'bad' : 'ok'} />
    </div>
    {bills.error ? <p className="da-error">{opsFriendly(bills.error)}</p> : null}
    <section className="panel">
      <DataTable<Line> title={`${side} — ${L('মাসিক খরচ', 'monthly costs')} — ${monthName}`} file={`${scope}-costs-${month}`} rows={bills.loading ? null : lines} rowKey={l => l.p.id} phoneView="card"
        onRowClick={l => open(l.p.id, l.rentMissing ? 'rent' : 'bills')}
        empty={<p className="muted">{L('এই দিকে কোনো জায়গা নেই।', 'No places on this side.')}</p>}
        cols={[
          { key: 'name', label: L('জায়গা', 'Place'), primary: true, value: l => l.p.name, render: l => <><strong>{l.p.name}</strong>{l.hub && <span className="sec">{l.hub}</span>}</> },
          { key: 'hub', label: L('হাব', 'Hub'), hidden: true, value: l => l.hub },
          ...KINDS.map(k => ({ key: k, label: L(BILL_KIND[k][0], BILL_KIND[k][1]), className: 'r', value: (l: Line) => l.by[k] || '',
            render: (l: Line) => k === 'rent' && l.rentMissing ? <Badge tone="bad">{L('বাকি', 'Missing')}</Badge> : tk(l.by[k]) })),
          { key: 'total', label: L('মোট', 'Total'), className: 'r', value: l => l.total || '', render: l => <b>{tk(l.total)}</b> },
          { key: 'count', label: L('বিল', 'Bills'), className: 'r', value: l => l.count },
        ]} />
      <p className="muted small">{L('এখানে শুধু "ভাড়া ও চুক্তি" ও "বিল" পাতায় লেখা বিল গোনা হয়। কোনো লাইনে চাপলে সেই জায়গার বিলের পাতা খুলবে।', 'Only bills written on the Rent and Bills pages are counted. Tap a line to open that place’s bills.')}</p>
    </section>
    <section className="panel">
      <h2>{L('চুক্তির মেয়াদ (৯০ দিনের মধ্যে / শেষ)', 'Contracts ending within 90 days / ended')} <span className="count-pill">{n(contracts.length)}</span></h2>
      <DataTable title={`${side} — ${L('চুক্তির মেয়াদ', 'contracts')}`} file={`${scope}-contracts`} rows={contracts} rowKey={c => c.p.id} views={['table', 'list']}
        onRowClick={c => open(c.p.id, 'rent')} empty={<p className="muted">{L('৯০ দিনের মধ্যে কোনো চুক্তি শেষ হচ্ছে না।', 'No contract ends within 90 days.')}</p>}
        cols={[
          { key: 'name', label: L('জায়গা', 'Place'), primary: true, value: c => c.p.name },
          { key: 'hub', label: L('হাব', 'Hub'), value: c => c.hub },
          { key: 'to', label: L('শেষ তারিখ', 'Ends on'), value: c => c.p.contract_to ?? '' },
          { key: 'left', label: L('অবস্থা', 'State'), value: c => c.left ?? '', render: c => (c.left ?? 0) < 0
            ? <Badge tone="bad">{L(`${n(-(c.left ?? 0))} দিন আগে শেষ`, `ended ${-(c.left ?? 0)} days ago`)}</Badge>
            : <Badge tone={(c.left ?? 0) <= 30 ? 'bad' : 'warn'}>{L(`${n(c.left ?? 0)} দিন বাকি`, `${c.left} days left`)}</Badge> },
          { key: 'owner', label: L('মালিক', 'Landlord'), value: c => [c.p.owner_name, c.p.owner_phone].filter(Boolean).join(' · ') },
        ]} />
    </section>
  </>
}
