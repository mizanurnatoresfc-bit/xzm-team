// The day's flow on a sheet: drafts -> submitted -> "accounts checked" -> main site report confirmed -> main sheet.
// FlowPanel sits at the top of a sheet, HubCollectorsCard in the settings, MainSheet is the page that puts everything together.
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { Icon } from '../../components/Icon'
import { collectorsNeeded, da, dateBn, num, taka, timeBn, type Category, type DaSettings, type Sheet } from '../../lib/dailyAccounts'
import { download, printArea, xlsxBlob } from '../../lib/xlsx'
import { AccountsShell, Badge, ErrorNote, Field, Modal, StatusBadge, useLoad, useToast } from './ui'

type Reload = (m?: string) => Promise<void>
const sumOf = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0)

function FileLink({ path, label = 'দেখুন' }: { path: string; label?: string }) {
  const [err, setErr] = useState(false)
  return <button type="button" className="link" onClick={() => void da.fileUrl(path).then(u => window.open(u, '_blank', 'noopener')).catch(() => setErr(true))}>{err ? 'খোলা যায়নি' : label}</button>
}

/** The lines of a sheet that belong to these people's khatas (null = everyone's). */
export function onlyOf(s: Sheet, users: Set<string> | null): Sheet {
  if (!users) return s
  const mine = <T extends { created_by?: string }>(rows: T[]) => rows.filter(r => !!r.created_by && users.has(r.created_by))
  return { ...s, riders: mine(s.riders), expenses: mine(s.expenses), merchant_payments: mine(s.merchant_payments) }
}

