// হিসাব কেন্দ্র — the manager's accounts dashboard inside Nodi: one day across the hubs a person may see.
// Hub manager: their hub, with create actions. Zonal manager: every assigned hub, deposit and voucher status,
// submission and approval times. Head office: every hub. What each sees is decided by the database (da_center_overview).
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { Icon } from '../../components/Icon'
import { LearnButton } from '../../components/Learn'
import { TRANSPORT_CATEGORIES, sortExpense, type ModuleKey } from '../../lib/accountsGuide'
import { da, dateBn, num, taka, timeBn, todayDhaka, addDays, type Category, type CenterRow, type HistoryRow } from '../../lib/dailyAccounts'
import { supabase } from '../../lib/supabase'
import { printVoucher } from '../../lib/voucher'
import { downloadVoucherPng } from '../../lib/voucherImage'
import { AccountsShell, Badge, ErrorNote, Field, StatusBadge, useLoad, useToast } from './ui'

type Tab = 'overview' | 'expenses' | 'staff' | 'transport' | 'vouchers' | 'missing' | 'history' | 'new'
type XRow = { id: string; no: number; kind: 'transport' | 'employee'; expense_name: string; category: string; amount: number; bill_date: string
  voucher_no: string | null; attachment_path: string | null; claim_file: string | null; bill_no: string | null; employee_code: string | null; employee_name: string | null
  reference_name: string | null; hub_id: string; session_id: string; da_sessions: { account_date: string } | null }

const TABS: Array<[Tab, string]> = [['overview', 'হাবের চিত্র'], ['expenses', 'হাবের খরচ'], ['staff', 'স্টাফ খরচ'], ['transport', 'যাতায়াত বিল'],
  ['vouchers', 'ভাউচার ম্যানেজমেন্ট'], ['missing', 'ভাউচার জমা হয়নি'], ['history', 'হিসাবের ইতিহাস'], ['new', 'নতুন ভাউচার']]
const ACTION: Record<string, string> = { INSERT: 'তৈরি', UPDATE: 'বদল', DELETE: 'মুছে ফেলা', ARCHIVE: 'বাদ' }
const TABLE: Record<string, string> = { da_sessions: 'হিসাব খাতা', da_rider_lines: 'রাইডারের হিসাব', da_merchant_payments: 'মার্চেন্ট ক্যাশ পেমেন্ট',
  da_expenses: 'খরচ', da_expense_claims: 'কর্মীর বিল', da_cash_notes: 'নোট (জমা)', da_report_ids: 'দৈনিক রিপোর্ট', da_deposits: 'ব্যাংকে জমা' }
const FIELD: Record<string, string> = { amount: 'টাকা', status: 'অবস্থা', expense_name: 'খরচের নাম', category: 'খাত', voucher_no: 'ভাউচার', attachment_path: 'বিল/ভাউচারের ছবি',
  slip_path: 'স্লিপ', slip_match: 'স্লিপ মিল', bank_confirmed_at: 'ব্যাংকে নিশ্চিত', removed_at: 'বাদ দেওয়া', remove_reason: 'বাদের কারণ', delivery_qty: 'ডেলিভারি',
  pickup_qty: 'পিকআপ', paid_amount: 'জমা', due: 'বকেয়া', report_no: 'রিপোর্ট আইডি', verified_at: 'অনুমোদন', submitted_at: 'জমা দেওয়া', accepted_at: 'গ্রহণ', employee_code: 'স্টাফ আইডি' }
const show = (v: unknown) => v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60)

