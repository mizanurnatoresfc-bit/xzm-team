// জোনের সব হাবের আজকের রিপোর্টের অবস্থা এক পাতায় (জোনাল ড্যাশবোর্ডের ট্যাব)। হাবে চাপলে সেই হাবের রিপোর্ট আপলোডের পাতা খোলে।
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { dateBn, num, taka, timeBn, todayDhaka } from '../../lib/dailyAccounts'
import { reportImport } from '../../lib/reportImport'
import { Badge, ErrorNote, Field, Stat, useLoad } from './ui'

export function ReportStatus({ zone }: { zone: string | null }) {
  const [date, setDate] = useState(todayDhaka())
  const q = useLoad(() => reportImport.status(date, zone), [date, zone])
  const rows = q.data ?? []
  const done = rows.filter(r => r.reports > 0)
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + Number(f(r) || 0), 0)
  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>হাব অনুযায়ী রিপোর্ট <span className="muted small">— {dateBn(date)}</span></h2>
      <Field label="তারিখ"><input type="date" value={date} max={todayDhaka()} onChange={e => e.target.value && setDate(e.target.value)} /></Field></div>
    <ErrorNote error={q.error} />
    <div className="da-stats">
      <Stat icon="upload" label="মোট রিপোর্ট" value={num(sum(r => r.reports))} />
      <Stat icon="hub" tone={done.length === rows.length && rows.length ? 'ok' : 'warn'} label="রিপোর্ট দিয়েছে" value={`${num(done.length)} / ${num(rows.length)} হাব`} />
      <Stat icon="box" label="পার্সেল" value={num(sum(r => r.parcels))} />
      <Stat icon="cash" label="মোট টাকা (চার্জ সহ)" value={taka(sum(r => Number(r.amount) + Number(r.delivery_charge)))} />
      {sum(r => r.unknown_riders) > 0 && <Stat icon="alert" tone="bad" label="অচেনা রাইডার আইডি" value={num(sum(r => r.unknown_riders))} />}
    </div>
    {q.loading && !q.data ? <p className="muted">লোড হচ্ছে…</p> : !rows.length ? <p className="muted">দেখার মতো কোনো হাব নেই।</p> :
      <div className="ri-hubs">{rows.map(r => <Link key={r.hub_id} to={`/app/accounts/report-import?hub=${r.hub_id}&date=${date}`} className={`ri-hub${r.reports ? '' : ' none'}`}>
        <div className="ri-hub-top"><strong>{r.hub_name}</strong>
          {r.reports ? <Badge tone="ok">{num(r.reports)}টি রিপোর্ট</Badge> : <Badge tone="warn">রিপোর্ট আসেনি</Badge>}</div>
        {r.reports > 0 && <div className="ri-hub-nums">
          <span><b>{taka(Number(r.amount) + Number(r.delivery_charge))}</b></span>
          <span>{num(r.lists)} লিস্ট · {num(r.parcels)} পার্সেল</span>
          <span>{num(r.managers)} জন ম্যানেজার · শেষ আপলোড {timeBn(r.last_at).slice(-5)}</span></div>}
        <div className="ri-hub-foot">
          {r.unknown_riders > 0 ? <Badge tone="bad">{num(r.unknown_riders)}টি অচেনা আইডি</Badge> : <span />}
          <span className="ri-go">{r.can_upload ? <><Icon name="upload" size={15} /> রিপোর্ট আপলোড</> : <>খাতা দেখুন →</>}</span></div>
      </Link>)}</div>}
  </section>
}
