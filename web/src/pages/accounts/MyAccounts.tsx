import { useState } from 'react'
import { Link } from 'react-router-dom'
import { da, num, taka, dateBn, timeBn, todayDhaka, addDays, EVENT_LABEL, type SheetEvent } from '../../lib/dailyAccounts'
import { AccountsShell, Stat, StatusBadge, Badge, Field, ErrorNote, useLoad } from './ui'

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

      {corrections.length === 0 && m.notes.length > 0 && <section className="panel"><h2>ম্যানেজারের মন্তব্য ও অনুমোদন</h2>
        <ul className="da-notes">{m.notes.map((n, i) => <li key={i} className={`ev-${n.action}`}><b>{EVENT_LABEL[n.action as SheetEvent['action']] ?? n.action}</b> · {n.hub} · {dateBn(n.account_date)}{n.note ? ` — “${n.note}”` : ''} <span className="muted">({n.by}, {timeBn(n.at)})</span></li>)}</ul></section>}
    </>}
  </AccountsShell>
}