export function AccountsCenter() {
  const { can } = useAuth()
  const [sp, setSp] = useSearchParams()
  const tab = (TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'overview') as Tab
  const go = (t: Tab) => { const n = new URLSearchParams(sp); n.set('tab', t); setSp(n) }
  const today = todayDhaka()
  const [date, setDate] = useState(today)
  const [from, setFrom] = useState(addDays(today, -6))
  const [hub, setHub] = useState('')
  const { toast, node } = useToast()
  const ov = useLoad(() => da.centerOverview(date), [date])
  const settings = useLoad(() => da.settings().catch(() => null), [])
  const cats: Category[] = settings.data?.['da.expense_categories'] ?? []
  const rows = ov.data ?? []
  const hubs = rows.map(r => ({ id: r.id, name: r.name, zone: r.zone }))
  const canCreate = can('da.sheet.create')
  const sum = (f: (r: CenterRow) => number) => rows.reduce((a, r) => a + Number(f(r) || 0), 0)

  const tiles: Array<[string, string, string, string, () => void]> = [
    ['doc', 'দৈনিক রিপোর্ট', `${num(sum(r => r.reports))}টি · ${taka(sum(r => r.report_total))}`, 'b', () => go('overview')],
    ['receipt', 'হাবের খরচ', taka(sum(r => r.expense)), 'o', () => go('expenses')],
    ['cash', 'মার্চেন্ট ক্যাশ পেমেন্ট', taka(sum(r => r.merchant)), 'p', () => go('overview')],
    ['wallet', 'ব্যাংকে জমা', `${taka(sum(r => r.deposited))} · নিশ্চিত ${num(sum(r => r.bank_confirmed))}/${num(sum(r => r.deposits))}`, 'g', () => go('overview')],
    ['ledger', 'হাবের বকেয়া / ফান্ড', taka(sum(r => r.session_id ? r.hub_due : 0)), 'r', () => go('overview')],
    ['file', 'ভাউচার ম্যানেজমেন্ট', 'তালিকা · প্রিন্ট · ছবি', 'b', () => go('vouchers')],
    ['alert', 'ভাউচার জমা হয়নি', `${num(sum(r => r.missing_vouchers))}টি`, sum(r => r.missing_vouchers) ? 'r' : 'g', () => go('missing')],
    ['users', 'স্টাফ খরচ', taka(sum(r => r.staff_expense)), 'p', () => go('staff')],
    ['truck', 'যাতায়াত বিল', taka(sum(r => r.transport_expense)), 'o', () => go('transport')],
    ['log', 'হিসাবের ইতিহাস', 'কে কখন কী বদলালেন', 'b', () => go('history')],
  ]

  return <AccountsShell title="হিসাব কেন্দ্র" subtitle="নদী AI · SteadFast হাবের হিসাব — দৈনিক রিপোর্ট থেকে ব্যাংকে জমা পর্যন্ত"
    actions={<Link className="btn-ghost" to="/app/accounts/learn"><Icon name="book" size={16} />বাংলা শেখার কেন্দ্র</Link>}>
    {node}
    <div className="ac">
      <div className="ac-bar no-print">
        <Field label="তারিখ"><input type="date" value={date} max={today} onChange={e => setDate(e.target.value || today)} /></Field>
        {hubs.length > 1 && <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}><option value="">সব হাব</option>
          {hubs.map(h => <option key={h.id} value={h.id}>{h.name} · {h.zone}</option>)}</select></Field>}
        {canCreate && <button type="button" onClick={() => go('new')}><Icon name="plus" size={16} />নতুন ভাউচার</button>}
      </div>
      <ErrorNote error={ov.error} />
      <div className="ac-tiles">{tiles.map(([ic, t, v, tone, f]) => <button key={t} type="button" className={`ac-tile t-${tone}`} onClick={f}>
        <span className="i"><Icon name={ic} size={20} /></span><b>{t}</b><small>{v}</small></button>)}
        <Link to="/app/accounts/learn" className="ac-tile t-g learn"><span className="i"><Icon name="book" size={20} /></span><b>বাংলা শেখার কেন্দ্র</b><small>নির্দেশনা · অনুশীলন · AI শিক্ষক</small></Link></div>

      <nav className="da-tabs ac-tabs no-print" aria-label="হিসাব কেন্দ্রের অংশ">{TABS.filter(([k]) => k !== 'new' || canCreate).map(([k, l]) =>
        <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => go(k)}>{l}</button>)}</nav>

      {tab === 'overview' && <Overview rows={hub ? rows.filter(r => r.id === hub) : rows} loading={ov.loading} date={date} />}
      {(tab === 'expenses' || tab === 'staff' || tab === 'transport' || tab === 'vouchers' || tab === 'missing') &&
        <ExpenseList kind={tab} hub={hub} from={tab === 'missing' ? addDays(date, -30) : from} to={date} setFrom={setFrom} cats={cats} hubs={hubs} />}
      {tab === 'history' && <History hubs={hubs} hub={hub || hubs[0]?.id || ''} setHub={setHub} from={from} to={date} setFrom={setFrom} />}
      {tab === 'new' && canCreate && <NewVoucher cats={cats} done={msg => { toast(msg); void ov.reload() }} />}
    </div>
  </AccountsShell>
}

