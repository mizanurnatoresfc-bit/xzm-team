import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { ASSET_KIND, DESK_SET_DEFAULT, office, type Desk } from '../../lib/office'
import { hrFriendly } from '../../lib/hr'
import { usePrefs } from '../../lib/prefs'
import type { EmpLite } from '../../lib/sorting'
import { Field, Modal, useToast } from '../accounts/ui'
import { EmpPicker, empLabel } from '../sorting/Sorting'
import { HistoryModal } from './History'
import type { Ctx } from './OfficeOps'
import { askWith } from './askText'

export function DeskSets({ ctx }: { ctx: Ctx }) {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const [desk, setDesk] = useState<Desk | null>(null)
  const [employee, setEmployee] = useState<EmpLite | null>(null)
  const [items, setItems] = useState<Record<string, number>>({})
  const [template, setTemplate] = useState<Record<string, number> | null>(null)
  const [addKind, setAddKind] = useState('')
  const [history, setHistory] = useState<Desk | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canAssign = can('office.property.edit') && can('office.asset.edit')
  const defaults = Object.fromEntries(Object.entries(ctx.p.desk_set_template ?? DESK_SET_DEFAULT)
    .filter(([kind, quantity]) => Object.hasOwn(ASSET_KIND, kind) && Number.isInteger(quantity) && quantity >= 0 && quantity <= 999))
  const available = (d: Desk) => ctx.assets.filter(a => a.desk_id === d.id || (!a.desk_id && !a.holder_id && a.condition === 'good'))
  const kindLabel = (kind: string) => ASSET_KIND[kind] ? L(ASSET_KIND[kind][0], ASSET_KIND[kind][1]) : kind

  function open(d: Desk) {
    const stock = available(d)
    const selected: Record<string, number> = {}
    for (const a of stock) if (a.desk_id === d.id) selected[a.id] = a.quantity
    if (!Object.keys(selected).length) {
      for (const [kind, count] of Object.entries(defaults)) {
        let remaining = count
        for (const a of stock.filter(asset => asset.kind === kind)) {
          if (remaining <= 0) break
          const quantity = Math.min(remaining, a.quantity)
          if ((a.serial_no || a.vehicle_id) && quantity !== a.quantity) continue
          selected[a.id] = quantity
          remaining -= quantity
        }
      }
    }
    setError(''); setDesk(d); setItems(selected)
    setEmployee(d.responsible_id ? ctx.emp[d.responsible_id] ?? null : null)
  }

  async function save(d: Desk, employeeId: string | null, selection: Record<string, number>) {
    if (busy) return
    setBusy(true); setError('')
    try {
      await office.saveDeskSet(d, employeeId, selection)
      setDesk(null)
      await ctx.reload()
      toast(employeeId ? L('ডেস্ক সেট সেভ হয়েছে', 'Desk set saved') : L('সেট স্টকে ফেরত গেছে', 'Desk set returned to stock'))
    } catch (e) { setError(hrFriendly(e)) } finally { setBusy(false) }
  }

  async function saveTemplate() {
    if (!template || busy) return
    setBusy(true); setError('')
    try {
      await office.saveProperty({ desk_set_template: template }, ctx.p.id)
      setTemplate(null)
      await ctx.reloadPlaces()
      toast(L('ডিফল্ট সেট সেভ হয়েছে', 'Default set saved'))
    } catch (e) { setError(hrFriendly(e)) } finally { setBusy(false) }
  }

  return <section className="panel">{node}
    <div className="da-bar"><h2>{L('ডেস্ক সেট', 'Desk sets')}</h2>
      {canAssign && <button type="button" className="secondary sm" onClick={() => { setError(''); setTemplate(defaults); setAddKind('') }}>
        {L('ডিফল্ট সেট সম্পাদনা', 'Edit default set')}
      </button>}
    </div>
    {!ctx.desks.length && <p className="muted">{L('সেট বরাদ্দ করতে আগে ডেস্ক যোগ করুন।', 'Add a desk to assign a set.')}</p>}
    <div className="route-cards">{ctx.desks.map(d => {
      const assets = ctx.assets.filter(a => a.desk_id === d.id)
      return <article key={d.id} className="route-card">
        <h3>{d.name}</h3>
        <p>{d.responsible_id ? empLabel(ctx.emp[d.responsible_id]) : L('দায়িত্বে কেউ নেই', 'Unassigned')}</p>
        <div className="chips">{assets.map(a => <span className="chip" key={a.id}>{a.name} × {n(a.quantity)}</span>)}</div>
        <div className="row-acts">
          {canAssign && <button type="button" className="sm" onClick={() => open(d)}>{L('সেট অ্যাসাইন / এডিট', 'Assign / edit set')}</button>}
          {can('system.audit.view') && <button type="button" className="secondary sm" onClick={() => setHistory(d)}>{L('ইতিহাস', 'History')}</button>}
        </div>
      </article>
    })}</div>
    {desk && <Modal title={desk.name + ' · ' + L('ডেস্ক সেট', 'Desk set')} onClose={() => { if (!busy) setDesk(null) }}
      actions={<>
        {(desk.responsible_id || ctx.assets.some(a => a.desk_id === desk.id)) && <button className="secondary" disabled={busy} onClick={async () => {
          const answer = await askWith(L)(L('পুরো সেট স্টকে ফেরত দিতে ডেস্কের নাম লিখুন', 'Type the desk name to return the whole set'))
          if (answer?.trim() === desk.name) await save(desk, null, {})
        }}>{L('পুরো সেট ফেরত', 'Return set')}</button>}
        <button disabled={busy || !employee || !Object.values(items).some(q => q > 0) || Object.values(items).some(q => !Number.isInteger(q) || q < 0)}
          onClick={() => employee && void save(desk, employee.id, Object.fromEntries(Object.entries(items).filter(([, q]) => q > 0)))}>{L('সেট সেভ', 'Save set')}</button>
      </>}>
      <EmpPicker label={L('দায়িত্বপ্রাপ্ত স্টাফ আইডি', 'Responsible employee ID')} value={employee} onPick={setEmployee} />
      <p className="muted small">{L('স্টক থেকে আইটেমের পরিমাণ দিন। বাদ দিতে ০ লিখুন।', 'Enter quantities from stock. Set a quantity to 0 to remove the item.')}</p>
      <div className="hr-form">{available(desk).map(a => <Field key={a.id} label={L(`${a.name} (আছে ${n(a.quantity)})`, `${a.name} (${a.quantity} available)`)} hint={a.serial_no ?? undefined}>
        <input type="number" min={0} max={a.quantity} step={1} disabled={busy} value={items[a.id] ?? 0}
          onChange={e => setItems({ ...items, [a.id]: Math.min(a.quantity, Number(e.target.value)) })} />
      </Field>)}</div>
      {error && <p className="da-error">{error}</p>}
    </Modal>}
    {template && <Modal title={L('ডিফল্ট ডেস্ক সেট', 'Default desk set')} onClose={() => { if (!busy) setTemplate(null) }}
      actions={<button disabled={busy || Object.values(template).some(q => !Number.isInteger(q) || q < 0 || q > 999)}
        onClick={() => void saveTemplate()}>{L('ডিফল্ট সেভ', 'Save default')}</button>}>
      <div className="hr-form">{Object.entries(template).map(([kind, quantity]) => <Field key={kind} label={kindLabel(kind)}>
        <div className="row-acts"><input type="number" min={0} max={999} step={1} value={quantity} disabled={busy}
          onChange={e => setTemplate({ ...template, [kind]: Number(e.target.value) })} />
          <button type="button" className="secondary sm" disabled={busy} onClick={() => {
            const next = { ...template }; delete next[kind]; setTemplate(next)
          }}>{L('বাদ', 'Remove')}</button></div>
      </Field>)}</div>
      <div className="row-acts">
        <Field label={L('আইটেমের ধরন', 'Item type')}><select value={addKind} disabled={busy} onChange={e => setAddKind(e.target.value)}>
          <option value="">—</option>{Object.keys(ASSET_KIND).filter(kind => !(kind in template)).map(kind => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
        </select></Field>
        <button type="button" className="secondary sm" disabled={busy || !addKind} onClick={() => { setTemplate({ ...template, [addKind]: 1 }); setAddKind('') }}>
          {L('আইটেম যোগ', 'Add item')}
        </button>
      </div>
      {error && <p className="da-error">{error}</p>}
    </Modal>}
    {history && <HistoryModal table="office_desks" id={history.id} name={history.name} onClose={() => setHistory(null)} />}
  </section>
}