/** Top of the hub's sheet: the khatas handed in, Accept (several at once), then the daily sheet, the report and the bank. */
export function FlowPanel({ s, settings, reload, viewing, onView }: { s: Sheet; settings: DaSettings; reload: Reload; viewing?: string | null; onView?: (user: string | null) => void }) {
  const { session: me } = useAuth()
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [dlg, setDlg] = useState<null | 'check' | 'ok' | 'undo' | 'reopen'>(null)
  const [note, setNote] = useState('')
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const people = s.collectors ?? []
  const needed = collectorsNeeded(settings, s.hub.id)
  const submitted = people.filter(c => c.closed_at).length
  const accepted = people.filter(c => c.accepted_at)
  const left = people.filter(c => !c.accepted_at)
  const short = accepted.length < needed || left.length > 0
  const checked = !!s.session.closed_at
  const okd = !!s.session.report_ok_at
  const banked = !!s.session.bank_done_at
  const reports = s.report_ids ?? []
  const reportTotal = sumOf(reports, r => r.amount)
  const okUsers = new Set(accepted.map(c => c.user_id))
  const sheetTotal = checked ? Number(s.session.closed_totals?.rider_amount ?? 0) : sumOf(onlyOf(s, okUsers).riders, r => r.amount)
  const diff = reportTotal - sheetTotal
  const stale = okd && (Number(s.session.report_total ?? 0) !== reportTotal)
  const canWrite = s.can_edit
  const step = banked ? 5 : okd ? 4 : checked ? 3 : accepted.length > 0 ? 2 : 1
  const canMark = canWrite && !checked
  const markable = people.filter(c => c.closed_at && !c.accepted_at).map(c => c.user_id)
  const picked = [...marked].filter(u => markable.includes(u))

  async function run(key: string, f: () => Promise<unknown>, msg: string) {
    setBusy(key); setErr(null)
    try { await f(); setDlg(null); setNote(''); setMarked(new Set()); await reload(msg) } catch (e) { setErr(e) } finally { setBusy('') }
  }
  const open = (d: typeof dlg) => { setErr(null); setNote(''); setDlg(d) }
  const toggle = (u: string, on: boolean) => setMarked(m => { const n = new Set(m); if (on) n.add(u); else n.delete(u); return n })
  const goBank = () => document.querySelector<HTMLButtonElement>('.da-tabs button[data-tab="bank"]')?.click()
  const cls = (n: number) => (step > n ? 'done' : step === n ? 'on' : '')

  return <section className="panel fl no-print" id="da-flow">
    <ol className="fl-steps" aria-label="হিসাবের ধাপ">
      <li className={cls(1) || (step === 2 ? 'done' : '')}><i>{step > 1 ? '✓' : num(1)}</i><span><b>খাতা জমা ও গ্রহণ</b><small>জমা {num(submitted)} · Accept {num(accepted.length)} / {num(needed)}</small></span></li>
      <li className={checked ? 'done' : step === 2 ? 'on' : ''}><i>{checked ? '✓' : num(2)}</i><span><b>ডেইলি হিসাবের খাতা</b><small>{checked ? `খোলা হয়েছে · ${timeBn(s.session.closed_at)}` : 'Accept করা খাতার যোগফল'}</small></span></li>
      <li className={okd ? 'done' : step === 3 ? 'on' : ''}><i>{okd ? '✓' : num(3)}</i><span><b>মেইন সাইটের রিপোর্ট ওকে</b><small>{okd ? `ওকে · ${s.session.report_ok_by_name ?? ''}` : reports.length ? `${num(reports.length)}টি রিপোর্ট আইডি · ${taka(reportTotal)}` : 'রিপোর্ট আইডি ও টাকা'}</small></span></li>
      <li className={banked ? 'done' : step === 4 ? 'on' : ''}><i>{banked ? '✓' : num(4)}</i><span><b>ব্যাংকে জমা — ক্লোজ</b><small>{banked ? `ক্লোজ হয়েছে · ${timeBn(s.session.bank_done_at)}` : `${num((s.deposits ?? []).length)}টি ডিপোজিট`}</small></span></li>
    </ol>

    <div className="da-bar"><h2 style={{ margin: 0 }}>জমা পড়া খাতা</h2>
      {canMark && markable.length > 1 && <button type="button" className="link small" onClick={() => setMarked(new Set(picked.length === markable.length ? [] : markable))}>{picked.length === markable.length ? 'মার্ক তুলুন' : 'সব মার্ক করুন'}</button>}</div>
    <div className="nv-rows fl-people">
      {people.map(c => { const st = c.accepted_at ? 'acc' : c.closed_at ? 'sub' : 'draft'; return <div key={c.user_id} className={`nv-row${viewing === c.user_id ? ' viewing' : ''}`}>
        {canMark && <input type="checkbox" className="fl-mark" aria-label={`${c.name ?? ''} — মার্ক`} disabled={st !== 'sub'} checked={st === 'sub' && marked.has(c.user_id)} onChange={e => toggle(c.user_id, e.target.checked)} />}
        <span className="nv-av">{(c.name ?? '?').slice(0, 1)}</span>
        <span className="tx"><b>{c.name ?? '—'}{c.user_id === me?.user.id ? ' (আপনি)' : ''}</b>
          <span>{c.code ? `আইডি ${c.code} · ` : ''}{num(c.riders)} রাইডার · {taka(c.amount)} · খরচ {taka(c.expense_amount ?? 0)} · পেমেন্ট {taka(c.payment_amount ?? 0)}</span>
          <span className="who">{c.accepted_at ? `Accept ${timeBn(c.accepted_at)} · ${c.accepted_by_name ?? ''}` : c.closed_at ? `সাবমিট ${timeBn(c.closed_at)}${c.closed_by_name && c.closed_by && c.closed_by !== c.user_id ? ` · দিয়েছেন ${c.closed_by_name}` : ''}` : 'এখনো লিখছেন'}</span></span>
        <span className="end">{st === 'acc' ? <Badge tone="ok">গ্রহণ হয়েছে</Badge> : st === 'sub' ? <Badge tone="info">জমা পড়েছে</Badge> : <Badge tone="warn">ড্রাফট</Badge>}
          <span className="row-acts">
            {onView && <button type="button" className="link small" onClick={() => onView(viewing === c.user_id ? null : c.user_id)}>{viewing === c.user_id ? 'সব দেখুন' : 'চেক করুন'}</button>}
            {canMark && st === 'sub' && <button type="button" className="sm" disabled={!!busy} onClick={() => void run(c.user_id, () => da.acceptParts(s.session.id, [c.user_id]), `${c.name ?? ''} — গ্রহণ হয়েছে`)}>Accept</button>}
            {canMark && st === 'acc' && <button type="button" className="link small" disabled={!!busy} onClick={() => void run(c.user_id, () => da.acceptParts(s.session.id, [c.user_id], false), 'গ্রহণ ফিরিয়ে নেওয়া হলো')}>ফিরিয়ে নিন</button>}
            {canMark && st === 'draft' && <button type="button" className="link small" disabled={!!busy} onClick={() => void run(c.user_id, () => da.closePartFor(s.session.id, c.user_id, true), `${c.name ?? ''} — সাবমিট হয়েছে`)}>সাবমিট করে দিন</button>}
          </span></span>
      </div> })}
      {people.length === 0 && <p className="nv-none">এখনো কোনো খাতা নেই। কেউ “আজকের হিসাব খাতা”-য় একটি লাইন লিখলেই তাঁর খাতা এখানে দেখাবে।</p>}
    </div>
    {people.length < needed && people.length > 0 && <p className="muted small" style={{ margin: 0 }}>এই হাবে {num(needed)} জনের হিসাব নেওয়ার কথা; এখন পর্যন্ত খাতা আছে {num(people.length)} জনের।</p>}

    {stale && <p className="notice">ওকে দেওয়ার পর রিপোর্ট আইডির টাকা বদলেছে — আবার মিলিয়ে ওকে দিন।</p>}
    {checked && s.session.check_note && <p className="muted small" style={{ margin: 0 }}>ডেইলি খাতায় ধরা হয়েছে {num(s.session.check_done ?? 0)} / {num(s.session.check_needed ?? 0)} খাতা{s.session.check_left ? ` · বাদ: ${s.session.check_left}` : ''} — কারণ: “{s.session.check_note}”</p>}
    {okd && Number(s.session.report_diff) !== 0 && <p className="muted small" style={{ margin: 0 }}>রিপোর্টের সাথে পার্থক্য {taka(s.session.report_diff)} — কারণ: “{s.session.report_note}”</p>}
    <ErrorNote error={dlg ? null : err} />

    <div className="fl-acts">
      {canMark && picked.length > 0 && <button type="button" disabled={!!busy} onClick={() => void run('many', () => da.acceptParts(s.session.id, picked), `${num(picked.length)}টি খাতা গ্রহণ হয়েছে`)}><Icon name="check" size={16} /> মার্ক করা {num(picked.length)}টি Accept করুন</button>}
      {!checked && canWrite && <button type="button" className={picked.length ? 'secondary' : ''} disabled={accepted.length === 0} title={accepted.length === 0 ? 'আগে অন্তত একটি খাতা গ্রহণ করুন' : undefined} onClick={() => open('check')}><Icon name="ledger" size={16} /> ডেইলি হিসাবের খাতা খুলুন</button>}
      {checked && <Link className="btn" to={`/app/accounts/daily/${s.session.id}/main`}><Icon name="ledger" size={16} /> ডেইলি হিসাবের খাতা দেখুন</Link>}
      {checked && !okd && <><button type="button" className="secondary" onClick={goBank}>＋ রিপোর্ট আইডি বসান</button>
        <button type="button" className="secondary" disabled={!reports.length} onClick={() => open('ok')}>রিপোর্ট মিলিয়ে ওকে দিন</button></>}
      {checked && !banked && <button type="button" className="secondary" onClick={goBank}>ব্যাংকে জমা দিয়ে ক্লোজ করুন</button>}
      {okd && s.session.status !== 'approved' && <button type="button" className="link small" onClick={() => open('undo')}>রিপোর্টের ওকে ফিরিয়ে নিন</button>}
      {checked && canWrite && !okd && <button type="button" className="link small" onClick={() => open('reopen')}>ডেইলি খাতা ফিরিয়ে নিন</button>}
    </div>

    {dlg === 'check' && <Modal title="ডেইলি হিসাবের খাতা খুলবেন?" onClose={() => setDlg(null)}
      actions={<><button className="secondary" onClick={() => setDlg(null)}>বাতিল</button>
        <button disabled={!!busy || (short && !note.trim())} onClick={() => void run('check', () => da.check(s.session.id, note), 'ডেইলি হিসাবের খাতা খোলা হয়েছে')}>{busy ? 'হচ্ছে…' : 'খুলুন'}</button></>}>
      <p>গ্রহণ করা খাতাগুলোর যোগফল নিয়ে আজকের ডেইলি হিসাবের খাতা তৈরি হবে। এরপর রিপোর্ট মিলিয়ে ব্যাংকে জমা দিলে দিনের হিসাব ক্লোজ হবে।</p>
      <div className="da-table-wrap"><table className="da-table da-close"><tbody>
        {accepted.map(c => <tr key={c.user_id}><td>{c.name ?? '—'}<span className="sec">{num(c.riders)} রাইডার · খরচ {taka(c.expense_amount ?? 0)} · পেমেন্ট {taka(c.payment_amount ?? 0)}</span></td><td className="r">{taka(c.amount)}</td></tr>)}</tbody>
        <tfoot><tr><td><b>যোগফল ({num(accepted.length)}টি খাতা)</b></td><td className="r"><b>{taka(sumOf(accepted, c => c.amount))}</b></td></tr></tfoot></table></div>
      {short && <><p className="notice">{left.length > 0 ? `যোগফলে ধরা হচ্ছে না: ${left.map(c => c.name ?? '—').join(', ')}। ` : ''}এই হাবে {num(needed)} জনের খাতা লাগে, Accept হয়েছে {num(accepted.length)} জনের। কারণ লিখলে তবেই খোলা যাবে।</p>
        <Field label="কারণ *"><input value={note} onChange={e => setNote(e.target.value)} placeholder="যেমন: একজন ছুটিতে" /></Field></>}
      <ErrorNote error={err} />
    </Modal>}
    {dlg === 'ok' && <Modal title="মেইন সাইটের রিপোর্ট ওকে" onClose={() => setDlg(null)}
      actions={<><button className="secondary" onClick={() => setDlg(null)}>বাতিল</button>
        <button disabled={!!busy || (diff !== 0 && !note.trim())} onClick={() => void run('ok', () => da.reportOk(s.session.id, note), 'রিপোর্ট ওকে হয়েছে')}>{busy ? 'হচ্ছে…' : 'ওকে দিন'}</button></>}>
      <div className="da-table-wrap"><table className="da-table da-close"><tbody>
        {reports.map(r => <tr key={r.id}><td>রিপোর্ট আইডি <b>{r.report_no}</b></td><td className="r">{taka(r.amount)}</td></tr>)}
        <tr><td><b>রিপোর্টের মোট</b></td><td className="r"><b>{taka(reportTotal)}</b></td></tr>
        <tr><td>ডেইলি খাতার মোট টাকা</td><td className="r">{taka(sheetTotal)}</td></tr></tbody>
        <tfoot><tr><td><b>পার্থক্য</b></td><td className="r"><b className={diff !== 0 ? 'bad' : ''}>{diff === 0 ? 'মিলেছে ✓' : taka(diff)}</b></td></tr></tfoot></table></div>
      {diff !== 0 && <><p className="notice">রিপোর্ট আর খাতার টাকা মিলছে না। কারণ লিখলে তবেই ওকে হবে — পার্থক্য ও কারণ ডেইলি খাতায় ছাপা থাকবে।</p>
        <Field label="কারণ *"><input value={note} onChange={e => setNote(e.target.value)} placeholder="যেমন: একটি পার্সেল পরের রিপোর্টে গেছে" /></Field></>}
      <ErrorNote error={err} />
    </Modal>}
    {(dlg === 'undo' || dlg === 'reopen') && <Modal title={dlg === 'undo' ? 'রিপোর্টের ওকে ফিরিয়ে নেবেন?' : 'ডেইলি হিসাবের খাতা ফিরিয়ে নেবেন?'} onClose={() => setDlg(null)}
      actions={<><button className="secondary" onClick={() => setDlg(null)}>বাতিল</button>
        <button disabled={!!busy || !note.trim()} onClick={() => void run('undo', () => dlg === 'undo' ? da.reportOkUndo(s.session.id, note) : da.reopenDay(s.session.id, note), 'ফিরিয়ে নেওয়া হলো')}>{busy ? 'হচ্ছে…' : 'ফিরিয়ে নিন'}</button></>}>
      <p className="muted">{dlg === 'undo' ? 'ঠিক করে আবার ওকে দিতে হবে।' : 'ধরে রাখা যোগফল বাদ যাবে; খাতা ঠিক করে আবার খুলতে হবে।'}</p>
      <Field label="কারণ *"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
      <ErrorNote error={err} />
    </Modal>}
  </section>
}