// ---- one card per hub: report, expenses, payments, bank, slips, vouchers, times ----
function Overview({ rows, loading, date }: { rows: CenterRow[]; loading: boolean; date: string }) {
  if (loading && !rows.length) return <p className="muted">লোড হচ্ছে…</p>
  if (!rows.length) return <p className="muted">দেখার মতো কোনো হাব নেই।</p>
  return <div className="ac-hubs">{rows.map(r => <section key={r.id} className="panel ac-hub" data-hub={r.id}>
    <div className="da-bar"><div><h2 style={{ margin: 0 }}>{r.name}</h2><small className="muted">{r.zone} · {dateBn(date)}</small></div>
      {r.status ? <StatusBadge status={r.status} /> : <Badge tone="warn">খাতা খোলা হয়নি</Badge>}</div>
    {r.session_id ? <>
      <div className="ac-nums">
        <div><span>দৈনিক রিপোর্ট</span><b>{taka(r.report_total)}</b><small>{num(r.reports)}টি আইডি</small></div>
        <div><span>হাবের খরচ</span><b>{taka(r.expense)}</b><small>স্টাফ {taka(r.staff_expense)} · যাতায়াত {taka(r.transport_expense)}</small></div>
        <div><span>মার্চেন্ট ক্যাশ পেমেন্ট</span><b>{taka(r.merchant)}</b></div>
        <div><span>ব্যাংকে যাওয়ার কথা</span><b>{taka(r.bank_amount)}</b><small>চার্জ ও যাতায়াত {taka(r.bank_costs)}</small></div>
        <div><span>ব্যাংকে জমা</span><b>{taka(r.deposited)}</b><small>{num(r.deposits)}টি · নিশ্চিত {num(r.bank_confirmed)}</small></div>
        <div className={r.hub_due > 0 ? 'warn' : r.hub_due < 0 ? 'bad' : 'ok'}><span>{r.hub_due < 0 ? 'হাবে ফান্ড দরকার' : 'হাবের বকেয়া'}</span><b>{taka(Math.abs(r.hub_due))}</b></div>
      </div>
      <div className="ac-flags">
        {r.slips_missing > 0 && <Badge tone="warn">স্লিপ বাকি {num(r.slips_missing)}</Badge>}
        {r.slips_match > 0 && <Badge tone="ok">MATCH {num(r.slips_match)}</Badge>}
        {r.slips_not_match > 0 && <Badge tone="bad">NOT MATCH {num(r.slips_not_match)}</Badge>}
        {r.slips_review > 0 && <Badge tone="warn">NEEDS REVIEW {num(r.slips_review)}</Badge>}
        {r.missing_vouchers > 0 && <Badge tone="bad">ভাউচার জমা হয়নি {num(r.missing_vouchers)}</Badge>}
        {r.bills_waiting > 0 && <Badge tone="info">কর্মীর বিল অপেক্ষায় {num(r.bills_waiting)}</Badge>}
      </div>
      <ul className="ac-times">
        <li><b>শুরু</b> {timeBn(r.started_at)} · {r.started_by_name ?? '—'}</li>
        <li><b>জমা</b> {r.submitted_at ? `${timeBn(r.submitted_at)} · ${r.submitted_by_name ?? ''}` : '—'}</li>
        <li><b>অনুমোদন</b> {r.verified_at ? `${timeBn(r.verified_at)} · ${r.verified_by_name ?? ''}` : '—'}</li>
        <li><b>ব্যাংক ক্লোজ</b> {r.bank_done_at ? timeBn(r.bank_done_at) : '—'}</li>
      </ul>
      <div className="row no-print"><Link className="btn-ghost" to={`/app/accounts/daily/${r.session_id}`}>খাতা খুলুন →</Link>
        <button type="button" className="secondary sm" onClick={() => topSheet(r, date)}><Icon name="print" size={15} />টপ শিট</button>
        <button type="button" className="secondary sm" onClick={() => void shareTop(r, date)}><Icon name="wa" size={15} />শেয়ার</button></div>
    </> : <p className="muted small">এই দিনে হাবের হিসাব খাতা খোলা হয়নি।{r.bills_waiting > 0 ? ` কর্মীর ${num(r.bills_waiting)}টি বিল অপেক্ষায়।` : ''}</p>}
  </section>)}</div>
}

