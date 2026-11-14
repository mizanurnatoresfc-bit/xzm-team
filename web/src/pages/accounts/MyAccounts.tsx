import { useState } from 'react'
import { Link } from 'react-router-dom'
import { da, num, taka, dateBn, timeBn, todayDhaka, addDays, EVENT_LABEL,
  type SheetEvent, type Claim, type Category, type Handover, NOTE_METHOD } from '../../lib/dailyAccounts'
import { AccountsShell, Stat, StatusBadge, Badge, Field, Modal, ErrorNote, useLoad } from './ui'

// আমার হিসাব / My Accounts — for staff, riders, hub managers and accounts managers alike
export function MyAccounts() {
  const today = todayDhaka()
  const [from, setFrom] = useState(addDays(today, -30))
  const [to, setTo] = useState(today)
  const me = useLoad(() => da.myAccounts(from, to), [from, to])
  const m = me.data
  const todayLines = (m?.my_lines ?? []).filter(l => l.account_date === today)
  const corrections = (m?.notes ?? []).filter(n => n.action === 'correction_required')

  return <AccountsShell title="আমার হিসাব" subtitle={m?.employee ? `${m.employee.name} · ID ${m.employee.code}` : 'নিজের সব হিসাব, খরচ, পেমেন্ট ও অনুমোদনের অবস্থা'}>
    <section className="da-filters panel">
      <Field label="শুরুর তারিখ"><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label="শেষ তারিখ"><input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} /></Field>
    </section>
    <ErrorNote error={me.error} />
    {me.loading && <p className="muted">লোড হচ্ছে…</p>}
    {m && <>
      <section className="da-stats">
        <Stat label="আজকের ডেলিভারি" value={num(todayLines.reduce((a, l) => a + l.line.delivery_qty, 0))} />
        <Stat label="আজকের পিকআপ" value={num(todayLines.reduce((a, l) => a + l.line.pickup_qty, 0))} />
        <Stat label="আজকের টাকা" value={taka(todayLines.reduce((a, l) => a + Number(l.line.amount), 0))} />
        <Stat label="এই সময়ের বকেয়া" value={taka(m.my_lines.reduce((a, l) => a + Number(l.line.due), 0))} tone={m.my_lines.some(l => l.line.due > 0) ? 'warn' : undefined} />
        <Stat label="সংশোধনের অনুরোধ" value={num(corrections.length)} tone={corrections.length ? 'bad' : undefined} />
        <Stat label="আমার খরচ" value={taka(m.my_expenses.reduce((a, x) => a + Number(x.amount), 0))} />
      </section>

      {corrections.length > 0 && <section className="panel"><h2>সংশোধনের অনুরোধ ও ম্যানেজারের মন্তব্য</h2>
        <ul className="da-notes">{m.notes.map((n, i) => <li key={i} className={`ev-${n.action}`}>
          <b>{EVENT_LABEL[n.action as SheetEvent['action']] ?? n.action}</b> · {n.hub} · {dateBn(n.account_date)} — “{n.note ?? ''}” <span className="muted">({n.by}, {timeBn(n.at)})</span>
          <Link to={`/app/accounts/daily/${n.session_id}`}> খুলুন →</Link></li>)}</ul></section>}

      <section className="panel"><h2>আমার রাইডার হিসাব (আজ ও আগের দিন)</h2>
        <div className="da-table-wrap"><table className="da-table"><thead><tr><th>তারিখ</th><th>হাব</th><th className="r">ডেলিভারি</th><th className="r">পিকআপ</th><th className="r">টাকা</th><th className="r">বকেয়া</th><th className="r">মোবাইল ব্যাংকিং</th><th>অবস্থা</th><th>মন্তব্য</th></tr></thead>
          <tbody>{m.my_lines.map(l => <tr key={l.line.id} className={l.account_date === today ? 'today' : ''}><td data-l="তারিখ">{dateBn(l.account_date)}{l.account_date === today && <Badge tone="info">আজ</Badge>}</td><td data-l="হাব">{l.hub}</td>
            <td data-l="ডেলিভারি" className="r">{num(l.line.delivery_qty)}</td><td data-l="পিকআপ" className="r">{num(l.line.pickup_qty)}</td><td data-l="টাকা" className="r">{taka(l.line.amount)}</td>
            <td data-l="বকেয়া" className="r">{taka(l.line.due)}</td><td data-l="মোবাইল ব্যাংকিং" className="r">{taka(l.line.mobile_banking)}</td><td data-l="অবস্থা"><StatusBadge status={l.status} /></td><td data-l="মন্তব্য">{l.verify_note ?? l.line.remarks ?? ''}</td></tr>)}
            {m.my_lines.length === 0 && <tr><td colSpan={9} className="muted">এই সময়ে আপনার নামে কোনো রাইডার হিসাব নেই।</td></tr>}</tbody></table></div></section>

      <section className="panel"><h2>আমার শুরু / Submit করা হিসাব</h2>
        <div className="da-table-wrap"><table className="da-table"><thead><tr><th>নং</th><th>তারিখ</th><th>হাব</th><th>আমার ভূমিকা</th><th>অবস্থা</th><th>Submit</th><th>যাচাই</th><th>মন্তব্য</th><th /></tr></thead>
          <tbody>{m.my_sheets.map(sh => <tr key={sh.id}><td data-l="নং">{num(sh.no)}</td><td data-l="তারিখ">{dateBn(sh.account_date)}</td><td data-l="হাব">{sh.hub}</td>
            <td data-l="ভূমিকা">{[sh.started_by_me && 'শুরু', sh.submitted_by_me && 'Submit'].filter(Boolean).join(' · ')}</td><td data-l="অবস্থা"><StatusBadge status={sh.status} /></td>
            <td data-l="Submit">{timeBn(sh.submitted_at)}</td><td data-l="যাচাই">{sh.verified_by_name ? `${sh.verified_by_name} · ${timeBn(sh.verified_at)}` : '—'}</td><td data-l="মন্তব্য">{sh.verify_note ?? ''}</td>
            <td><Link to={`/app/accounts/daily/${sh.id}`}>খুলুন →</Link></td></tr>)}
            {m.my_sheets.length === 0 && <tr><td colSpan={9} className="muted">কোনো হিসাব নেই।</td></tr>}</tbody></table></div></section>

      <div className="da-grid2">
        <section className="panel"><h2>আমার খরচ</h2>
          <div className="da-table-wrap"><table className="da-table"><thead><tr><th>তারিখ</th><th>খরচ</th><th className="r">টাকা</th><th>অবস্থা</th></tr></thead>
            <tbody>{m.my_expenses.map(x => <tr key={x.id}><td data-l="তারিখ">{dateBn(x.bill_date)}</td><td data-l="খরচ">{x.expense_name}<span className="sec">{x.kind === 'transport' ? 'যাতায়াত' : 'কর্মী'}</span></td>
              <td data-l="টাকা" className="r">{taka(x.amount)}</td><td data-l="অবস্থা"><StatusBadge status={x.status} /></td></tr>)}
              {m.my_expenses.length === 0 && <tr><td colSpan={4} className="muted">কোনো খরচ নেই।</td></tr>}</tbody></table></div></section>
        <section className="panel"><h2>আমার এন্ট্রি করা পেমেন্ট</h2>
          <div className="da-table-wrap"><table className="da-table"><thead><tr><th>তারিখ</th><th>মার্চেন্ট</th><th className="r">টাকা</th><th>অবস্থা</th></tr></thead>
            <tbody>{m.my_payments.map(p => <tr key={p.id}><td data-l="তারিখ">{dateBn(p.payment_date)}</td><td data-l="মার্চেন্ট">{p.merchant_name}<span className="sec">{p.transaction_id ?? ''}</span></td>
              <td data-l="টাকা" className="r">{taka(p.amount)}</td><td data-l="অবস্থা"><StatusBadge status={p.status} /></td></tr>)}
              {m.my_payments.length === 0 && <tr><td colSpan={4} className="muted">কোনো পেমেন্ট নেই।</td></tr>}</tbody></table></div></section>
      </div>

      <MyClaims />
      <MyHandovers />
      <MyVehicles />

      {corrections.length === 0 && m.notes.length > 0 && <section className="panel"><h2>ম্যানেজারের মন্তব্য ও অনুমোদন</h2>
        <ul className="da-notes">{m.notes.map((n, i) => <li key={i} className={`ev-${n.action}`}><b>{EVENT_LABEL[n.action as SheetEvent['action']] ?? n.action}</b> · {n.hub} · {dateBn(n.account_date)}{n.note ? ` — “${n.note}”` : ''} <span className="muted">({n.by}, {timeBn(n.at)})</span></li>)}</ul></section>}
    </>}
  </AccountsShell>
}