/** Settings: how many people take the accounts at each hub. */
export function HubCollectorsCard({ settings, onSaved }: { settings: DaSettings; onSaved: (m: string) => Promise<void> | void }) {
  const hubs = useLoad(() => da.myHubs(), [])
  const [def, setDef] = useState(String(settings['da.collectors_default'] ?? 1))
  const [own, setOwn] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(settings['da.hub_collectors'] ?? {}).map(([k, v]) => [k, String(v)])))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const saved = settings['da.hub_collectors'] ?? {}
  async function save() {
    setBusy(true); setErr(null)
    try {
      const d = Math.round(Number(def))
      if (!(d >= 1 && d <= 50)) throw new Error('সাধারণ সংখ্যাটি ১ থেকে ৫০-এর মধ্যে দিন')
      if (d !== Number(settings['da.collectors_default'] ?? 1)) await da.configure('da.collectors_default', d)
      for (const h of hubs.data ?? []) {
        const v = (own[h.hub_id] ?? '').trim()
        const n = v === '' ? null : Math.round(Number(v))
        if (n !== null && !(n >= 1 && n <= 50)) throw new Error(`${h.name}: সংখ্যাটি ১ থেকে ৫০-এর মধ্যে দিন`)
        if ((saved[h.hub_id] ?? null) !== n) await da.setHubCollectors(h.hub_id, n)
      }
      await onSaved('সংরক্ষিত')
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <section className="panel" id="da-set-collectors"><h2>হাব অনুযায়ী কতজন হিসাব নেবেন</h2>
    <p className="muted small">প্রত্যেকে খাতায় নিজের অংশ লেখেন (ড্রাফট) ও সাবমিট করেন। এই সংখ্যক সাবমিট না হলে “হিসাব চেক”-এর সময় কারণ লিখতে হয়।</p>
    <Field label="সাধারণ সংখ্যা (যে হাবে আলাদা করে দেওয়া নেই)"><input type="number" inputMode="numeric" min={1} max={50} value={def} onChange={e => setDef(e.target.value)} style={{ maxWidth: 120 }} /></Field>
    <div className="nv-rows" style={{ marginTop: 10 }}>{(hubs.data ?? []).map(h => <label key={h.hub_id} className="nv-row">
      <span className="nv-av">{h.name.slice(0, 1)}</span>
      <span className="tx"><b>{h.name}</b><span>{h.zone_name}{own[h.hub_id]?.trim() ? '' : ` · সাধারণ সংখ্যা (${num(Number(def) || 1)}) চলবে`}</span></span>
      <span className="end"><input type="number" inputMode="numeric" min={1} max={50} placeholder={def} aria-label={`${h.name} — কতজন`} value={own[h.hub_id] ?? ''} onChange={e => setOwn({ ...own, [h.hub_id]: e.target.value })} style={{ width: 84, textAlign: 'center' }} /></span>
    </label>)}
      {hubs.loading && <p className="nv-none">লোড হচ্ছে…</p>}</div>
    <ErrorNote error={err ?? hubs.error} />
    <button type="button" disabled={busy} onClick={() => void save()} style={{ marginTop: 10 }}>{busy ? 'সেভ হচ্ছে…' : 'সেভ'}</button>
  </section>
}

// ------------------------------------------------------------------ the main sheet
/** Everything of the day on one page: the accounts top sheet, expenses, payments, deposits and their documents. */
export function MainSheet() {
  const { id = '' } = useParams()
  const sheet = useLoad(() => da.sheet(id), [id])
  const settings = useLoad(() => da.settings(), [])
  const { node } = useToast()
  const raw = sheet.data
  // the daily sheet adds up the accepted khatas only
  // (a sheet opened before "Accept" existed has no accepted khata: everything on it counts, as it did then)
  const s = useMemo(() => { if (!raw) return null; const ok = (raw.collectors ?? []).filter(c => c.accepted_at).map(c => c.user_id); return ok.length ? onlyOf(raw, new Set(ok)) : raw }, [raw])
  const cats = useMemo(() => new Map(((settings.data?.['da.expense_categories'] ?? []) as Category[]).map(c => [c.code, c.bn || c.en])), [settings.data])

  if (sheet.error) return <AccountsShell title="ডেইলি হিসাবের খাতা"><ErrorNote error={sheet.error} /><Link to="/app/accounts/daily">← তালিকায় ফিরুন</Link></AccountsShell>
  if (!s) return <AccountsShell title="ডেইলি হিসাবের খাতা"><p className="muted">লোড হচ্ছে…</p></AccountsShell>
  const se = s.session
  const back = <Link className="btn-ghost" to={`/app/accounts/daily/${se.id}`}>← খাতায় ফিরুন</Link>
  if (!se.closed_at) return <AccountsShell title={`ডেইলি হিসাবের খাতা · ${s.hub.name}`} subtitle={dateBn(se.account_date)} actions={back}>
    <div className="nv-empty"><Icon name="ledger" size={36} /><p><b>ডেইলি হিসাবের খাতা এখনো খোলা হয়নি</b></p>
      <p>হাবের খাতায় জমা পড়া খাতাগুলো চেক করে গ্রহণ করুন, তারপর “ডেইলি হিসাবের খাতা খুলুন” চাপুন।</p>{back}</div>
  </AccountsShell>

  const t = se.closed_totals
  const rider = Number(t?.rider_amount ?? sumOf(s.riders, r => r.amount))
  const collected = Number(t?.collected ?? sumOf(s.riders, r => r.paid_amount))
  const due = Number(t?.due ?? sumOf(s.riders, r => r.due))
  const mb = Number(t?.mobile_banking ?? sumOf(s.riders, r => r.mobile_banking))
  const pay = sumOf(s.merchant_payments, m => m.amount)
  const exp = sumOf(s.expenses, x => x.amount)
  const deposits = s.deposits ?? []
  const dep = sumOf(deposits, d => d.amount)
  const charges = sumOf(deposits, d => (d.charge || 0) + (d.transport || 0))
  const inHand = collected - pay - exp
  const reports = s.report_ids ?? []
  const repTotal = sumOf(reports, r => r.amount)
  const docs: Array<{ what: string; path: string }> = [
    ...s.expenses.flatMap(x => (x.attachment_path || x.claim_file) ? [{ what: `খরচ · ${x.expense_name} · ${taka(x.amount)}`, path: (x.attachment_path || x.claim_file)! }] : []),
    ...s.merchant_payments.flatMap(m => m.screenshot_path ? [{ what: `পেমেন্ট · ${m.payment_ref ?? m.merchant_name} · ${taka(m.amount)}`, path: m.screenshot_path }] : []),
    ...deposits.flatMap(d => d.slip_path ? [{ what: `ডিপোজিট স্লিপ · ${d.bank_name ?? d.method} · ${taka(d.amount)}`, path: d.slip_path }] : [])]
  const top: Array<[string, number | string, string?]> = [
    ['রাইডারদের মোট টাকা', rider, `${num(s.riders.length)} লাইন`], ['জমা দিয়েছেন (ক্যাশ)', collected], ['বকেয়া', due], ['মোবাইল ব্যাংকিং', mb],
    ['মার্চেন্ট ক্যাশ পেমেন্ট', pay, `${num(s.merchant_payments.length)}টি`], ['মোট খরচ', exp, `${num(s.expenses.length)}টি`], ['হাতে থাকার কথা', inHand, 'জমা − পেমেন্ট − খরচ'],
    ['ব্যাংক / ওয়ালেটে জমা', dep, `${num(deposits.length)}টি`], ['ব্যাংক চার্জ ও যাতায়াত', charges]]
  const title = `Daily-sheet-${s.hub.code}-${se.account_date}`
  const sh = s
  function excel() {
    const rows: Array<Array<string | number>> = [
      ['টপ শীট', '', ''], ...top.map(([l, v, n]) => [l, typeof v === 'number' ? v : String(v), n ?? '']),
      ['মেইন সাইটের রিপোর্ট', '', ''], ...reports.map(r => [`রিপোর্ট আইডি ${r.report_no}`, r.amount, r.remarks ?? '']),
      ['রিপোর্টের মোট', repTotal, ''], ['খাতার সাথে পার্থক্য', repTotal - rider, se.report_note ?? ''],
      ['খরচ', '', ''], ...sh.expenses.map(x => [`${x.expense_name} (${cats.get(x.category) ?? x.category})`, x.amount, [x.employee_name, x.bill_no, x.voucher_no, x.reference_no].filter(Boolean).join(' · ')]),
      ['পেমেন্ট', '', ''], ...sh.merchant_payments.map(m => [`${m.merchant_name} ${m.payment_ref ?? ''}`.trim(), m.amount, m.transaction_id ?? '']),
      ['ব্যাংক ডিপোজিট', '', ''], ...deposits.map(d => [`${d.bank_name ?? d.method} ${d.ref_no ?? ''}`.trim(), d.amount, `চার্জ ${d.charge} · যাতায়াত ${d.transport}`])]
    download(xlsxBlob(`XZM TEAM — ডেইলি হিসাবের খাতা · ${sh.hub.name}`, `${se.account_date} · হিসাব নং ${se.no}`, ['বিবরণ', 'টাকা', 'নোট'], rows), `${title}.xlsx`)
  }

  return <AccountsShell title={`ডেইলি হিসাবের খাতা · ${s.hub.name}`} subtitle={`${dateBn(se.account_date)} · হিসাব নং ${num(se.no)}`}
    actions={<>{back}<button className="secondary" onClick={excel}>Excel</button><button onClick={() => printArea(title)}>প্রিন্ট / পিডিএফ</button></>}>
    {node}
    <div className="nv ms print-area">
      <section className="nv-hero">
        <div className="nv-hero-main"><span className="lbl">{s.hub.name} · {dateBn(se.account_date)}</span>
          <b className="big">{taka(rider)}</b>
          <span className="sub">{num(Number(t?.khatas ?? (s.collectors ?? []).filter(c => c.accepted_at).length))}টি খাতার যোগফল · খোলা হয়েছে {timeBn(se.closed_at)}</span>
          <span className="sub">{se.report_ok_at ? `রিপোর্ট ওকে · ${se.report_ok_by_name ?? ''}${Number(se.report_diff) !== 0 ? ` · পার্থক্য ${taka(se.report_diff)}` : ' · মিলেছে'}` : 'রিপোর্ট ওকে বাকি'} · {se.bank_done_at ? `ব্যাংকে জমা দিয়ে ক্লোজ ${timeBn(se.bank_done_at)}` : 'ব্যাংকে জমা বাকি — দিন এখনো ক্লোজ হয়নি'}</span>
          <span><StatusBadge status={se.status} /></span></div>
        <div className="nv-nums"><div><b>{taka(collected)}</b><span>জমা (ক্যাশ)</span></div><div className={due > 0 ? 'warn' : ''}><b>{taka(due)}</b><span>বকেয়া</span></div>
          <div><b>{taka(exp)}</b><span>খরচ</span></div><div><b>{taka(pay)}</b><span>পেমেন্ট</span></div></div>
      </section>

      <section className="panel"><h2>একাউন্টস টপ শীট</h2>
        <div className="da-table-wrap"><table className="da-table da-close"><tbody>
          {top.map(([l, v, n]) => <tr key={l} className={l === 'হাতে থাকার কথা' ? 'ms-strong' : ''}><td>{l}{n ? <span className="sec">{n}</span> : null}</td><td className="r">{typeof v === 'number' ? taka(v) : v}</td></tr>)}</tbody></table></div></section>

      <section className="panel"><h2>মেইন সাইটের ডেইলি রিপোর্ট</h2>
        <div className="da-table-wrap"><table className="da-table da-close"><tbody>
          {reports.map(r => <tr key={r.id}><td>রিপোর্ট আইডি <b>{r.report_no}</b>{r.remarks ? <span className="sec">{r.remarks}</span> : null}</td><td className="r">{taka(r.amount)}</td></tr>)}
          {reports.length === 0 && <tr><td colSpan={2} className="muted">রিপোর্ট আইডি এখনো বসানো হয়নি।</td></tr>}
          <tr><td><b>রিপোর্টের মোট</b></td><td className="r"><b>{taka(repTotal)}</b></td></tr>
          <tr><td>খাতার মোট টাকা</td><td className="r">{taka(rider)}</td></tr></tbody>
          <tfoot><tr><td><b>পার্থক্য</b>{se.report_note ? <span className="sec">কারণ: {se.report_note}</span> : !se.report_ok_at ? <span className="sec">এখনো ওকে দেওয়া হয়নি</span> : null}</td>
            <td className="r"><b className={repTotal - rider !== 0 ? 'bad' : ''}>{repTotal - rider === 0 ? 'মিলেছে ✓' : taka(repTotal - rider)}</b></td></tr></tfoot></table></div></section>

      <section className="panel"><h2>যে খাতাগুলোর যোগফল</h2>
        <div className="nv-rows">{(s.collectors ?? []).map(c => <div key={c.user_id} className="nv-row"><span className="nv-av">{(c.name ?? '?').slice(0, 1)}</span>
          <span className="tx"><b>{c.name ?? '—'}</b><span>{c.code ? `আইডি ${c.code} · ` : ''}{num(c.riders)} রাইডার · {num(c.payments)} পেমেন্ট · {num(c.expenses)} খরচ</span>
            <span className="who">{c.accepted_at ? `Accept ${timeBn(c.accepted_at)} · ${c.accepted_by_name ?? ''}` : <em>যোগফলে ধরা হয়নি{c.closed_at ? ' (Accept হয়নি)' : ' (সাবমিট হয়নি)'}</em>}</span></span>
          <span className="end"><b>{c.accepted_at ? taka(c.amount) : '—'}</b></span></div>)}</div>
        {se.check_note && <p className="muted small">ধরা হয়েছে {num(se.check_done ?? 0)} / {num(se.check_needed ?? 0)} খাতা{se.check_left ? ` · বাদ: ${se.check_left}` : ''} — কারণ: “{se.check_note}”</p>}</section>

      <section className="panel"><h2>খরচ <span className="muted small">{num(s.expenses.length)}টি · {taka(exp)}</span></h2>
        <div className="nv-rows">{s.expenses.map(x => <div key={x.id} className="nv-row"><span className="nv-av">{x.kind === 'transport' ? '🛵' : '👤'}</span>
          <span className="tx"><b>{x.expense_name}</b><span>{cats.get(x.category) ?? x.category}{x.employee_name ? ` · ${x.employee_name}` : ''}{x.paid_by_name ? ` · দিয়েছেন ${x.paid_by_name}` : ''}</span>
            <span className="who">{[x.bill_no && `বিল ${x.bill_no}`, x.voucher_no && `ভাউচার ${x.voucher_no}`, x.reference_no].filter(Boolean).join(' · ')}{(x.attachment_path || x.claim_file) ? <> · <FileLink path={(x.attachment_path || x.claim_file)!} label="বিল দেখুন" /></> : <em> · বিলের ফাইল নেই</em>}</span></span>
          <span className="end"><b>{taka(x.amount)}</b></span></div>)}
          {s.expenses.length === 0 && <p className="nv-none">কোনো খরচ নেই।</p>}</div></section>

      <section className="panel"><h2>পেমেন্ট <span className="muted small">{num(s.merchant_payments.length)}টি · {taka(pay)}</span></h2>
        <div className="nv-rows">{s.merchant_payments.map(m => <div key={m.id} className="nv-row"><span className="nv-av">৳</span>
          <span className="tx"><b>{m.merchant_id || m.payee_name ? m.merchant_name : (m.payment_ref ?? '—')}</b><span>{[m.payment_ref, m.transaction_id, dateBn(m.payment_date)].filter(Boolean).join(' · ')}</span>
            <span className="who">{m.match_status === 'matched' ? 'রেকর্ডের সাথে মিলেছে' : m.match_status === 'mismatch' ? 'রেকর্ডের সাথে অমিল' : 'রেকর্ড নেই'}{m.screenshot_path ? <> · <FileLink path={m.screenshot_path} label="স্ক্রিনশট দেখুন" /></> : null}</span></span>
          <span className="end"><b>{taka(m.amount)}</b></span></div>)}
          {s.merchant_payments.length === 0 && <p className="nv-none">কোনো পেমেন্ট নেই।</p>}</div></section>

      <section className="panel"><h2>ব্যাংক ডিপোজিট <span className="muted small">{num(deposits.length)}টি · {taka(dep)}</span></h2>
        <div className="nv-rows">{deposits.map(d => <div key={d.id} className="nv-row"><span className="nv-av">🏦</span>
          <span className="tx"><b>{d.bank_name ?? d.method}</b><span>{[d.ref_no, dateBn(d.deposited_on), d.people].filter(Boolean).join(' · ')}</span>
            <span className="who">চার্জ {taka(d.charge)} · যাতায়াত {taka(d.transport)}{d.slip_path ? <> · <FileLink path={d.slip_path} label="স্লিপ দেখুন" /></> : <em> · স্লিপ নেই</em>}</span></span>
          <span className="end"><b>{taka(d.amount)}</b></span></div>)}
          {deposits.length === 0 && <p className="nv-none">কোনো ডিপোজিট নেই।</p>}</div></section>

      <section className="panel no-print"><h2>সব ডকুমেন্ট <span className="muted small">{num(docs.length)}টি</span></h2>
        <div className="nv-rows">{docs.map((d, i) => <div key={i} className="nv-row"><span className="nv-av">📎</span><span className="tx"><b>{d.what}</b></span><span className="end"><FileLink path={d.path} label="খুলুন ›" /></span></div>)}
          {docs.length === 0 && <p className="nv-none">কোনো ফাইল জমা নেই।</p>}</div></section>
    </div>
  </AccountsShell>
}