const topLines = (r: CenterRow, date: string) => [
  `টপ শিট — ${r.name} (${r.zone}) · ${dateBn(date)}`,
  `দৈনিক রিপোর্ট: ${taka(r.report_total)} (${num(r.reports)}টি আইডি)`,
  `মার্চেন্ট ক্যাশ পেমেন্ট: ${taka(r.merchant)}`,
  `হাবের খরচ: ${taka(r.expense)} (স্টাফ ${taka(r.staff_expense)} · যাতায়াত ${taka(r.transport_expense)})`,
  `ব্যাংক চার্জ ও যাতায়াত: ${taka(r.bank_costs)}`,
  `ব্যাংকে যাওয়ার কথা: ${taka(r.bank_amount)}`,
  `ব্যাংকে জমা: ${taka(r.deposited)} · নিশ্চিত ${num(r.bank_confirmed)}/${num(r.deposits)}`,
  `${r.hub_due < 0 ? 'হাবে ফান্ড দরকার' : 'হাবের বকেয়া'}: ${taka(Math.abs(r.hub_due))}`,
  `ভাউচার জমা হয়নি: ${num(r.missing_vouchers)}টি`,
  `জমা: ${r.submitted_at ? `${timeBn(r.submitted_at)} ${r.submitted_by_name ?? ''}` : '—'} · অনুমোদন: ${r.verified_at ? `${timeBn(r.verified_at)} ${r.verified_by_name ?? ''}` : '—'}`,
]
function topSheet(r: CenterRow, date: string) {
  const esc = (x: string) => x.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
  const [head, ...rest] = topLines(r, date)
  const box = document.createElement('div'); box.id = 'print-box'
  box.innerHTML = `<h2>${esc(head)}</h2><table>${rest.map(l => { const i = l.indexOf(':'); return `<tr><th style="text-align:left;width:45%">${esc(l.slice(0, i))}</th><td>${esc(l.slice(i + 1))}</td></tr>` }).join('')}</table>
    <p style="margin-top:40px;display:flex;gap:40px"><span>হাব ইনচার্জ: ____________</span><span>জোনাল ম্যানেজার: ____________</span></p>`
  ;(document.querySelector('.app-main') ?? document.body).appendChild(box)
  document.body.classList.add('print-list')
  const done = () => { box.remove(); document.body.classList.remove('print-list'); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50)
}
async function shareTop(r: CenterRow, date: string) {
  const text = topLines(r, date).join('\n')
  const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> }
  try { if (nav.share) { await nav.share({ title: 'টপ শিট', text }); return } } catch { return }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}

