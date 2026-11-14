import { Fragment, useEffect, useState } from 'react'
import { da, type DaSettings, type Category, type Template } from '../../lib/dailyAccounts'
import { AccountsShell, Field, ErrorNote, Badge, Modal, useLoad, useToast } from './ui'

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
    <div className="da-grid2">
      <section className="panel"><h2>হিসাব শুরু ও সেশন</h2>
        <div className="da-grid2">
          <Field label="প্রতিদিন হিসাব শুরুর সময়"><input type="time" value={s['da.start_time']} onChange={e => set('da.start_time', e.target.value)} /></Field>
          <Field label="কত দিন আগের হিসাব শুরু করা যাবে"><input type="number" min={0} max={31} value={s['da.backdate_days']} onChange={e => set('da.backdate_days', Number(e.target.value))} /></Field>
        </div>
        <label className="da-check"><input type="checkbox" checked={s['da.session_tracking']} onChange={e => set('da.session_tracking', e.target.checked)} /> পেজে প্রবেশ-বের হওয়া ও সময় ট্র্যাক করুন</label>
        <label className="da-check"><input type="checkbox" checked={s['da.require_assignment']} onChange={e => set('da.require_assignment', e.target.checked)} /> শুধু হাবে নির্ধারিত Accounts Manager যাচাই করতে পারবেন</label>
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
        <button onClick={() => void save(['da.due_rule', 'da.mobile_banking_rule', 'da.rider_fields'])}>সেভ</button></section>
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
        <label className="da-check"><input type="checkbox" checked={s['da.ocr'].require_verification} onChange={e => set('da.ocr', { ...s['da.ocr'], require_verification: e.target.checked })} /> OCR তথ্য যাচাই ছাড়া Submit করা যাবে না (প্রস্তাবিত)</label>
        <p className="muted small">OCR: Tesseract.js, ব্রাউজারে চলে; প্রথমবার ইন্টারনেট থেকে লোড হয়।</p>
        <button onClick={() => void save(['da.reference_setup', 'da.bill_upload', 'da.ocr'])}>সেভ</button></section>
    </div>

    <TemplatesCard cats={s['da.expense_categories']} />
    <AccessCard />
  </AccountsShell>
}

function CategoriesCard({ cats, onSave }: { cats: Category[]; onSave: (c: Category[]) => Promise<void> }) {
  const [list, setList] = useState<Category[]>(cats)
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => setList(cats), [cats])
  const set = (i: number, patch: Partial<Category>) => setList(list.map((x, j) => j === i ? { ...x, ...patch } : x))
  return <section className="panel"><h2>খরচের খাত (Expense Category)</h2>
    <p className="muted small">প্রতিটি খাতে কোন খরচ বসবে, আর মেইন সাইটে সেটা কোন ক্যাটাগরি–সাব হেডে যাবে, সীমা কত, রসিদ লাগবে কিনা — এখানে লিখে রাখলে খরচ লেখার সময় হিসাবরক্ষকের চোখের সামনেই থাকবে।</p>
    <table className="da-table"><thead><tr><th>কোড</th><th>English</th><th>বাংলা</th><th>মেইন সাইট</th><th /><th /></tr></thead>
      <tbody>{list.map((c, i) => <Fragment key={i}>
        <tr>
          <td><input value={c.code} onChange={e => set(i, { code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></td>
          <td><input value={c.en} onChange={e => set(i, { en: e.target.value })} /></td>
          <td><input value={c.bn} onChange={e => set(i, { bn: e.target.value })} /></td>
          <td className="muted small">{c.site_name ? <>{c.site_name}{c.site_sub ? ` → ${c.site_sub}` : ''}{c.site_limit != null ? ` · ৳${c.site_limit.toLocaleString('en-US')}` : ''}</> : 'যায় না'}</td>
          <td><button className="secondary sm" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'বন্ধ' : 'বিস্তারিত'}</button></td>
          <td><button className="danger sm" onClick={() => { setList(list.filter((_, j) => j !== i)); setOpen(null) }}>×</button></td>
        </tr>
        {open === i && <tr><td colSpan={6}><div className="da-grid3">
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
    <div className="row"><button className="secondary" onClick={() => setList([...list, { code: '', en: '', bn: '' }])}>＋ খাত</button><button onClick={() => void onSave(list)}>সেভ</button></div>
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
  async function revoke(id: string) { const r = window.prompt('বাতিলের কারণ লিখুন'); if (!r) return; try { await da.revokeAccountant(id, r); await assigned.reload() } catch (e) { setErr(e) } }

  return <section className="panel"><h2>Accounts Manager নির্ধারণ ও হাব-ভিত্তিক অনুমতি</h2>
    <div className="da-filters"><Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}>{(hubs.data ?? []).map(h => <option key={h.hub_id} value={h.hub_id}>{h.name} · {h.zone_name}</option>)}</select></Field>
      <Field label="Accounts Manager"><select value={form.user} onChange={e => setForm({ ...form, user: e.target.value })}><option value="">— বেছে নিন —</option>{(people.data ?? []).map(p => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select></Field>
      <Field label="কারণ"><input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></Field>
      <button disabled={!hub || !form.user || !form.reason.trim()} onClick={() => void assign()}>নির্ধারণ করুন</button></div>
    <ErrorNote error={err || assigned.error || access.error} />
    <div className="da-grid2">
      <div><h3>নির্ধারিত Accounts Manager</h3><table className="da-table"><thead><tr><th>হাব</th><th>ব্যক্তি</th><th>কারণ</th><th /></tr></thead>
        <tbody>{(assigned.data ?? []).map(a => <tr key={a.id}><td>{hubName(a.hub_id)}</td><td>{userName(a.user_id)}</td><td>{a.reason}</td><td><button className="danger sm" onClick={() => void revoke(a.id)}>বাতিল</button></td></tr>)}
          {(assigned.data ?? []).length === 0 && <tr><td colSpan={4} className="muted">কেউ নির্ধারিত নেই — অনুমতিপ্রাপ্ত যেকোনো Accounts Manager যাচাই করতে পারবেন।</td></tr>}</tbody></table></div>
      <div><h3>এই হাবে কার কী অনুমতি</h3><table className="da-table"><thead><tr><th>ব্যক্তি</th><th>রোল</th><th>Submit</th><th>সংশোধন</th><th>অনুমোদন</th></tr></thead>
        <tbody>{(access.data ?? []).map((a, i) => <tr key={i}><td>{a.full_name}</td><td>{a.role_name}<span className="sec">{a.scope_type}</span></td>
          <td>{a.can_submit ? '✓' : '—'}</td><td>{a.can_correct ? '✓' : '—'}</td><td>{a.can_verify ? '✓' : '—'}</td></tr>)}</tbody></table>
        <p className="muted small">Submit, সংশোধন ও অনুমোদনের অনুমতি রোলের মাধ্যমে আসে (da.sheet.create, da.correction.edit, da.sheet.approve)। রোলের অনুমতি শুধু Super Admin বদলাতে পারেন।</p></div>
    </div>
  </section>
}
