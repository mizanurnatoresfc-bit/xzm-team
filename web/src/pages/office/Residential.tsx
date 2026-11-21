// আবাসিকের সারসংক্ষেপ — every residence the person may see on one page: who lives where, rent and contract,
// and this month's bills. Read-only: it only reads office_properties / office_residents / office_bills,
// and each row opens the flat's own page (people, rent, bills) where changes are made.
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { Badge, Stat, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { scopePath, type Property } from '../../lib/office'
import { daysLeft, ops, opsFriendly, type Bill, type Resident } from '../../lib/officeOps'
import { useOfficeOutput } from './useOutput'

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral'
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }).slice(0, 8) + '01'
const dayOfMonth = () => Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }).slice(8, 10))

type Row = { p: Property; hub: string; people: number; contract: number | null; rentBill: Bill | null; power: Bill | null; rentState: 'paid' | 'due' | 'late' | 'none' }

export function ResidentialOverview({ flats, hubName, onPick }: { flats: Property[]; hubName: (id: string | null) => string; onPick: (id: string) => void }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const go = useNavigate()
  const output = useOfficeOutput('residential-overview')
  const ids = flats.map(f => f.id).sort().join(',')
  const month = thisMonth()
  const seeBills = can('office.bill.view')
  const res = useLoad(() => ops.residentsOf(ids ? ids.split(',') : []), [ids])
  const bills = useLoad(() => seeBills ? ops.billsOfMonth(ids ? ids.split(',') : [], month) : Promise.resolve([] as Bill[]), [ids, month, seeBills])
  const today = dayOfMonth()

  const rows: Row[] = useMemo(() => flats.map(p => {
    const people = (res.data ?? []).filter((r: Resident) => r.property_id === p.id).length
    const mine = (bills.data ?? []).filter(b => b.property_id === p.id)
    const rentBill = mine.find(b => b.kind === 'rent') ?? null
    const rentState: Row['rentState'] = rentBill ? 'paid' : !p.rent ? 'none' : p.rent_due_day && today > p.rent_due_day ? 'late' : 'due'
    return { p, hub: hubName(p.hub_id), people, contract: daysLeft(p.contract_to), rentBill, power: mine.find(b => b.kind === 'electricity') ?? null, rentState }
  }), [flats, res.data, bills.data, hubName, today])

  const open = (id: string, key: string) => { onPick(id); go(scopePath('residential', key)) }
  const people = rows.reduce((s, r) => s + r.people, 0)
  const beds = rows.reduce((s, r) => s + (r.p.capacity ?? 0), 0)
  const ending = rows.filter(r => r.contract != null && r.contract <= 60)
  const late = rows.filter(r => r.rentState === 'late')
  const monthRent = rows.reduce((s, r) => s + (r.p.rent ?? 0), 0)

  // What needs a person's attention, most urgent first.
  const todo: Array<{ tone: Tone; text: string; id: string; key: string }> = []
  for (const r of rows) {
    if (r.contract != null && r.contract < 0) todo.push({ tone: 'bad', id: r.p.id, key: 'rent', text: L(`${r.p.name}: চুক্তির মেয়াদ ${n(-r.contract)} দিন আগে শেষ`, `${r.p.name}: contract ended ${-r.contract} days ago`) })
    else if (r.contract != null && r.contract <= 60) todo.push({ tone: 'warn', id: r.p.id, key: 'rent', text: L(`${r.p.name}: চুক্তি ${n(r.contract)} দিনে শেষ হবে`, `${r.p.name}: contract ends in ${r.contract} days`) })
    if (seeBills && r.rentState === 'late') todo.push({ tone: 'bad', id: r.p.id, key: 'rent', text: L(`${r.p.name}: এ মাসের ভাড়া (${n(r.p.rent_due_day ?? 0)} তারিখ) এখনো লেখা হয়নি`, `${r.p.name}: this month's rent (due day ${r.p.rent_due_day}) not recorded yet`) })
    if (r.p.capacity != null && r.people > r.p.capacity) todo.push({ tone: 'warn', id: r.p.id, key: 'people', text: L(`${r.p.name}: ধারণক্ষমতা ${n(r.p.capacity)} জন, থাকেন ${n(r.people)} জন`, `${r.p.name}: room for ${r.p.capacity}, ${r.people} staying`) })
    if (!r.p.contract_to && r.p.rent) todo.push({ tone: 'info', id: r.p.id, key: 'rent', text: L(`${r.p.name}: চুক্তির মেয়াদ লেখা নেই`, `${r.p.name}: no contract dates`) })
  }
  const rank: Record<Tone, number> = { bad: 0, warn: 1, info: 2, ok: 3, neutral: 4 }
  todo.sort((a, b) => rank[a.tone] - rank[b.tone])

  if (!flats.length) return <section className="panel">
    <p className="notice">{L('এখনো কোনো আবাসিক ফ্ল্যাট যোগ হয়নি।', 'No residence yet.')} <Link to={scopePath('residential', 'places')}>{L('যোগ করুন →', 'Add one →')}</Link></p></section>

  const contractBadge = (d: number | null) => d == null ? <Badge tone="neutral">{L('লেখা নেই', 'Not set')}</Badge>
    : d < 0 ? <Badge tone="bad">{L('শেষ', 'Ended')}</Badge> : d <= 60 ? <Badge tone="warn">{L(`${n(d)} দিন বাকি`, `${d} days left`)}</Badge> : <Badge tone="ok">{L('চলছে', 'Running')}</Badge>
  const rentBadge = (r: Row) => r.rentState === 'paid' ? <Badge tone="ok">{L('লেখা হয়েছে', 'Recorded')}</Badge>
    : r.rentState === 'late' ? <Badge tone="bad">{L('বাকি', 'Overdue')}</Badge> : r.rentState === 'due' ? <Badge tone="warn">{L('অপেক্ষায়', 'Due')}</Badge> : <Badge tone="neutral">—</Badge>
  const err = res.error || bills.error

  return <>
    <div className="da-stats">
      <Stat icon="home" label={L('আবাসিক ফ্ল্যাট', 'Residences')} value={n(flats.length)} />
      <Stat icon="users" label={L('বাসিন্দা', 'Residents')} value={res.data ? n(people) : '…'} sub={beds ? L(`ধারণক্ষমতা ${n(beds)} জন`, `room for ${beds}`) : undefined}
        tone={beds && people > beds ? 'warn' : undefined} />
      <Stat icon="clock" label={L('চুক্তি শেষ / ৬০ দিনে শেষ', 'Contracts ended / ending')} value={n(ending.length)} tone={ending.some(r => (r.contract ?? 0) < 0) ? 'bad' : ending.length ? 'warn' : 'ok'} />
      {seeBills && <Stat icon="cash" label={L('এ মাসের ভাড়া বাকি', 'Rent overdue this month')} value={bills.data ? n(late.length) : '…'} tone={late.length ? 'bad' : 'ok'}
        sub={monthRent ? L(`মাসিক মোট ভাড়া ৳ ${n(Math.round(monthRent))}`, `monthly rent ৳ ${Math.round(monthRent)}`) : undefined} />}
    </div>
    {err ? <p className="da-error">{opsFriendly(err)}</p> : null}
    <section className="panel">
      <h2>{L('যা দেখা দরকার', 'Needs attention')} <span className="count-pill">{n(todo.length)}</span></h2>
      {res.loading || bills.loading ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
        : todo.length ? <ul className="duty-list">{todo.slice(0, 12).map((t, i) => <li key={i} className="duty">
          <Badge tone={t.tone}>{t.tone === 'bad' ? '!' : t.tone === 'warn' ? '•' : 'i'}</Badge>
          <button type="button" className="linkish" onClick={() => open(t.id, t.key)}>{t.text}</button></li>)}</ul>
        : <p className="muted"><Icon name="check" size={14} /> {L('সব ঠিক আছে।', 'All good.')}</p>}
      {todo.length > 12 && <p className="muted small">{L(`আরও ${n(todo.length - 12)}টি — নিচের তালিকায় দেখুন`, `${todo.length - 12} more — see the list below`)}</p>}
    </section>
    <section className="panel">
      <DataTable<Row> {...output} title={L('সব আবাসিক ফ্ল্যাট', 'All residences')} file="residential-overview" rows={rows} rowKey={r => r.p.id} phoneView="card"
        onRowClick={r => open(r.p.id, 'people')}
        cols={[
          { key: 'name', label: L('ফ্ল্যাট', 'Residence'), primary: true, value: r => r.p.name,
            render: r => <><strong>{r.p.name}</strong>{(r.hub || r.p.floor_note) && <span className="sec">{[r.hub, r.p.floor_note].filter(Boolean).join(' · ')}</span>}</> },
          { key: 'hub', label: L('হাব', 'Hub'), hidden: true, value: r => r.hub },
          { key: 'people', label: L('বাসিন্দা', 'Residents'), className: 'r', value: r => r.p.capacity != null ? `${r.people} / ${r.p.capacity}` : r.people,
            render: r => <span className={r.p.capacity != null && r.people > r.p.capacity ? 'bad' : ''}>{n(r.people)}{r.p.capacity != null ? ` / ${n(r.p.capacity)}` : ''}</span> },
          { key: 'rent', label: L('মাসিক ভাড়া', 'Rent'), className: 'r', value: r => r.p.rent ?? '', render: r => r.p.rent ? `৳ ${n(Math.round(r.p.rent))}` : '—' },
          { key: 'contract', label: L('চুক্তি', 'Contract'), value: r => r.contract == null ? L('লেখা নেই', 'Not set') : r.contract < 0 ? L('শেষ', 'Ended') : r.contract <= 60 ? L('শেষের পথে', 'Ending') : L('চলছে', 'Running'),
            render: r => contractBadge(r.contract) },
          ...(seeBills ? [
            { key: 'rentm', label: L('এ মাসের ভাড়া', 'Rent this month'), value: (r: Row) => r.rentState === 'paid' ? L('লেখা হয়েছে', 'Recorded') : r.rentState === 'late' ? L('বাকি', 'Overdue') : r.rentState === 'due' ? L('অপেক্ষায়', 'Due') : '',
              render: rentBadge },
            { key: 'power', label: L('এ মাসের বিদ্যুৎ', 'Electricity'), className: 'r', value: (r: Row) => r.power?.amount ?? '', render: (r: Row) => r.power ? `৳ ${n(Math.round(Number(r.power.amount)))}` : '—' },
          ] : []),
        ]} />
      <p className="muted small">{L('কোনো ফ্ল্যাটে চাপলে সেই ফ্ল্যাটের বাসিন্দাদের পাতা খুলবে।', 'Tap a residence to open its residents.')}</p>
    </section>
  </>
}
