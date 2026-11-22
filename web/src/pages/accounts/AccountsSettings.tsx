import { askReason } from '../../components/ask'
import { Fragment, useEffect, useState } from 'react'
import { da, type DaSettings, type Category, type Template, type RefPerson, type Vehicle, type FixedExpense } from '../../lib/dailyAccounts'
import { autoCode, org } from '../../lib/hr'
import { AccountsShell, Field, ErrorNote, Badge, Modal, useLoad, useToast } from './ui'
import { BankChargeCard, LayoutCard } from './sheetTools'
import { HubCollectorsCard } from './sheetFlow'
import { VoucherCard } from './voucherSettings'

// Zonal / Accounts settings for Daily Accounts. Every change is validated and audited in the database.
export function AccountsSettings() {
  const st = useLoad(() => da.settings(), [])
  const { toast, node } = useToast()
  const [s, setS] = useState<DaSettings | null>(null)
  const [err, setErr] = useState<unknown>(null)
  useEffect(() => { if (st.data) setS(st.data) }, [st.data])

  async function save(keys: Array<keyof DaSettings>) {
    if (!s) return
    setErr(null)
    try { for (const k of keys) await da.configure(k, s[k]); toast('সেটিংস সংরক্ষিত'); await st.reload() } catch (e) { setErr(e) }
  }
  if (!s) return <AccountsShell title="হিসাবের সেটিংস"><ErrorNote error={st.error} /><p className="muted">লোড হচ্ছে…</p></AccountsShell>
  const set = <K extends keyof DaSettings>(k: K, v: DaSettings[K]) => setS({ ...s, [k]: v })
  const FIELDS: Array<[string, string]> = [['delivery_qty', 'ডেলিভারি'], ['pickup_qty', 'পিকআপ'], ['amount', 'টাকা'], ['paid_amount', 'জমা (নগদ)'], ['due', 'বকেয়া'], ['mobile_banking', 'মোবাইল ব্যাংকিং'], ['remarks', 'মন্তব্য']]

  return <AccountsShell title="হিসাবের সেটিংস" subtitle="Zonal Management Settings → Daily Accounts">
    {node}<ErrorNote error={err} />
    <HubCollectorsCard key={JSON.stringify([st.data?.['da.hub_collectors'], st.data?.['da.collectors_default']])} settings={s} onSaved={async m => { toast(m); await st.reload() }} />
    <div className="da-grid2">
      <section className="panel"><h2>হিসাব শুরু ও সেশন</h2>
        <div className="da-grid2">
          <Field label="প্রতিদিন হিসাব শুরুর সময়"><input type="time" value={s['da.start_time']} onChange={e => set('da.start_time', e.target.value)} /></Field>
          <Field label="কত দিন আগের হিসাব শুরু করা যাবে"><input type="number" min={0} max={31} value={s['da.backdate_days']} onChange={e => set('da.backdate_days', Number(e.target.value))} /></Field>
        </div>
        <label className="da-check"><input type="checkbox" checked={s['da.session_tracking']} onChange={e => set('da.session_tracking', e.target.checked)} /> পেজে প্রবেশ-বের হওয়া ও সময় ট্র্যাক করুন</label>
        <label className="da-check"><input type="checkbox" checked={s['da.require_assignment']} onChange={e => set('da.require_assignment', e.target.checked)} /> শুধু হাবে নির্ধারিত হিসাব ম্যানেজার যাচাই করতে পারবেন</label>
        <button onClick={() => void save(['da.start_time', 'da.backdate_days', 'da.session_tracking', 'da.require_assignment'])}>সেভ</button></section>

      <section className="panel"><h2>হিসাবের নিয়ম</h2>
        <Field label="বকেয়া (Due) নিয়ম"><select value={s['da.due_rule']} onChange={e => set('da.due_rule', e.target.value as DaSettings['da.due_rule'])}>
          <option value="manual">বকেয়া নিজে লিখবেন</option><option value="amount_minus_paid">বকেয়া = টাকা − জমা</option></select></Field>
        <Field label="মোবাইল ব্যাংকিং নিয়ম" hint="ডিফল্ট: আলাদা — বকেয়ার সাথে স্বয়ংক্রিয়ভাবে যোগ-বিয়োগ হয় না"><select value={s['da.mobile_banking_rule']} onChange={e => set('da.mobile_banking_rule', e.target.value as DaSettings['da.mobile_banking_rule'])}>
          <option value="separate">আলাদা হিসাব</option><option value="reduces_due">বকেয়া থেকে বাদ যাবে</option><option value="adds_to_due">বকেয়ার সাথে যোগ হবে</option></select></Field>
        <p className="muted small">নিয়ম বদলালে নতুন বা এডিট করা লাইনে প্রযোজ্য হবে; আগের সেভ করা লাইন যেমন আছে তেমন থাকবে।</p>
        <h3>রাইডার হিসাবের ঘর</h3>
        <div className="da-chips">{FIELDS.map(([k, l]) => <label key={k} className="da-check"><input type="checkbox" checked={s['da.rider_fields'].includes(k)}
          onChange={e => set('da.rider_fields', e.target.checked ? [...s['da.rider_fields'], k] : s['da.rider_fields'].filter(x => x !== k))} /> {l}</label>)}</div>
        <h3>খাতা লেখার সুবিধা</h3>
        <label className="da-check"><input type="checkbox" checked={s['da.double_rider_lines'] ?? true}
          onChange={e => set('da.double_rider_lines', e.target.checked)} /> একই রাইডারের একাধিক হিসাব দেওয়া যাবে</label>
        <label className="da-check"><input type="checkbox" checked={s['da.close_needs_all'] ?? false}
          onChange={e => set('da.close_needs_all', e.target.checked)} /> সবাই নিজের অংশ সাবমিট না করলে “হিসাব চেক” করা যাবে না (কারণ লিখেও নয়)</label>
        <div className="da-grid2">
          <Field label="পেমেন্ট আইডির প্রিফিক্স" hint="101001 লিখলে এটাই সামনে বসবে">
            <input value={s['da.payment_id_prefix'] ?? ''} onChange={e => set('da.payment_id_prefix', e.target.value.toUpperCase())} /></Field>
          <Field label="জমা বিলের তারিখ" hint="ম্যানেজার শীটে তোলার পর কোন তারিখ দেখাবে">
            <select value={s['da.claim_date_source'] ?? 'sheet'} onChange={e => set('da.claim_date_source', e.target.value as DaSettings['da.claim_date_source'])}>
              <option value="sheet">খাতার তারিখ</option><option value="bill">বিলের নিজের তারিখ</option></select></Field>
        </div>
        <button onClick={() => void save(['da.due_rule', 'da.mobile_banking_rule', 'da.rider_fields',
          'da.double_rider_lines', 'da.close_needs_all', 'da.payment_id_prefix', 'da.claim_date_source'])}>সেভ</button></section>
    </div>

    <div className="da-grid2">
      <CategoriesCard cats={s['da.expense_categories']} onSave={async c => { set('da.expense_categories', c); setErr(null); try { await da.configure('da.expense_categories', c); toast('খাত সংরক্ষিত'); await st.reload() } catch (e) { setErr(e) } }} />
      <section className="panel"><h2>রেফারেন্স, বিল আপলোড ও OCR</h2>
        <div className="da-grid2">
          <Field label="খরচের রেফারেন্স প্রিফিক্স"><input value={s['da.reference_setup'].expense_prefix} onChange={e => set('da.reference_setup', { ...s['da.reference_setup'], expense_prefix: e.target.value })} /></Field>
          <Field label="মার্চেন্ট পেমেন্ট প্রিফিক্স"><input value={s['da.reference_setup'].merchant_prefix} onChange={e => set('da.reference_setup', { ...s['da.reference_setup'], merchant_prefix: e.target.value })} /></Field>
        </div>
        <label className="da-check"><input type="checkbox" checked={s['da.reference_setup'].reference_required} onChange={e => set('da.reference_setup', { ...s['da.reference_setup'], reference_required: e.target.checked })} /> প্রতিটি খরচে রেফারেন্স নম্বর বাধ্যতামূলক</label>
        <div className="da-grid2">
          <Field label="ফাইলের সর্বোচ্চ আকার (MB)"><input type="number" min={1} max={10} value={s['da.bill_upload'].max_mb} onChange={e => set('da.bill_upload', { ...s['da.bill_upload'], max_mb: Number(e.target.value) })} /></Field>
          <Field label="এত টাকা বা বেশি হলে বিল বাধ্যতামূলক"><input type="number" min={0} value={s['da.bill_upload'].required_over ?? ''} onChange={e => set('da.bill_upload', { ...s['da.bill_upload'], required_over: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="OCR ভাষা"><select value={s['da.ocr'].languages} onChange={e => set('da.ocr', { ...s['da.ocr'], languages: e.target.value })}><option value="eng+ben">English + বাংলা</option><option value="eng">English</option><option value="ben">বাংলা</option></select></Field>
          <Field label="OCR সতর্কতা সীমা (%)"><input type="number" min={0} max={100} value={s['da.ocr'].min_confidence} onChange={e => set('da.ocr', { ...s['da.ocr'], min_confidence: Number(e.target.value) })} /></Field>
        </div>
        <label className="da-check"><input type="checkbox" checked={s['da.ocr'].require_verification} onChange={e => set('da.ocr', { ...s['da.ocr'], require_verification: e.target.checked })} /> OCR তথ্য যাচাই ছাড়া সাবমিট করা যাবে না (প্রস্তাবিত)</label>
        <p className="muted small">OCR: Tesseract.js, ব্রাউজারে চলে; প্রথমবার ইন্টারনেট থেকে লোড হয়।</p>
        <button onClick={() => void save(['da.reference_setup', 'da.bill_upload', 'da.ocr'])}>সেভ</button></section>
    </div>

    <VoucherCard value={st.data?.['da.voucher']} billOver={s['da.bill_upload'].required_over}
      onSave={async v => { set('da.voucher', v); setErr(null); try { await da.configure('da.voucher', v); toast('ভাউচারের নিয়ম সংরক্ষিত'); await st.reload() } catch (e) { setErr(e) } }} />
    <div className="da-grid2">
      <RefPeopleCard list={s['da.reference_people'] ?? []}
        onSave={async r => { set('da.reference_people', r); setErr(null); try { await da.configure('da.reference_people', r); toast('রেফারেন্স তালিকা সংরক্ষিত'); await st.reload() } catch (e) { setErr(e) } }} />
      <VehiclesCard />
    </div>
    <FixedLinesCard riders={s['da.fixed_riders'] ?? []} expenses={s['da.fixed_expenses'] ?? []} cats={s['da.expense_categories']}
      onSave={async (r, x) => { set('da.fixed_riders', r); set('da.fixed_expenses', x); setErr(null)
        try { await da.configure('da.fixed_riders', r); await da.configure('da.fixed_expenses', x); toast('প্রতিদিনের লাইন সংরক্ষিত'); await st.reload() } catch (e) { setErr(e) } }} />
    <div className="da-grid2">
      <BankChargeCard value={s['da.bank_charge']}
        onSave={async v => { setErr(null); try { await da.configure('da.bank_charge', v); toast('ব্যাংক চার্জ সংরক্ষিত'); await st.reload() } catch (e) { setErr(e) } }} />
      <LayoutCard value={s['da.layout']}
        onSave={async v => { setErr(null); try { await da.configure('da.layout', v); toast('খাতার অংশ সংরক্ষিত'); await st.reload() } catch (e) { setErr(e) } }} />
    </div>
    <TemplatesCard cats={s['da.expense_categories']} />
    <AccessCard />
  </AccountsShell>
}

/** Riders and expenses that are put on every new sheet. */
function FixedLinesCard({ riders, expenses, cats, onSave }: { riders: string[]; expenses: FixedExpense[]; cats: Category[]
  onSave: (r: string[], x: FixedExpense[]) => Promise<void> }) {
  const [r, setR] = useState<string[]>(riders)
  const [x, setX] = useState<FixedExpense[]>(expenses)
  useEffect(() => { setR(riders); setX(expenses) }, [riders, expenses])
  const setX1 = (i: number, patch: Partial<FixedExpense>) => setX(x.map((v, j) => j === i ? { ...v, ...patch } : v))
  return <section className="panel"><h2>প্রতিদিনের লাইন (খাতা খুললেই বসবে)</h2>
    <p className="muted small">যে রাইডারদের হিসাব রোজই ওঠে আর যে খরচ রোজই হয় — এখানে রেখে দিলে নতুন খাতা খোলার সময় নিজে থেকেই বসে যাবে। পরে বদলানো বা বাদ দেওয়া যাবে।</p>
    <div className="da-grid2">
      <div>
        <h3>রাইডারের এমপ্লয়ি আইডি</h3>
        {r.map((code, i) => <div key={i} className="row" style={{ marginBottom: 6 }}>
          <input value={code} inputMode="numeric" onChange={e => setR(r.map((v, j) => j === i ? e.target.value : v))} />
          <button className="danger sm" onClick={() => setR(r.filter((_, j) => j !== i))}>×</button></div>)}
        {r.length === 0 && <p className="muted small">কেউ নেই।</p>}
        <button className="secondary" onClick={() => setR([...r, ''])}>＋ আইডি</button>
      </div>
      <div>
        <h3>প্রতিদিনের খরচ</h3>
        <div className="da-table-wrap"><table className="da-table">
          <thead><tr><th>নাম</th><th>খাত</th><th>ধরন</th><th className="r">টাকা</th><th /></tr></thead>
          <tbody>{x.map((v, i) => <tr key={i}>
            <td><input value={v.name} onChange={e => setX1(i, { name: e.target.value })} /></td>
            <td><select value={v.category} onChange={e => setX1(i, { category: e.target.value })}>
              {cats.map(c => <option key={c.code} value={c.code}>{c.bn}</option>)}</select></td>
            <td><select value={v.kind ?? 'transport'} onChange={e => setX1(i, { kind: e.target.value as FixedExpense['kind'] })}>
              <option value="transport">যাতায়াত</option><option value="employee">কর্মীর খরচ</option></select></td>
            <td><input type="number" min={0} value={v.amount ?? 0} onChange={e => setX1(i, { amount: Number(e.target.value) })} /></td>
            <td><button className="danger sm" onClick={() => setX(x.filter((_, j) => j !== i))}>×</button></td></tr>)}
            {x.length === 0 && <tr><td colSpan={5} className="muted">কিছু নেই।</td></tr>}</tbody></table></div>
        <button className="secondary" onClick={() => setX([...x, { name: '', category: cats[0]?.code ?? 'other', kind: 'transport', amount: 0 }])}>＋ খরচ</button>
      </div>
    </div>
    <button onClick={() => void onSave(r.map(c => c.trim()).filter(Boolean), x.filter(v => v.name.trim()))}>সেভ</button>
  </section>
}

/** The people an expense is often referred to, so the sheet fills in one click. */
function RefPeopleCard({ list, onSave }: { list: RefPerson[]; onSave: (r: RefPerson[]) => Promise<void> }) {
  const [rows, setRows] = useState<RefPerson[]>(list)
  useEffect(() => setRows(list), [list])
  const set = (i: number, patch: Partial<RefPerson>) => setRows(rows.map((x, j) => j === i ? { ...x, ...patch } : x))
  return <section className="panel"><h2>রেফারেন্সের লোক (সেভ করা)</h2>
    <p className="muted small">যাঁদের নাম খরচে বারবার লাগে — নাম, মোবাইল ও পদবি এখানে রাখলে খরচ লেখার সময় এক ক্লিকে বসে যাবে।</p>
    <div className="da-table-wrap"><table className="da-table">
      <thead><tr><th>নাম</th><th>মোবাইল</th><th>পদবি</th><th /></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>
        <td><input value={r.name} onChange={e => set(i, { name: e.target.value })} /></td>
        <td><input inputMode="numeric" placeholder="01XXXXXXXXX" value={r.phone ?? ''} onChange={e => set(i, { phone: e.target.value })} /></td>
        <td><input value={r.position ?? ''} onChange={e => set(i, { position: e.target.value })} /></td>
        <td><button className="danger sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></td></tr>)}
        {rows.length === 0 && <tr><td colSpan={4} className="muted">কেউ যোগ করা হয়নি।</td></tr>}</tbody></table></div>
    <div className="row"><button className="secondary" onClick={() => setRows([...rows, { name: '', phone: '', position: '' }])}>＋ লোক</button>
      <button onClick={() => void onSave(rows.filter(r => r.name.trim()))}>সেভ</button></div>
  </section>
}

/** The hub's vehicles and who holds each one. */
function VehiclesCard() {
  const hubs = useLoad(() => org.hubs().catch(() => [] as Array<{ id: string; name: string }>), [])
  const [hub, setHub] = useState('')
  const vehicles = useLoad(() => hub ? da.vehicles(hub) : Promise.resolve([] as Vehicle[]), [hub])
  const [d, setD] = useState<Partial<Vehicle> & { reg?: string } | null>(null)
  const [give, setGive] = useState<Vehicle | null>(null)
  const [code, setCode] = useState(''); const [why, setWhy] = useState('')
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { if (!hub && hubs.data?.length) setHub(hubs.data[0].id) }, [hubs.data, hub])

  async function save() {
    if (!d || !hub) return
    setBusy(true); setErr(null)
    try {
      await da.saveVehicle({ name: d.name ?? '', code: autoCode(d.name ?? '', d.code), kind: d.kind ?? 'bike', hub,
        reg: d.reg_no ?? null, status: d.status ?? 'active', id: d.id ?? null })
      setD(null); await vehicles.reload()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  async function hand() {
    if (!give) return
    setBusy(true); setErr(null)
    try { await da.assignVehicle(give.id, code, why); setGive(null); setCode(''); setWhy(''); await vehicles.reload() }
    catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return <section className="panel"><h2>গাড়ি ও কার নামে আছে</h2>
    <p className="muted small">গাড়ির খরচ লেখার সময় গাড়ি বেছে দিলে, যার নামে গাড়ি আছে তার “আমার হিসাব” পাতায় কী বাবদ কত খরচ হলো দেখা যাবে।</p>
    <div className="da-filters" style={{ padding: 0 }}>
      <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}>
        {(hubs.data ?? []).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
    </div>
    <ErrorNote error={err ?? vehicles.error} />
    <div className="da-table-wrap"><table className="da-table">
      <thead><tr><th>গাড়ি</th><th>ধরন</th><th>রেজিস্ট্রেশন</th><th>কার নামে</th><th>অবস্থা</th><th /></tr></thead>
      <tbody>{(vehicles.data ?? []).map(v => <tr key={v.id}>
        <td data-l="গাড়ি"><b>{v.name}</b></td>
        <td data-l="ধরন">{VEHICLE_KIND[v.kind] ?? v.kind}</td>
        <td data-l="রেজিস্ট্রেশন">{v.reg_no ?? '—'}</td>
        <td data-l="কার নামে">{v.holder_name ? <>{v.holder_name}<span className="sec">ID {v.holder_code}</span></> : <span className="muted">কারও নামে নেই</span>}</td>
        <td data-l="অবস্থা">{v.status === 'active' ? 'চালু' : 'বন্ধ'}</td>
        <td><span className="row"><button className="secondary sm" onClick={() => setD({ ...v, reg: v.reg_no ?? '' })}>এডিট</button>
          <button className="secondary sm" onClick={() => { setGive(v); setCode(''); setWhy('') }}>কাউকে দিন</button></span></td>
      </tr>)}
        {(vehicles.data ?? []).length === 0 && <tr><td colSpan={6} className="muted">এই হাবে কোনো গাড়ি নেই।</td></tr>}</tbody></table></div>
    <button className="secondary" disabled={!hub} onClick={() => setD({ kind: 'bike', status: 'active' })}>＋ গাড়ি</button>

    {d && <Modal title={d.id ? 'গাড়ি এডিট' : 'নতুন গাড়ি'} onClose={() => setD(null)}
      actions={<><button className="secondary" onClick={() => setD(null)}>বাতিল</button>
        <button disabled={busy || !d.name} onClick={() => void save()}>সেভ</button></>}>
      <div className="da-grid2">
        <Field label="নাম *"><input autoFocus value={d.name ?? ''} onChange={e => setD({ ...d, name: e.target.value })} placeholder="যেমন: অফিসের বাইক ১" /></Field>
        
        <Field label="ধরন"><select value={d.kind ?? 'bike'} onChange={e => setD({ ...d, kind: e.target.value })}>
          {Object.entries(VEHICLE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="রেজিস্ট্রেশন নম্বর"><input value={d.reg_no ?? ''} onChange={e => setD({ ...d, reg_no: e.target.value })} /></Field>
        <Field label="অবস্থা"><select value={d.status ?? 'active'} onChange={e => setD({ ...d, status: e.target.value as Vehicle['status'] })}>
          <option value="active">চালু</option><option value="inactive">বন্ধ</option></select></Field>
      </div>
      <ErrorNote error={err} />
    </Modal>}

    {give && <Modal title={`${give.name} কাকে দেবেন?`} onClose={() => setGive(null)}
      actions={<><button className="secondary" onClick={() => setGive(null)}>বাতিল</button>
        <button disabled={busy || !code || !why.trim()} onClick={() => void hand()}>দিন</button></>}>
      {give.holder_name && <p className="muted small">এখন আছে: {give.holder_name} (ID {give.holder_code}) — নতুন নাম দিলে তাঁর কাছ থেকে চলে যাবে।</p>}
      <div className="da-grid2">
        <Field label="Employee ID *"><input autoFocus inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} /></Field>
        <Field label="কারণ *"><input value={why} onChange={e => setWhy(e.target.value)} placeholder="যেমন: ডেলিভারির জন্য" /></Field>
      </div>
      <ErrorNote error={err} />
    </Modal>}
  </section>
}

const VEHICLE_KIND: Record<string, string> = { bike: 'বাইক', cng: 'সিএনজি', van: 'ভ্যান', truck: 'ট্রাক', pickup: 'পিকআপ', other: 'অন্যান্য' }

function CategoriesCard({ cats, onSave }: { cats: Category[]; onSave: (c: Category[]) => Promise<void> }) {
  const [list, setList] = useState<Category[]>(cats)
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => setList(cats), [cats])
  const set = (i: number, patch: Partial<Category>) => setList(list.map((x, j) => j === i ? { ...x, ...patch } : x))
  return <section className="panel"><h2>খরচের খাত (Expense Category)</h2>
    <p className="muted small">প্রতিটি খাতে কোন খরচ বসবে, আর মেইন সাইটে সেটা কোন ক্যাটাগরি–সাব হেডে যাবে, সীমা কত, রসিদ লাগবে কিনা — এখানে লিখে রাখলে খরচ লেখার সময় হিসাবরক্ষকের চোখের সামনেই থাকবে।</p>
    <table className="da-table"><thead><tr><th>English</th><th>বাংলা</th><th>মেইন সাইট</th><th /><th /></tr></thead>
      <tbody>{list.map((c, i) => <Fragment key={i}>
        <tr>
          <td><input value={c.en} onChange={e => set(i, { en: e.target.value })} /></td>
          <td><input value={c.bn} onChange={e => set(i, { bn: e.target.value })} /></td>
          <td className="muted small">{c.site_name ? <>{c.site_name}{c.site_sub ? ` → ${c.site_sub}` : ''}{c.site_limit != null ? ` · ৳${c.site_limit.toLocaleString('en-US')}` : ''}</> : 'যায় না'}</td>
          <td><button className="secondary sm" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'বন্ধ' : 'বিস্তারিত'}</button></td>
          <td><button className="danger sm" onClick={() => { setList(list.filter((_, j) => j !== i)); setOpen(null) }}>×</button></td>
        </tr>
        {open === i && <tr><td colSpan={5}><div className="da-grid3">
          <Field label="কোন খরচ এখানে বসবে" wide><textarea rows={2} value={c.note_bn ?? ''} onChange={e => set(i, { note_bn: e.target.value })} /></Field>
          <Field label="মেইন সাইটের ক্যাটাগরি" hint="খালি রাখলে ধরে নেওয়া হবে মেইন সাইটে যায় না">
            <input value={c.site_name ?? ''} onChange={e => set(i, { site_name: e.target.value || null })} /></Field>
          <Field label="সাব হেড"><input value={c.site_sub ?? ''} onChange={e => set(i, { site_sub: e.target.value || null })} /></Field>
          <Field label="সর্বোচ্চ সীমা (৳)"><input type="number" min={0} value={c.site_limit ?? ''} onChange={e => set(i, { site_limit: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="রসিদ"><select value={c.site_receipt ? 'yes' : 'no'} onChange={e => set(i, { site_receipt: e.target.value === 'yes' })}>
            <option value="yes">লাগবে</option><option value="no">লাগবে না</option></select></Field>
          <Field label="মেইন সাইটে না গেলে কী লিখবে" wide><input value={c.site_note_bn ?? ''} placeholder="মেইন সাইটে যায় না — শুধু আমাদের খাতায় থাকবে।"
            onChange={e => set(i, { site_note_bn: e.target.value || null })} /></Field>
        </div></td></tr>}
      </Fragment>)}</tbody></table>
    <div className="row"><button className="secondary" onClick={() => setList([...list, { code: '', en: '', bn: '' }])}>＋ খাত</button><button onClick={() => void onSave(list.map(c => c.code ? c : { ...c, code: (c.en || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'cat_' + Math.random().toString(36).slice(2, 7) }))}>সেভ</button></div>
    <p className="muted small">যে খাত আগের খরচে ব্যবহার হয়েছে, তা সরালেও পুরোনো খরচ বদলায় না।</p></section>
}

function TemplatesCard({ cats }: { cats: Category[] }) {
  const t = useLoad(() => da.templates(), [])
  const [edit, setEdit] = useState<(Partial<Template> & { kw: string }) | null>(null)
  const [err, setErr] = useState<unknown>(null)
  async function save() {
    if (!edit) return
    setErr(null)
    try {
      await da.saveTemplate({ ...edit, name: edit.name ?? '', category: edit.category ?? cats[0]?.code, keywords: edit.kw.split(',').map(x => x.trim()).filter(Boolean) })
      setEdit(null); await t.reload()
    } catch (e) { setErr(e) }
  }
  return <section className="panel"><div className="da-bar"><h2>খরচ ও মেমো টেমপ্লেট</h2><button onClick={() => setEdit({ category: cats[0]?.code, status: 'active', kw: '' })}>＋ টেমপ্লেট</button></div>
    <p className="muted small">বিলের ছবিতে কোনো কীওয়ার্ড পাওয়া গেলে OCR সেই টেমপ্লেটের নাম, খাত ও রেফারেন্স প্রিফিক্স বসিয়ে দেয়।</p>
    <ErrorNote error={t.error} />
    <div className="da-table-wrap"><table className="da-table"><thead><tr><th>নং</th><th>নাম</th><th>খাত</th><th>রেফারেন্স প্রিফিক্স</th><th>কীওয়ার্ড</th><th>মেমো টেমপ্লেট</th><th>অবস্থা</th><th /></tr></thead>
      <tbody>{(t.data ?? []).map(x => <tr key={x.id}><td>{x.no}</td><td><b>{x.name}</b><span className="sec">{x.name_bn ?? ''}</span></td><td>{cats.find(c => c.code === x.category)?.bn ?? x.category}</td>
        <td>{x.reference_prefix ?? '—'}</td><td>{x.keywords.join(', ')}</td><td>{x.memo_template ?? ''}</td><td>{x.status === 'active' ? <Badge tone="ok">চালু</Badge> : <Badge>বন্ধ</Badge>}</td>
        <td><button className="secondary sm" onClick={() => setEdit({ ...x, kw: x.keywords.join(', ') })}>এডিট</button></td></tr>)}
        {(t.data ?? []).length === 0 && <tr><td colSpan={8} className="muted">কোনো টেমপ্লেট নেই।</td></tr>}</tbody></table></div>
    {edit && <Modal title={edit.id ? 'টেমপ্লেট এডিট' : 'নতুন টেমপ্লেট'} wide onClose={() => setEdit(null)} actions={<><button className="secondary" onClick={() => setEdit(null)}>বাতিল</button><button onClick={() => void save()}>সেভ</button></>}>
      <div className="da-grid3">
        <Field label="নাম *"><input value={edit.name ?? ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="বাংলা নাম"><input value={edit.name_bn ?? ''} onChange={e => setEdit({ ...edit, name_bn: e.target.value })} /></Field>
        <Field label="খাত *"><select value={edit.category} onChange={e => setEdit({ ...edit, category: e.target.value })}>{cats.map(c => <option key={c.code} value={c.code}>{c.bn}</option>)}</select></Field>
        <Field label="রেফারেন্স প্রিফিক্স"><input value={edit.reference_prefix ?? ''} onChange={e => setEdit({ ...edit, reference_prefix: e.target.value })} /></Field>
        <Field label="কীওয়ার্ড (কমা দিয়ে)"><input value={edit.kw} onChange={e => setEdit({ ...edit, kw: e.target.value })} placeholder="cng, auto, সিএনজি" /></Field>
        <Field label="নির্ধারিত টাকা"><input type="number" min={0} value={edit.default_amount ?? ''} onChange={e => setEdit({ ...edit, default_amount: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
        <Field label="মেমো টেমপ্লেট" wide><input value={edit.memo_template ?? ''} onChange={e => setEdit({ ...edit, memo_template: e.target.value })} /></Field>
        <Field label="অবস্থা"><select value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value as Template['status'] })}><option value="active">চালু</option><option value="inactive">বন্ধ</option></select></Field>
      </div><ErrorNote error={err} />
    </Modal>}
  </section>
}

function AccessCard() {
  const hubs = useLoad(() => da.myHubs(), [])
  const people = useLoad(() => da.verifierCandidates(), [])
  const assigned = useLoad(() => da.accountants(), [])
  const [hub, setHub] = useState('')
  const access = useLoad(() => hub ? da.hubAccess(hub) : Promise.resolve([]), [hub])
  const [form, setForm] = useState({ user: '', reason: '' })
  const [err, setErr] = useState<unknown>(null)
  useEffect(() => { if (!hub && hubs.data?.length) setHub(hubs.data[0].hub_id) }, [hubs.data, hub])
  const hubName = (id: string) => (hubs.data ?? []).find(h => h.hub_id === id)?.name ?? id
  const userName = (id: string) => (people.data ?? []).find(p => p.user_id === id)?.full_name ?? id
  async function assign() { setErr(null); try { await da.assignAccountant(hub, form.user, form.reason); setForm({ user: '', reason: '' }); await assigned.reload() } catch (e) { setErr(e) } }
  async function revoke(id: string) { const r = await askReason('কেন বাতিল করছেন?', { ok: 'বাতিল করুন', cancel: 'ফিরে যান' }); if (!r) return; try { await da.revokeAccountant(id, r); await assigned.reload() } catch (e) { setErr(e) } }

  return <section className="panel"><h2>হিসাব ম্যানেজার নির্ধারণ ও হাব-ভিত্তিক অনুমতি</h2>
    <div className="da-filters"><Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}>{(hubs.data ?? []).map(h => <option key={h.hub_id} value={h.hub_id}>{h.name} · {h.zone_name}</option>)}</select></Field>
      <Field label="Accounts Manager"><select value={form.user} onChange={e => setForm({ ...form, user: e.target.value })}><option value="">— বেছে নিন —</option>{(people.data ?? []).map(p => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select></Field>
      <Field label="কারণ"><input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></Field>
      <button disabled={!hub || !form.user || !form.reason.trim()} onClick={() => void assign()}>নির্ধারণ করুন</button></div>
    <ErrorNote error={err || assigned.error || access.error} />
    <div className="da-grid2">
      <div><h3>নির্ধারিত হিসাব ম্যানেজার</h3><table className="da-table"><thead><tr><th>হাব</th><th>ব্যক্তি</th><th>কারণ</th><th /></tr></thead>
        <tbody>{(assigned.data ?? []).map(a => <tr key={a.id}><td>{hubName(a.hub_id)}</td><td>{userName(a.user_id)}</td><td>{a.reason}</td><td><button className="danger sm" onClick={() => void revoke(a.id)}>বাতিল</button></td></tr>)}
          {(assigned.data ?? []).length === 0 && <tr><td colSpan={4} className="muted">কেউ নির্ধারিত নেই — অনুমতিপ্রাপ্ত যেকোনো হিসাব ম্যানেজার যাচাই করতে পারবেন।</td></tr>}</tbody></table></div>
      <div><h3>এই হাবে কার কী অনুমতি</h3><table className="da-table"><thead><tr><th>ব্যক্তি</th><th>রোল</th><th>Submit</th><th>সংশোধন</th><th>অনুমোদন</th></tr></thead>
        <tbody>{(access.data ?? []).map((a, i) => <tr key={i}><td>{a.full_name}</td><td>{a.role_name}<span className="sec">{a.scope_type}</span></td>
          <td>{a.can_submit ? '✓' : '—'}</td><td>{a.can_correct ? '✓' : '—'}</td><td>{a.can_verify ? '✓' : '—'}</td></tr>)}</tbody></table>
        <p className="muted small">সাবমিট, সংশোধন ও অনুমোদনের অনুমতি রোলের মাধ্যমে আসে (da.sheet.create, da.correction.edit, da.sheet.approve)। রোলের অনুমতি শুধু সুপার অ্যাডমিন বদলাতে পারেন।</p></div>
    </div>
  </section>
}
