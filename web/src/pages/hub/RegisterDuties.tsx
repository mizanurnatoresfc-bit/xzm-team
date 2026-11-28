import { useState } from 'react'
import { AppShell } from '../../components/AppShell'
import { usePrefs } from '../../lib/prefs'
import { useLiveLoad, wf, wfFriendly, type DutyRow, type RegisterKind } from '../../lib/workforce'
import { Field } from '../accounts/ui'
import { useHubList } from '../workforce/shared'

/** খাতাভিত্তিক কর্মীর দায়িত্ব নির্ধারণ — hub manager assigns primary + backup rider per খাতা.
 *  The RPC gates on ops.staff_daily.edit for the hub's zone, so only hub manager & zonal reviewer can edit. */
const KINDS: ReadonlyArray<[RegisterKind, string, string]> = [
  ['delivery_cash', 'ডেলিভারি ও টাকা খাতা', 'Delivery & cash register'],
  ['pickup_return', 'পিকআপ ও মার্চেন্ট ফেরত খাতা', 'Pickup & merchant return'],
  ['pending_return', 'পেন্ডিং ও রিটার্ন খাতা', 'Pending & return register'],
  ['attendance', 'হাজিরা খাতা', 'Attendance register'],
  ['hub_expense', 'হাবের খরচের খাতা', 'Hub expense register'],
]

export function RegisterDuties() {
  const { L } = usePrefs()
  const hubs = useHubList()
  const [selected, setSelected] = useState('')
  const list = hubs.data?.hubs ?? []
  const hub = list.find(h => h.id === selected)?.id ?? list[0]?.id ?? ''
  const query = useLiveLoad(() => hub ? wf.dutyList(hub) : Promise.resolve([] as DutyRow[]), [hub])
  const rows = query.data ?? []
  const byKind: Record<RegisterKind, DutyRow[]> = {
    delivery_cash: [], pickup_return: [], pending_return: [], attendance: [], hub_expense: [],
  }
  for (const r of rows) byKind[r.kind]?.push(r)
  return <AppShell title={L('খাতার দায়িত্ব', 'Register duties')}>
    {list.length > 0 && <Field label={L('হাব', 'Hub')}>
      <select value={hub} onChange={e => setSelected(e.target.value)}>
        {list.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
    </Field>}
    {hub && KINDS.map(([kind, bn, en]) => <DutySection key={kind} hub={hub} kind={kind}
      title={L(bn, en)} rows={byKind[kind]} onChange={() => void query.reload()} />)}
    {query.error && <p role="alert">{wfFriendly(query.error)}</p>}
  </AppShell>
}

function DutySection({ hub, kind, title, rows, onChange }: {
  hub: string; kind: RegisterKind; title: string; rows: DutyRow[]; onChange: () => void
}) {
  const { L } = usePrefs()
  const [employee, setEmployee] = useState('')
  const [isBackup, setIsBackup] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const primary = rows.filter(r => !r.is_backup)
  const backup = rows.filter(r => r.is_backup)

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!employee.trim() || busy) return
    setBusy(true); setErr('')
    try {
      await wf.dutyAssign(hub, kind, employee.trim(), isBackup, note.trim() || undefined)
      setEmployee(''); setNote(''); setIsBackup(false)
      onChange()
    } catch (e) { setErr(wfFriendly(e)) }
    finally { setBusy(false) }
  }

  async function retire(id: string) {
    setBusy(true); setErr('')
    try { await wf.dutyRetire(id); onChange() }
    catch (e) { setErr(wfFriendly(e)) }
    finally { setBusy(false) }
  }

  return <section className="panel hub-duty-section">
    <h3>{title}</h3>
    <div className="hub-duty-list">
      <div>
        <h4>{L('মূল দায়িত্ব', 'Primary duty')}</h4>
        {primary.length === 0 ? <p className="muted">{L('কেউ নির্ধারিত নেই', 'No one assigned')}</p>
          : <ul>{primary.map(r => <li key={r.id}>{r.name}
              {r.note && <> · <em>{r.note}</em></>}
              {' '}<button type="button" className="secondary" disabled={busy}
                onClick={() => void retire(r.id)}>{L('সরান', 'Remove')}</button></li>)}</ul>}
      </div>
      <div>
        <h4>{L('ব্যাকআপ', 'Backup')}</h4>
        {backup.length === 0 ? <p className="muted">{L('ব্যাকআপ কেউ নেই', 'No backup')}</p>
          : <ul>{backup.map(r => <li key={r.id}>{r.name}
              {r.note && <> · <em>{r.note}</em></>}
              {' '}<button type="button" className="secondary" disabled={busy}
                onClick={() => void retire(r.id)}>{L('সরান', 'Remove')}</button></li>)}</ul>}
      </div>
    </div>
    <form onSubmit={add} className="hub-duty-add">
      <Field label={L('কর্মীর ID', 'Employee ID')}>
        <input value={employee} onChange={e => setEmployee(e.target.value)} />
      </Field>
      <Field label={L('নোট (ঐচ্ছিক)', 'Note (optional)')}>
        <input maxLength={200} value={note} onChange={e => setNote(e.target.value)} />
      </Field>
      <label><input type="checkbox" checked={isBackup}
        onChange={e => setIsBackup(e.target.checked)} /> {L('ব্যাকআপ হিসেবে', 'As backup')}</label>
      <button type="submit" disabled={busy || !employee.trim()}>{L('যোগ করুন', 'Add')}</button>
    </form>
    {err && <p role="alert">{err}</p>}
  </section>
}