const CLAIM_STATUS: Record<string, [string, 'ok' | 'warn' | 'bad' | undefined]> = {
  submitted: ['অপেক্ষায়', 'warn'], added: ['খাতায় উঠেছে', 'ok'],
  rejected: ['বাতিল', 'bad'], withdrawn: ['ফিরিয়ে নেওয়া', undefined],
}

type CDraft = { claim?: string; kind: 'transport' | 'employee'; name: string; category: string; amount: string
  date: string; billNo: string; refName: string; refPhone: string; refPosition: string; vehicle: string; remarks: string }

/** Bills a person puts up themselves, for the manager to take into the day's sheet. */
function MyClaims() {
  const today = todayDhaka()
  const claims = useLoad(() => da.myClaims(90), [])
  const settings = useLoad(() => da.settings().catch(() => null), [])
  const vehicles = useLoad(() => da.myVehicles().catch(() => []), [])
  const [d, setD] = useState<CDraft | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [drop, setDrop] = useState<Claim | null>(null)
  const [reason, setReason] = useState('')
  const cats: Category[] = settings.data?.['da.expense_categories'] ?? []
  const refPeople = settings.data?.['da.reference_people'] ?? []
  const list = claims.data ?? []
  const blank = (): CDraft => ({ kind: 'employee', name: '', category: cats[0]?.code ?? 'other', amount: '', date: today,
    billNo: '', refName: '', refPhone: '', refPosition: '', vehicle: '', remarks: '' })

  async function save() {
    if (!d) return
    setBusy(true); setErr(null)
    try {
      await da.saveClaim({ name: d.name, category: d.category, amount: +d.amount, date: d.date, kind: d.kind,
        billNo: d.billNo || null, refName: d.refName || null, refPhone: d.refPhone || null,
        refPosition: d.refPosition || null, vehicle: d.vehicle || null, remarks: d.remarks || null, claim: d.claim })
      setD(null); await claims.reload()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  async function withdraw() {
    if (!drop) return
    setBusy(true); setErr(null)
    try { await da.withdrawClaim(drop.id, reason); setDrop(null); setReason(''); await claims.reload() }
    catch (e) { setErr(e) } finally { setBusy(false) }
  }

  return <section className="panel">
    <div className="da-bar"><h2>আমার জমা দেওয়া বিল</h2>
      <button onClick={() => { setErr(null); setD(blank()) }}>＋ বিল জমা দিন</button></div>
    <p className="muted small">নিজের খরচ এখানে জমা দিন — হাব ম্যানেজার দেখে আজকের হিসাব খাতায় তুলে নেবেন।</p>
    <ErrorNote error={claims.error} />
    <div className="da-table-wrap"><table className="da-table">
      <thead><tr><th>তারিখ</th><th>খরচ</th><th>খাত</th><th className="r">টাকা</th><th>অবস্থা</th><th>মন্তব্য</th><th className="no-print" /></tr></thead>
      <tbody>{list.map(c => <tr key={c.id}>
        <td data-l="তারিখ">{dateBn(c.bill_date)}</td>
        <td data-l="খরচ"><b>{c.expense_name}</b><span className="sec">{c.kind === 'transport' ? 'যাতায়াত' : 'কর্মী'}</span></td>
        <td data-l="খাত">{cats.find(x => x.code === c.category)?.bn ?? c.category}</td>
        <td data-l="টাকা" className="r">{taka(c.amount)}</td>
        <td data-l="অবস্থা"><Badge tone={CLAIM_STATUS[c.status ?? 'submitted']?.[1]}>{CLAIM_STATUS[c.status ?? 'submitted']?.[0] ?? c.status}</Badge></td>
        <td data-l="মন্তব্য">{c.review_note ?? c.remarks ?? ''}</td>
        <td className="no-print">{c.status === 'submitted' && <span className="row">
          <button className="secondary sm" onClick={() => setD({ claim: c.id, kind: c.kind, name: c.expense_name, category: c.category,
            amount: String(c.amount), date: c.bill_date, billNo: c.bill_no ?? '', refName: c.reference_name ?? '',
            refPhone: c.reference_phone ?? '', refPosition: c.reference_position ?? '', vehicle: c.vehicle_id ?? '', remarks: c.remarks ?? '' })}>এডিট</button>
          <button className="danger sm" onClick={() => { setDrop(c); setReason('') }}>ফিরিয়ে নিন</button></span>}</td>
      </tr>)}
        {list.length === 0 && <tr><td colSpan={7} className="muted">এখনো কোনো বিল জমা দেননি।</td></tr>}</tbody></table></div>

    {d && <Modal wide title={d.claim ? 'বিল এডিট' : 'নিজের খরচ জমা দিন'} onClose={() => setD(null)}
      actions={<><button className="secondary" onClick={() => setD(null)}>বাতিল</button>
        <button disabled={busy || !d.name || !(+d.amount > 0)} onClick={() => void save()}>{busy ? 'জমা হচ্ছে…' : 'জমা দিন'}</button></>}>
      <div className="da-grid3">
        <Field label="খরচের ধরন"><select value={d.kind} onChange={e => setD({ ...d, kind: e.target.value as CDraft['kind'] })}>
          <option value="employee">কর্মীর খরচ</option><option value="transport">যাতায়াত</option></select></Field>
        <Field label="খরচের নাম *"><input autoFocus value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="খাত *"><select value={d.category} onChange={e => setD({ ...d, category: e.target.value })}>
          {cats.map(c => <option key={c.code} value={c.code}>{c.bn} ({c.en})</option>)}</select></Field>
        <Field label="টাকা *"><input type="number" min={1} value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></Field>
        <Field label="বিলের তারিখ *"><input type="date" max={today} value={d.date} onChange={e => setD({ ...d, date: e.target.value })} /></Field>
        <Field label="বিল নম্বর"><input value={d.billNo} onChange={e => setD({ ...d, billNo: e.target.value })} /></Field>
        {(vehicles.data ?? []).length > 0 && <Field label="কোন গাড়ির জন্য">
          <select value={d.vehicle} onChange={e => setD({ ...d, vehicle: e.target.value })}>
            <option value="">— গাড়ি নয় —</option>
            {(vehicles.data ?? []).map(v => <option key={v.vehicle_id} value={v.vehicle_id}>{v.name} ({v.code})</option>)}</select></Field>}
        {refPeople.length > 0 && <Field label="রেফারেন্স (সেভ করা)">
          <select value="" onChange={e => { const r = refPeople[+e.target.value]; if (r) setD({ ...d, refName: r.name, refPhone: r.phone ?? '', refPosition: r.position ?? '' }) }}>
            <option value="">— বেছে নিন —</option>
            {refPeople.map((r, i) => <option key={`${r.name}-${i}`} value={i}>{r.name}{r.position ? ` · ${r.position}` : ''}</option>)}</select></Field>}
        <Field label="রেফারেন্সের নাম"><input value={d.refName} onChange={e => setD({ ...d, refName: e.target.value })} /></Field>
        <Field label="রেফারেন্সের মোবাইল"><input inputMode="numeric" placeholder="01XXXXXXXXX" value={d.refPhone} onChange={e => setD({ ...d, refPhone: e.target.value })} /></Field>
        <Field label="রেফারেন্সের পদবি"><input value={d.refPosition} onChange={e => setD({ ...d, refPosition: e.target.value })} /></Field>
        <Field wide label="মন্তব্য"><input value={d.remarks} onChange={e => setD({ ...d, remarks: e.target.value })} /></Field>
      </div>
      <ErrorNote error={err} />
    </Modal>}

    {drop && <Modal title="বিল ফিরিয়ে নেবেন?" onClose={() => setDrop(null)}
      actions={<><button className="secondary" onClick={() => setDrop(null)}>না</button>
        <button className="danger" disabled={busy || !reason.trim()} onClick={() => void withdraw()}>ফিরিয়ে নিন</button></>}>
      <p className="muted small">{drop.expense_name} · {taka(drop.amount)}</p>
      <Field label="কারণ *"><input value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <ErrorNote error={err} />
    </Modal>}
  </section>
}

/** Money this person handed over, as the one who took it wrote it down. */
function MyHandovers() {
  const list = useLoad(() => da.myHandovers(60).catch(() => [] as Handover[]), [])
  const rows = list.data ?? []
  if (rows.length === 0) return null
  const total = rows.reduce((a, h) => a + h.amount, 0)
  return <section className="panel">
    <h2>আমি যা জমা দিয়েছি</h2>
    <p className="muted small">হাবের হিসাবের খাতায় আপনার নামে যা লেখা হয়েছে।</p>
    <div className="da-table-wrap"><table className="da-table">
      <thead><tr><th>তারিখ</th><th>হাব</th><th>মাধ্যম</th><th className="r">টাকা</th><th>নোট</th><th>কে নিয়েছেন</th></tr></thead>
      <tbody>{rows.map(h => <tr key={h.id}>
        <td data-l="তারিখ">{dateBn(h.account_date)}</td>
        <td data-l="হাব">{h.hub_name}</td>
        <td data-l="মাধ্যম">{NOTE_METHOD[h.method] ?? h.method}</td>
        <td data-l="টাকা" className="r">{taka(h.amount)}</td>
        <td data-l="নোট">{h.note ?? ''}</td>
        <td data-l="কে নিয়েছেন">{h.taken_by ?? '—'}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={3}>মোট ({num(rows.length)} টি)</td><td className="r">{taka(total)}</td><td colSpan={2} /></tr></tfoot>
    </table></div>
  </section>
}

/** The vehicle a person holds, and what has been spent on it. */
function MyVehicles() {
  const mine = useLoad(() => da.myVehicles().catch(() => []), [])
  const settings = useLoad(() => da.settings().catch(() => null), [])
  const cats: Category[] = settings.data?.['da.expense_categories'] ?? []
  const list = mine.data ?? []
  if (list.length === 0) return null
  return <section className="panel">
    <h2>আমার নামে থাকা গাড়ি</h2>
    {list.map(v => <div key={v.vehicle_id} style={{ marginBottom: 14 }}>
      <div className="da-bar"><h3 style={{ margin: 0 }}>{v.name} <span className="muted small">{v.code}{v.reg_no ? ` · ${v.reg_no}` : ''}</span></h3>
        <span className="muted small">৩০ দিনে খরচ <b>{taka(v.spent_30d)}</b> · {dateBn(v.since)} থেকে আমার কাছে</span></div>
      <div className="da-table-wrap"><table className="da-table">
        <thead><tr><th>তারিখ</th><th>কী বাবদ</th><th>খাত</th><th className="r">টাকা</th><th>বিল / ভাউচার</th></tr></thead>
        <tbody>{v.lines.map((l, i) => <tr key={i}>
          <td data-l="তারিখ">{dateBn(l.date)}</td><td data-l="কী বাবদ"><b>{l.name}</b>{l.remarks ? <span className="sec">{l.remarks}</span> : null}</td>
          <td data-l="খাত">{cats.find(x => x.code === l.category)?.bn ?? l.category}</td><td data-l="টাকা" className="r">{taka(l.amount)}</td>
          <td data-l="বিল">{l.bill_no ?? l.voucher_no ?? '—'}</td></tr>)}
          {v.lines.length === 0 && <tr><td colSpan={5} className="muted">৯০ দিনে এই গাড়ির কোনো খরচ ওঠেনি।</td></tr>}</tbody></table></div>
    </div>)}
  </section>
}
