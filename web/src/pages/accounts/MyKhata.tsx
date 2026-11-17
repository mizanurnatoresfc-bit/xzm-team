// আজকের হিসাব খাতা — the khata of the person taking the accounts: riders (pickup, delivery, money),
// expenses and cash payments they wrote themselves, then Submit. Accepting happens on the hub's page.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { Icon } from '../../components/Icon'
import { Combo } from '../../components/inputs'
import { RiderInbox } from '../../components/RiderQuick'
import { LearnButton } from '../../components/Learn'
import { da, dateBn, num, taka, timeBn, todayDhaka, type Template } from '../../lib/dailyAccounts'
import { ExpenseTab, MerchantTab, RidersTab, type LS } from './DailySheet'
import { onlyOf } from './sheetFlow'
import { AccountsShell, Badge, ErrorNote, useLoad, useToast } from './ui'

const HUB_KEY = 'xzm_khata_hub'
type Tab = 'riders' | 'expense' | 'payment'

export function MyKhata() {
  const { session: me } = useAuth()
  const uid = me?.user.id ?? ''
  const today = todayDhaka()
  const { toast, node } = useToast()
  const hubs = useLoad(() => da.myHubs(), [])
  const mine = (hubs.data ?? []).filter(h => h.can_submit)
  const [picked, setPicked] = useState(() => { try { return localStorage.getItem(HUB_KEY) ?? '' } catch { return '' } })
  const hub = mine.some(h => h.hub_id === picked) ? picked : mine[0]?.hub_id ?? ''
  const list = useLoad(() => (hub ? da.list(today, today, hub) : Promise.resolve([])), [hub, today])
  const sid = list.data?.[0]?.id ?? null
  const sheet = useLoad(() => (sid ? da.sheet(sid) : Promise.resolve(null)), [sid])
  const settings = useLoad(() => da.settings(), [])
  const templates = useLoad(() => da.templates().catch(() => [] as Template[]), [])
  const [tab, setTab] = useState<Tab>('riders')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const choose = (h: string) => { setPicked(h); try { localStorage.setItem(HUB_KEY, h) } catch { /* private window */ } }

  const s = sheet.data
  const st = settings.data
  const part = s?.collectors?.find(c => c.user_id === uid)
  const submitted = !!part?.closed_at
  const accepted = !!part?.accepted_at
  const my = s ? { ...onlyOf(s, new Set([uid])), can_edit: s.can_edit && !submitted } : null
  const reload = async (msg?: string) => { await sheet.reload(); if (msg) toast(msg) }
  const layoutSaved: LS = async msg => { await settings.reload(); await sheet.reload(); toast(msg) }
  const total = (my?.riders ?? []).reduce((a, r) => a + Number(r.amount), 0)
  const exp = (my?.expenses ?? []).reduce((a, x) => a + Number(x.amount), 0)
  const pay = (my?.merchant_payments ?? []).reduce((a, m) => a + Number(m.amount), 0)
  const lines = (my?.riders.length ?? 0) + (my?.expenses.length ?? 0) + (my?.merchant_payments.length ?? 0)

  async function run(f: () => Promise<unknown>, msg: string, after?: () => Promise<unknown>) {
    setBusy(true); setErr(null)
    try { await f(); if (after) await after(); await reload(msg) } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const hubName = mine.find(h => h.hub_id === hub)?.name ?? ''
  const loading = hubs.loading || (!!hub && list.loading && !list.data) || (!!sid && sheet.loading && !s) || !st
  const tabs: Array<[Tab, string, number]> = [['riders', 'রাইডার', my?.riders.length ?? 0], ['expense', 'এক্সপেন্স', my?.expenses.length ?? 0], ['payment', 'ক্যাশ পেমেন্ট', my?.merchant_payments.length ?? 0]]

  return <AccountsShell title="আজকের হিসাব খাতা" subtitle={`${hubName ? `${hubName} · ` : ''}${dateBn(today)}`}
    actions={<Link className="btn-ghost nv-wide-only" to="/app/accounts/daily">হাবের হিসাব খাতা →</Link>}>
    {node}
    <div className="nv nv-sheet kh">
      {mine.length > 1 && <div className="nv-chips no-print"><span className="nv-hub" style={{ minWidth: 220 }}><Combo value={hub} onChange={v => v && choose(v)} clearable={false} label="হাব" options={mine.map(h => ({ value: h.hub_id, label: h.name, sub: h.zone_name }))} /></span></div>}
      <ErrorNote error={hubs.error || list.error || sheet.error || settings.error || err} />
      {!hubs.loading && mine.length === 0 && <div className="nv-empty"><Icon name="ledger" size={34} /><p>আপনাকে কোনো হাবের হিসাব নেওয়ার দায়িত্ব দেওয়া হয়নি।</p></div>}
      {loading && mine.length > 0 && <p className="muted">লোড হচ্ছে…</p>}

      {!loading && hub && !sid && <div className="nv-empty"><Icon name="ledger" size={34} /><p><b>আজ এই হাবে এখনো হিসাব শুরু হয়নি</b></p>
        <p>খাতা খুললে রাইডারের হিসাব, এক্সপেন্স আর ক্যাশ পেমেন্ট লিখতে পারবেন।</p>
        <button type="button" disabled={busy} onClick={() => void run(() => da.start(hub, today), 'আজকের খাতা খোলা হয়েছে', () => list.reload())}><Icon name="plus" size={16} /> আজকের খাতা খুলুন</button></div>}

      {s && my && st && <>
        <section className="nv-hero">
          <div className="nv-hero-main"><span className="lbl">আমার খাতা · {s.hub.name}</span>
            <b className="big">{taka(total)}</b>
            <span className="sub">{num(my.riders.length)} রাইডার · {num(my.riders.reduce((a, r) => a + r.delivery_qty, 0))} ডেলিভারি · {num(my.riders.reduce((a, r) => a + r.pickup_qty, 0))} পিকআপ</span>
            <span>{accepted ? <Badge tone="ok">Accept হয়েছে · {part?.accepted_by_name ?? ''}</Badge> : submitted ? <Badge tone="info">জমা পড়েছে — গ্রহণের অপেক্ষায়</Badge> : <Badge tone="warn">ড্রাফট — এখনো সাবমিট হয়নি</Badge>}</span></div>
          <div className="nv-nums"><div><b>{taka(my.riders.reduce((a, r) => a + Number(r.paid_amount), 0))}</b><span>জমা (ক্যাশ)</span></div>
            <div className={my.riders.some(r => r.due > 0) ? 'warn' : ''}><b>{taka(my.riders.reduce((a, r) => a + Number(r.due), 0))}</b><span>বকেয়া</span></div>
            <div><b>{taka(exp)}</b><span>এক্সপেন্স</span></div><div><b>{taka(pay)}</b><span>ক্যাশ পেমেন্ট</span></div></div>
        </section>
        {s.session.closed_at && !accepted && <p className="notice">এই হাবের ডেইলি হিসাবের খাতা আজ খোলা হয়ে গেছে। এখন যা লিখবেন তা যোগফলে ধরতে হলে ম্যানেজারকে খাতাটি আবার খুলতে হবে।</p>}
        {(s.session.status === 'submitted' || s.session.status === 'approved') && <p className="notice">আজকের হিসাব চূড়ান্ত হয়ে গেছে — আর বদলানো যাবে না।</p>}

        {s.can_edit && !submitted && <RiderInbox session={s.session.id} onChange={() => reload()} />}
        <nav className="da-tabs no-print" aria-label="খাতার অংশ">{tabs.map(([k, l, c]) => <button key={k} type="button" data-tab={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} ({num(c)})</button>)}</nav>
        <div className="lr-sec no-print"><LearnButton module={tab === 'riders' ? 'rider' : tab === 'expense' ? 'expense' : 'merchant_payment'} label={`নির্দেশনা: ${tabs.find(t => t[0] === tab)?.[1] ?? ''}`} />
          <Link className="btn-link small" to="/app/accounts/learn?m=start">নতুন ম্যানেজার? শুরু থেকে শিখুন</Link></div>
        {tab === 'riders' && <RidersTab s={my} settings={st} reload={reload} ls={layoutSaved} />}
        {tab === 'expense' && <ExpenseTab s={my} settings={st} templates={templates.data ?? []} reload={reload} ls={layoutSaved} />}
        {tab === 'payment' && <MerchantTab s={my} settings={st} reload={reload} ls={layoutSaved} />}

        {s.can_edit && <div className="da-actionbar no-print">
          {!submitted && <><span className="muted small">{lines ? 'সব লেখা শেষ হলে সাবমিট দিন — এরপর ম্যানেজার দেখে গ্রহণ করবেন।' : 'আগে অন্তত একটি লাইন লিখুন।'}</span>
            <button type="button" disabled={busy || !lines} onClick={() => void run(() => da.closeMyPart(s.session.id, null, true), 'খাতা সাবমিট হয়েছে')}>{busy ? 'হচ্ছে…' : 'সাবমিট করুন'}</button></>}
          {submitted && !accepted && <><span className="muted small">সাবমিট {timeBn(part?.closed_at ?? null)} — কিছু বদলাতে হলে আবার খুলুন।</span>
            <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => da.closeMyPart(s.session.id, null, false), 'খাতা আবার খোলা হলো')}>আবার খুলুন</button></>}
          {accepted && <span className="muted small">Accept হয়েছে {timeBn(part?.accepted_at ?? null)} — বদলাতে হলে ম্যানেজারকে Accept ফিরিয়ে নিতে বলুন।</span>}
        </div>}
      </>}
    </div>
  </AccountsShell>
}