// ---- expense lists: all, staff, transport, vouchers, missing vouchers ----
function ExpenseList({ kind, hub, from, to, setFrom, cats, hubs }: { kind: Tab; hub: string; from: string; to: string; setFrom: (d: string) => void
  cats: Category[]; hubs: Array<{ id: string; name: string }> }) {
  const [err, setErr] = useState<unknown>(null)
  const list = useLoad(async () => {
    let q = supabase.from('da_expenses').select('id, no, kind, expense_name, category, amount, bill_date, voucher_no, attachment_path, claim_file, bill_no, employee_code, employee_name, reference_name, hub_id, session_id, da_sessions!inner(account_date)')
      .is('removed_at', null).gte('da_sessions.account_date', from).lte('da_sessions.account_date', to).order('bill_date', { ascending: false }).limit(500)
    if (hub) q = q.eq('hub_id', hub)
    if (kind === 'staff') q = q.eq('kind', 'employee')
    if (kind === 'transport') q = q.eq('kind', 'transport')
    if (kind === 'vouchers') q = q.not('voucher_no', 'is', null)
    if (kind === 'missing') q = q.is('attachment_path', null).is('claim_file', null)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as unknown as XRow[]
  }, [kind, hub, from, to])
  const rows = list.data ?? []
  const catName = (c: string) => cats.find(x => x.code === c)?.bn ?? c
  const hubName = useMemo(() => new Map(hubs.map(h => [h.id, h.name])), [hubs])
  const total = rows.reduce((a, r) => a + Number(r.amount), 0)
  const pr = async (r: XRow, png: boolean) => { setErr(null); try { const v = await da.voucher(r.id); const c = cats.find(x => x.code === r.category); if (png) await downloadVoucherPng(v, c); else printVoucher(v, c) } catch (e) { setErr(e) } }
  const title = { expenses: 'হাবের খরচ', staff: 'স্টাফ খরচ', transport: 'যাতায়াত বিল', vouchers: 'ভাউচার ম্যানেজমেন্ট', missing: 'ভাউচার জমা হয়নি' }[kind as string] ?? ''
  const lessonKey: ModuleKey = kind === 'staff' ? 'staff_expense' : kind === 'transport' ? 'transport' : kind === 'vouchers' ? 'voucher' : kind === 'missing' ? 'missing_voucher' : 'expense'
  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{title} <span className="muted small">· {num(rows.length)}টি · {taka(total)}</span></h2>
      <span className="row"><LearnButton module={lessonKey} />{kind !== 'missing' && <label className="ac-from small">শুরু <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} /></label>}</span></div>
    {kind === 'missing' && <p className="muted small">গত ৩০ দিনের যে খরচে বিল বা সই করা ভাউচারের ছবি নেই — খাতা খুলে ছবি দিলে তালিকা থেকে সরে যাবে।</p>}
    {kind === 'transport' && <p className="muted small">স্টাফ আইডি ছাড়া খরচ ("যাতায়াত" ধরন)। যাতায়াত/টোল খাতগুলো আলাদা চিহ্নিত।</p>}
    <ErrorNote error={list.error || err} />
    {list.loading && !list.data ? <p className="muted">লোড হচ্ছে…</p> : <div className="da-table-wrap"><table className="da-table">
      <thead><tr><th>তারিখ</th><th>হাব</th><th>খরচ</th><th>খাত</th><th>স্টাফ</th><th className="r">টাকা</th><th>ভাউচার / বিল</th><th>ভাগ</th><th className="no-print" /></tr></thead>
      <tbody>{rows.map(r => { const s = sortExpense({ staffId: r.employee_code, hasVoucherFile: !!(r.attachment_path || r.claim_file) })
        return <tr key={r.id}>
          <td data-l="তারিখ">{dateBn(r.da_sessions?.account_date ?? r.bill_date)}</td><td data-l="হাব">{hubName.get(r.hub_id) ?? '—'}</td>
          <td data-l="খরচ">{r.expense_name}{r.reference_name && <span className="sec">রেফারেন্স: {r.reference_name}</span>}</td>
          <td data-l="খাত">{catName(r.category)}{TRANSPORT_CATEGORIES.includes(r.category) && <span className="sec">যাতায়াত</span>}</td>
          <td data-l="স্টাফ">{r.employee_code ? `${r.employee_name ?? ''} #${r.employee_code}` : '—'}</td>
          <td data-l="টাকা" className="r"><b>{taka(r.amount)}</b></td>
          <td data-l="ভাউচার / বিল">{r.voucher_no ? <b>{r.voucher_no}</b> : r.bill_no ? `বিল ${r.bill_no}` : '—'}{(r.attachment_path || r.claim_file) ? <span className="sec">ছবি আছে</span> : <span className="sec warn">ছবি নেই</span>}</td>
          <td data-l="ভাগ"><Badge tone={s.missingVoucher ? 'warn' : 'neutral'}>{s.label}</Badge></td>
          <td className="no-print"><span className="row">{r.voucher_no && <><button type="button" className="secondary sm" onClick={() => void pr(r, false)}>প্রিন্ট/PDF</button>
            <button type="button" className="secondary sm" onClick={() => void pr(r, true)}>ছবি</button></>}
            <Link className="btn-link small" to={`/app/accounts/daily/${r.session_id}?tab=expense`}>খাতা</Link></span></td></tr> })}
        {!rows.length && <tr><td colSpan={9} className="muted">{kind === 'missing' ? 'সব খরচে বিল/ভাউচারের ছবি আছে।' : 'এই সময়ে কিছু নেই।'}</td></tr>}</tbody></table></div>}
  </section>
}

