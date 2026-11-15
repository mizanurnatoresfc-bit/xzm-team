import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Field, Stat, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { extraFriendly, referrals, type Summary } from '../../lib/extra'
import { useOrg } from './common'

/** Who brought whom: per referrer, people brought, still active, by position, and people in hand. */
export function Referrals() {
  const { L, n } = usePrefs()
  const nav = useNavigate()
  const o = useOrg()
  const [zone, setZone] = useState('')
  const list = useLoad(() => referrals.summary(zone || null), [zone])
  const rows = list.data ?? []
  return <AppShell title={L('রেফারেন্স', 'Referrals')} subtitle={L('কে কাদের এনেছেন, তাঁরা কোন পদে আছেন, আর কার হাতে কোন পদের জন্য লোক আছে।', 'Who brought whom, which positions they hold, and who has people ready for which position.')}>
    <div className="da-stats">
      <Stat icon="users" label={L('রেফারেন্স দিয়েছেন', 'Referrers')} value={n(rows.length)} />
      <Stat icon="check" tone="ok" label={L('এনেছেন (মোট)', 'Brought in')} value={n(rows.reduce((a, r) => a + r.brought, 0))} />
      <Stat icon="user" label={L('হাতে থাকা লোক', 'People in hand')} value={n(rows.reduce((a, r) => a + r.in_hand, 0))} />
    </div>
    <section className="da-filters panel no-print">
      <Field label={L('এরিয়া', 'Area')}><select value={zone} onChange={e => setZone(e.target.value)}><option value="">{L('সব', 'All')}</option>{o.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
    </section>
    {list.error ? <p className="da-error">{extraFriendly(list.error)}</p> : null}
    <section className="panel">
      <DataTable<Summary> title={L('রেফারেন্স তালিকা', 'Referrals')} file="referrals" rows={rows} rowKey={r => r.referrer_id} onRowClick={r => nav(`/app/hr/employees/${r.referrer_id}`)}
        empty={<p className="muted">{list.loading ? L('লোড হচ্ছে…', 'Loading…') : L('এখনো কোনো রেফারেন্স নেই।', 'No referrals yet.')}</p>} cols={[
          { key: 'code', label: L('আইডি', 'ID'), value: r => r.employee_code ?? '' },
          { key: 'name', label: L('নাম', 'Name'), value: r => r.full_name, render: r => <><strong>{r.full_name}</strong><span className="sec">{r.hub_name ?? ''}</span></> },
          { key: 'brought', label: L('এনেছেন', 'Brought'), value: r => n(r.brought) },
          { key: 'active', label: L('এখনো আছেন', 'Still active'), value: r => n(r.active) },
          { key: 'pos', label: L('কোন পদে', 'Positions'), value: r => Object.entries(r.by_position).map(([p, c]) => `${p}: ${c}`).join(', ') },
          { key: 'hand', label: L('হাতে থাকা লোক', 'In hand'), value: r => n(r.in_hand) },
        ]} />
    </section>
  </AppShell>
}
