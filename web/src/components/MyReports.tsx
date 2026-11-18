import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { FUEL_KIND, FUEL_STATUS, type Fuel } from '../lib/sorting'
import { NOTICE_STATUS, type Notice } from '../lib/officeOps'
import { hrReq } from '../lib/hrreq'
import { dispatch, DISPATCH_STATUS } from '../lib/dispatch'
import { issues, type IssueStatus } from '../lib/issues'
import { pageAllowed } from '../lib/menu'
import { usePrefs } from '../lib/prefs'
import { supabase } from '../lib/supabase'
import { wf } from '../lib/workforce'
import { Badge, useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral'
type Row = { key: string; date: string; icon: string; title: string; sub: string; status: [bn: string, en: string, tone: Tone]; note?: string | null; to: string; fix?: boolean }
const quiet = <T,>(p: PromiseLike<T>, or: T): Promise<T> => Promise.resolve(p).then(x => x, () => or)
const ISSUE_ST: Record<IssueStatus, [string, string, Tone]> = {
  open: ['খোলা', 'Open', 'warn'], in_progress: ['চলছে', 'In progress', 'info'], solved: ['সমাধান — যাচাই বাকি', 'Solved — to check', 'info'], approved: ['শেষ', 'Done', 'ok'], cancelled: ['বাতিল', 'Cancelled', 'neutral'] }
const HANDOVER: Record<string, [string, string, Tone]> = { sent: ['বুঝে নেওয়ার অপেক্ষায়', 'Waiting to be received', 'warn'], received: ['বুঝে নেওয়া হয়েছে', 'Received', 'ok'], disputed: ['আপত্তি আছে', 'Disputed', 'bad'] }
const TRIP: Record<string, [string, string, Tone]> = { done: ['জমা', 'Given', 'ok'], late: ['দেরি', 'Late', 'warn'], missed: ['মিস', 'Missed', 'bad'], breakdown: ['গাড়ি নষ্ট', 'Breakdown', 'warn'] }

/**
 * আমার রিপোর্ট — everything the person has put in over the last 30 days, one list: daily numbers, trip and fuel reports,
 * parcel handovers, broken/needed reports and complaints. It only reads what the person may already see. A report the
 * manager turned back (ফেরত) shows the manager's reason and a "fix and give again" button into the page that does the editing;
 * a report that is waiting or approved can only be looked at.
 */
export function MyReports() {
  const { L, lang } = usePrefs()
  const { can, session, menu } = useAuth()
  const uid = session?.user.id ?? ''
  const d = useLoad(async () => {
    const me = await quiet(hrReq.myEmployee(), null)
    const since = new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
    const mine = me ? `employee_id.eq.${me.id},created_by.eq.${uid}` : `created_by.eq.${uid}`
    const [ops, fuel, trips, hand, notes, given, sent] = await Promise.all([
      quiet(wf.myOps(30), null),
      can('sorting.fuel.view') || can('sorting.fuel.create') ? quiet(supabase.from('sorting_fuel_requests').select('id,no,kind,request_date,amount,status,review_note').or(mine).gte('request_date', since).order('request_date', { ascending: false }).limit(15).then(r => (r.data ?? []) as unknown as Fuel[]), [] as Fuel[]) : [],
      can('sorting.driver.view') || can('sorting.driver.create') ? quiet(supabase.from('sorting_driver_reports').select('id,work_date,status,note,parcels_out,parcels_in').eq('created_by', uid).gte('work_date', since).order('work_date', { ascending: false }).limit(15)
        .then(r => (r.data ?? []) as Array<{ id: string; work_date: string; status: string; note: string | null; parcels_out: number | null; parcels_in: number | null }>), []) : [],
      can('sorting.parcel.view') || can('sorting.parcel.create') ? quiet(supabase.from('sorting_handovers').select('id,no,work_date,direction,status,parcel_count,note').eq('created_by', uid).gte('work_date', since).order('work_date', { ascending: false }).limit(15)
        .then(r => (r.data ?? []) as Array<{ id: string; no: number; work_date: string; direction: string; status: string; parcel_count: number; note: string | null }>), []) : [],
      can('office.notice.create') ? quiet(supabase.from('office_notices').select('id,notice_no,title,kind,status,reply,created_at').eq('created_by', uid).gte('created_at', since).order('created_at', { ascending: false }).limit(15).then(r => (r.data ?? []) as unknown as Notice[]), [] as Notice[]) : [],
      quiet(issues.panels().then(p => p?.given ?? []), []),
      quiet(dispatch.list('mine', 30).then(l => l.filter(x => x.mine)), []),
    ])
    return { ops, fuel, trips, hand, notes, given, sent }
  }, [uid])
  const v = d.data
  if (!v) return null
  const dm = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short' })
  const rows: Row[] = []
  for (const o of v.ops?.recent ?? []) rows.push({ key: 'o' + o.id, date: o.work_date, icon: 'box', title: L('দৈনিক সংখ্যা', 'Daily numbers'),
    sub: L(`পিকআপ ${o.pickup} · ডেলিভারি ${o.delivery} · রিটার্ন ${o.pickup_return + o.delivery_return}`, `Pickup ${o.pickup} · delivery ${o.delivery} · returns ${o.pickup_return + o.delivery_return}`),
    status: o.revision > 1 ? ['জমা — সংশোধিত', 'Given — corrected', 'info'] : ['জমা', 'Given', 'ok'], to: '/app/staff#wf-ops' })
  for (const f of v.fuel) rows.push({ key: 'f' + f.id, date: f.request_date, icon: 'receipt', title: `${FUEL_KIND[f.kind]?.[lang === 'bn' ? 0 : 1] ?? f.kind} · ৳ ${Math.round(Number(f.amount)).toLocaleString('en-IN')}`, sub: L(`রিকুয়েস্ট #${f.no}`, `Request #${f.no}`),
    status: FUEL_STATUS[f.status] ?? ['—', '—', 'neutral'], note: f.status === 'rejected' ? f.review_note : null, to: '/app/sorting/fuel', fix: f.status === 'rejected' })
  for (const t of v.trips) rows.push({ key: 't' + t.id, date: t.work_date, icon: 'truck', title: L('ড্রাইভার রিপোর্ট', 'Driver report'), sub: L(`বের হয়েছে ${t.parcels_out ?? 0} · এসেছে ${t.parcels_in ?? 0}`, `Out ${t.parcels_out ?? 0} · in ${t.parcels_in ?? 0}`), status: TRIP[t.status] ?? ['জমা', 'Given', 'ok'], note: t.note, to: '/app/sorting/drivers' })
  for (const h of v.hand) rows.push({ key: 'h' + h.id, date: h.work_date, icon: 'box', title: L(`পার্সেল আদান-প্রদান #${h.no}`, `Parcel handover #${h.no}`), sub: L(`${h.parcel_count}টি পার্সেল`, `${h.parcel_count} parcels`),
    status: HANDOVER[h.status] ?? ['—', '—', 'neutral'], note: h.status === 'disputed' ? h.note : null, to: '/app/sorting/parcels', fix: h.status === 'disputed' })
  for (const n of v.notes) rows.push({ key: 'n' + n.id, date: n.created_at, icon: 'bell', title: n.title, sub: `${n.notice_no} · ${n.kind === 'broken' ? L('নষ্ট', 'Broken') : n.kind === 'need' ? L('লাগবে', 'Needed') : L('অন্যান্য', 'Other')}`,
    status: NOTICE_STATUS[n.status] ?? ['—', '—', 'neutral'], note: n.status === 'rejected' ? n.reply : null, to: '/app/office/notices', fix: n.status === 'rejected' })
  for (const i of v.given) rows.push({ key: 'i' + i.id, date: i.created_at, icon: 'alert', title: i.title, sub: `${i.issue_no}${i.hub ? ' · ' + i.hub : ''}`, status: ISSUE_ST[i.status] ?? ['—', '—', 'neutral'], to: '/app/issues?tab=given' })
  for (const s of v.sent) rows.push({ key: 's' + s.id, date: s.date, icon: 'truck', title: L(`পাঠিয়েছি → ${s.to ?? ''}`, `Sent → ${s.to ?? ''}`), sub: L(`#${s.no} · ${s.parcels}টি পার্সেল${s.items.length ? ` · ${s.items.length}টি জিনিস` : ''}`, `#${s.no} · ${s.parcels} parcels${s.items.length ? ` · ${s.items.length} items` : ''}`),
    status: DISPATCH_STATUS[s.status], note: s.status === 'disputed' ? s.receive_note : null, to: '/app/dispatch', fix: s.status === 'disputed' })
  rows.sort((a, b) => b.date.localeCompare(a.date))
  const shown = rows.filter(r => pageAllowed(menu, r.to.split('#')[0].split('?')[0])).slice(0, 12)
  const back = shown.filter(r => r.fix).length
  return <section className="mrp">
    <h2 className="sd-h">{L('আমার রিপোর্ট', 'My reports')}{back > 0 && <span className="cnt"><Badge tone="bad">{back}</Badge></span>}</h2>
    {shown.length === 0 ? <p className="muted small" style={{ margin: '0 4px' }}>{L('গত ৩০ দিনে কোনো রিপোর্ট দেননি।', 'No report in the last 30 days.')}</p>
      : <div className="nv-rows">{shown.map(r => <Link key={r.key} to={r.to} className="nv-row">
        <span className={`nv-av sd-i ${r.fix ? 'r' : r.status[2] === 'ok' ? 'g' : r.status[2] === 'warn' ? 'o' : 'b'}`}><Icon name={r.icon} size={22} /></span>
        <span className="tx"><b>{r.title}</b><span>{dm(r.date)} · {r.sub}</span>{r.note ? <span className="mrp-note">{L('ম্যানেজারের কারণ', "Manager's reason")}: {r.note}</span> : null}
          {r.fix ? <span className="mrp-fix"><Icon name="edit" size={14} />{L('সংশোধন করে আবার দিন', 'Fix and give again')}</span> : null}</span>
        <span className="end"><Badge tone={r.status[2]}>{L(r.status[0], r.status[1])}</Badge></span></Link>)}</div>}
    <p className="muted small sd-note">{L('জমা বা অনুমোদিত রিপোর্ট শুধু দেখা যায়। ম্যানেজার ফেরত দিলে তবেই সংশোধন করে আবার দিতে পারবেন।', 'A given or approved report can only be viewed. Once your manager turns it back, you can fix it and give it again.')}</p>
  </section>
}