// ---- history: who changed what, old → new ----
function History({ hubs, hub, setHub, from, to, setFrom }: { hubs: Array<{ id: string; name: string }>; hub: string; setHub: (h: string) => void; from: string; to: string; setFrom: (d: string) => void }) {
  const h = useLoad(() => (hub ? da.history(hub, from, to) : Promise.resolve([] as HistoryRow[])), [hub, from, to])
  const rows = h.data ?? []
  return <section className="panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>হিসাবের ইতিহাস</h2><span className="row"><LearnButton module="history" />
      <label className="ac-from small">শুরু <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} /></label></span></div>
    {hubs.length > 1 && <Field label="হাব"><select value={hub} onChange={e => setHub(e.target.value)}>{hubs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
    <p className="muted small">প্রতিটি তৈরি, বদল ও অনুমোদন — কে, কখন, আগের মান আর নতুন মান। এই তালিকা কেউ বদলাতে বা মুছতে পারেন না।</p>
    <ErrorNote error={h.error} />
    {h.loading && !h.data ? <p className="muted">লোড হচ্ছে…</p> : <ul className="ac-hist">{rows.map((x, i) => <li key={i}>
      <span className="when">{timeBn(x.at)}</span>
      <span className="what"><b>{x.by}</b> · {TABLE[x.table] ?? x.table} {ACTION[x.action] ?? x.action}
        {x.fields?.length ? <span className="diff">{x.fields.filter(f => f !== 'updated_at' && f !== 'updated_by').slice(0, 6).map(f =>
          <span key={f}><em>{FIELD[f] ?? f}</em> {show(x.old?.[f])} → <b>{show(x.new?.[f])}</b></span>)}</span>
          : x.new && 'amount' in x.new ? <span className="diff"><span><em>টাকা</em> <b>{show(x.new.amount)}</b></span></span> : null}</span></li>)}
      {!rows.length && <li className="muted">এই সময়ে কোনো বদল নেই।</li>}</ul>}
  </section>
}

// ---- নতুন ভাউচার: an expense line in today's khata of the hub, with its voucher, then the attachment ----
function NewVoucher({ cats, done }: { cats: Category[]; done: (msg: string) => void }) {
  const today = todayDhaka()
  const hubs = useLoad(() => da.myHubs(), [])
  const mine = (hubs.data ?? []).filter(h => h.can_submit)
  const blank = { hub: '', name: '', cat: '', amount: '', ref: '', staff: '', desc: '' }
  const [d, setD] = useState(blank)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [made, setMade] = useState<{ id: string; no: string; cat?: Category } | null>(null)
  const hub = d.hub || mine[0]?.hub_id || ''
  const cat = cats.find(c => c.code === d.cat)
  const amount = Number(d.amount.replace(/[০-৯]/g, x => String('০১২৩৪৫৬৭৮৯'.indexOf(x))).replace(/[^\d.]/g, '')) || 0
  const sort = sortExpense({ staffId: d.staff, hasVoucherFile: !!file })
  async function make() {
    setBusy(true); setErr(null)
    try {
      const { data } = await supabase.from('da_sessions').select('id').eq('hub_id', hub).eq('account_date', today).maybeSingle()
      const session = (data as { id: string } | null)?.id ?? await da.start(hub, today)
      const kind = d.staff.trim() ? 'employee' as const : 'transport' as const
      const base = { session, kind, employee: d.staff.trim() || null, name: d.name.trim(), category: d.cat, amount, date: today, remarks: d.desc.trim() || null }
      const line = await da.saveExpense(base)
      const no = await da.makeVoucher(line)
      if (d.ref.trim()) await da.setReference({ line, name: d.ref.trim() })
      if (file) { const path = await da.upload(session, file); await da.saveExpense({ ...base, path, line }) }
      setMade({ id: line, no, cat }); setD({ ...blank, hub: d.hub }); setFile(null); done(`ভাউচার ${no} তৈরি হয়েছে`)
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const pr = async (png: boolean) => { if (!made) return; try { const v = await da.voucher(made.id); if (png) await downloadVoucherPng(v, made.cat); else printVoucher(v, made.cat) } catch (e) { setErr(e) } }
  return <section className="panel ac-new">
    <div className="da-bar"><h2 style={{ margin: 0 }}>নতুন ভাউচার</h2><LearnButton module="voucher" /></div>
    <p className="muted small">ভাউচার সবসময় একটা খরচের সাথে যুক্ত — তাই এটা আজকের খাতার খরচেও উঠবে (খাতা খোলা না থাকলে নিজে খুলবে)। ভাউচার নম্বর সিস্টেম নিজে দেবে।</p>
    {made && <div className="ac-made"><Icon name="check" size={18} /><span>ভাউচার <b>{made.no}</b> তৈরি হয়েছে।</span>
      <button type="button" onClick={() => void pr(false)}><Icon name="print" size={15} />প্রিন্ট / পিডিএফ</button>
      <button type="button" className="secondary" onClick={() => void pr(true)}><Icon name="save" size={15} />ছবি নামান</button></div>}
    <div className="pr-grid">
      <Field label="ভাউচার নম্বর"><input value="সিস্টেম নিজে দেবে" disabled /></Field>
      <Field label="হাব" required><select value={hub} onChange={e => setD({ ...d, hub: e.target.value })}>{mine.map(h => <option key={h.hub_id} value={h.hub_id}>{h.name}</option>)}</select></Field>
      <Field label="তারিখ"><input value={dateBn(today)} disabled /></Field>
      <Field label="খরচের নাম" required><input value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="যেমন: ভ্যান ভাড়া (হাব থেকে ব্যাংক)" /></Field>
      <Field label="খাত" required hint={cat?.note_bn ?? undefined}><select value={d.cat} onChange={e => setD({ ...d, cat: e.target.value })}><option value="">— বাছুন —</option>
        {cats.map(c => <option key={c.code} value={c.code}>{c.bn} ({c.en})</option>)}</select></Field>
      <Field label="টাকা" required hint={cat?.site_limit && amount > cat.site_limit ? `এই খাতের সীমা ৳${cat.site_limit} — বিবরণে কারণ লিখুন` : undefined}><input inputMode="decimal" value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></Field>
      <Field label="রেফারেন্স"><input value={d.ref} onChange={e => setD({ ...d, ref: e.target.value })} placeholder="যার কথায় খরচ হলো" /></Field>
      <Field label="স্টাফ আইডি" hint="কর্মীর জন্য খরচ হলে — তখন এটা স্টাফ খরচ"><input inputMode="numeric" value={d.staff} onChange={e => setD({ ...d, staff: e.target.value })} /></Field>
      <Field label="বিবরণ" wide><input value={d.desc} onChange={e => setD({ ...d, desc: e.target.value })} placeholder="কেন বিল নেই, কোথা থেকে কোথায় ইত্যাদি" /></Field>
      <Field label="সংযুক্তি (সই করা ভাউচার/কাগজের ছবি বা পিডিএফ)"><input type="file" accept="image/png,image/jpeg,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>
    </div>
    <p className="pr-sort">সিস্টেম যেখানে রাখবে: <Badge tone={sort.missingVoucher ? 'warn' : 'ok'}>{sort.label}</Badge></p>
    <ErrorNote error={err} />
    <div className="row"><button type="button" disabled={busy || !hub || !d.name.trim() || !d.cat || amount <= 0} onClick={() => void make()}>
      <Icon name="check" size={16} />{busy ? 'হচ্ছে…' : 'ভাউচার বানান'}</button></div>
    <p className="muted small">ভাউচার একবার বানালে নম্বর বদলায় না। ভুল হলে খাতায় খরচের লাইন এডিট করুন — আগের মান ইতিহাসে থেকে যায়।</p>
  </section>
}
