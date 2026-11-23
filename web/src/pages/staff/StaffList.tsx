// কর্মী ব্যবস্থাপনা — একটাই পেজ, রোল অনুযায়ী ভিউ:
//  - হাব ম্যানেজার (hr.employee.edit নেই): শুধু নিজ হাবের active staff; "চাকরি ছেড়েছে"/"নতুন স্টাফ" → request flow (jonal approves)
//  - জোনাল ম্যানেজার / HR / Admin (hr.employee.edit আছে): পুরো তালিকা, bulk actions, হাব-ম্যাট্রিক্স, direct change
// Old files replaced: pages/manager/ManagerStaff.tsx, pages/zonal/ZonalStaff.tsx, pages/hr/Employees.tsx
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Contact } from '../../components/Contact'
import { DataTable } from '../../components/DataTable'
import { ExportByFormatDialog } from '../../components/ExportByFormat'
import { Icon } from '../../components/Icon'
import { Combo, TextInput } from '../../components/inputs'
import { RowMenu, type RowMenuItem } from '../../components/RowMenu'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { bn, dmy, EMP_STATUS, hr, hrFriendly, todayDhaka, type Employee, type EmployeeStatus } from '../../lib/hr'
import { customFields, formatFriendly, staffAdmin } from '../../lib/staffAdmin'
import { LIFE, joinFields, lifeFriendly, lifecycle, pickJoinFormat, scopeHubs, type JoinField, type PendingReq } from '../../lib/lifecycle'
import { BD_MOBILE, cleanMobile, matches, rules } from '../../lib/validate'
import { downloadIdCreateFile } from '../../lib/idCreateFile'
import { download, xlsxBlob } from '../../lib/xlsx'
import { EmpBadge, NewApplication, useOrg } from '../hr/common'
import { HubPostMatrix } from '../zonal/HubPostMatrix'
import '../hr/Employees.css'

const HUB_KEY = 'xzm_manager_staff_hub'
const TONES = ['g', 'b', 'o', 'p', 'c', 'r']
const toneOf = (s: string) => TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length]
const initials = (nm: string) => nm.replace(/^(md\.?|mohammad|mohammed|mst\.?)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
// The summary strip is also the status filter: [status, label, tone, hint]
const STATUS_TABS: Array<[string, string, string, string]> = [
  ['', 'সব কর্মী', 'blue', 'আপনি যে এলাকা দেখতে পারেন'], ['active', 'সক্রিয়', 'green', 'বর্তমানে কর্মরত'],
  ['applicant', 'আইডির অপেক্ষায়', 'amber', 'আবেদন / অনুমোদন বাকি'], ['inactive', 'নিষ্ক্রিয়', 'gray', 'নিষ্ক্রিয় / পদত্যাগ / সমাপ্ত']]
const inStatus = (e: Employee, s: string) => !s || e.status === s || (s === 'inactive' && ['inactive', 'resigned', 'terminated'].includes(e.status))

/** Staff management — one page, two views by role. */
export function StaffList() {
  const { can } = useAuth()
  // যে কেউ hr.employee.edit বা hr.transfer.edit পায়, তার জন্য পুরো ভিউ।
  // শুধু hr.request.create আছে কিন্তু উপরেরগুলো নেই → হাব ম্যানেজার, request flow।
  const full = can('hr.employee.edit') || can('hr.transfer.edit') || can('hr.employee.archive') || can('hr.application.approve')
  return full ? <FullStaffView /> : <HubManagerView />
}

// ───────────── হাব ম্যানেজার ভিউ ─────────────
// নিজ হাবের সক্রিয় স্টাফ, "চাকরি ছেড়েছে" ও "নতুন স্টাফ" — দুইটাই request পাঠায়, জোনাল অনুমোদন করে।
type Act = null | { kind: 'leave' | 'transfer'; emp: Employee } | { kind: 'join' }

function HubManagerView() {
  const { grants, can } = useAuth()
  const { L, n } = usePrefs()
  const o = useOrg()
  const { toast, node } = useToast()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'pending' ? 'pending' : 'active'
  const decides = can('hr.request.approve')
  const hubs = useMemo(() => scopeHubs(grants, o.data?.hubs, 'hr.request.create'), [grants, o.data])
  const [picked, setPicked] = useState(() => { try { return localStorage.getItem(HUB_KEY) ?? '' } catch { return '' } })
  const hub = hubs.find(h => h.id === picked) ?? hubs[0] ?? null
  const choose = (id: string) => { setPicked(id); try { localStorage.setItem(HUB_KEY, id) } catch { /* private window */ } }
  const staff = useLoad(() => (hub ? hr.employees({ hub: hub.id, status: 'active', limit: 1000 }) : Promise.resolve([] as Employee[])), [hub?.id])
  const pending = useLoad(() => (hub ? lifecycle.pendingForHub(hub.id) : Promise.resolve([] as PendingReq[])), [hub?.id])
  const [act, setAct] = useState<Act>(null)
  const waiting = useMemo(() => new Set((pending.data ?? []).filter(p => p.kind === 'id_inactive' && p.employee_id).map(p => p.employee_id as string)), [pending.data])
  const done = (m: string) => { setAct(null); toast(m); void staff.reload(); void pending.reload() }
  const canJoin = can('hr.application.create')

  const menu = (e: Employee): RowMenuItem[] => [
    { label: L('চাকরি ছেড়ে দিয়েছে', 'Left the job'), icon: 'userx', danger: true, disabled: waiting.has(e.id),
      hint: waiting.has(e.id) ? L('অনুরোধ অপেক্ষমাণ', 'Request waiting') : undefined, onClick: () => setAct({ kind: 'leave', emp: e }) },
    ...(decides ? [{ label: L('অন্য হাবে বদলি', 'Transfer to another hub'), icon: 'swap', onClick: () => setAct({ kind: 'transfer', emp: e }) }] : []),
  ]

  return <AppShell title={L('সক্রিয় স্টাফ', 'Active staff')}
    subtitle={decides ? L('যেকোনো হাবের সক্রিয় স্টাফ। এখান থেকে নতুন স্টাফ যোগ, চাকরি ছাড়া আর বদলি — সবই করা যায়।', 'Active staff of any hub: add, exit and transfer from here.')
      : L('আপনার হাবের সক্রিয় স্টাফ। কেউ চাকরি ছাড়লে বা নতুন কেউ এলে এখান থেকে জোনাল ম্যানেজারকে জানান।', 'Active staff of your hub. Tell the zonal manager here when someone leaves or joins.')}
    actions={<>{decides && <Link to="/app/zonal/requests" className="btn-ghost">{L('অনুরোধ ইনবক্স', 'Request inbox')}</Link>}
      {canJoin && hub && <button onClick={() => setAct({ kind: 'join' })}><Icon name="userplus" size={16} />{L('নতুন স্টাফ যোগ', 'Add new staff')}</button>}</>}>
    {node}
    {hubs.length > 1 && <section className="da-filters panel no-print">
      <Field label={L('হাব', 'Hub')}><Combo value={hub?.id ?? ''} onChange={v => v && choose(v)} clearable={false}
        options={hubs.map(h => ({ value: h.id, label: h.name, sub: o.names.zone[h.zone_id] }))} /></Field>
    </section>}
    {!o.loading && !hubs.length && <p className="notice">{L('আপনাকে কোনো হাবের দায়িত্ব দেওয়া হয়নি।', 'No hub is assigned to you.')}</p>}

    {hub && <>
      <div className="da-stats">
        <Stat icon="hub" label={L('হাব', 'Hub')} value={hub.name} />
        <Stat icon="users" tone="ok" label={L('সক্রিয় স্টাফ', 'Active staff')} value={n(staff.data?.length ?? 0)} />
        <Stat icon="clock" tone={pending.data?.length ? 'warn' : undefined} label={L('অপেক্ষমাণ আবেদন', 'Waiting requests')} value={n(pending.data?.length ?? 0)} />
      </div>
      <nav className="emp-tabs no-print" role="tablist">
        <button role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'on' : ''} onClick={() => setSp({})}><Icon name="users" size={16} />{L('সক্রিয় স্টাফ', 'Active staff')}</button>
        <button role="tab" aria-selected={tab === 'pending'} className={tab === 'pending' ? 'on' : ''} onClick={() => setSp({ tab: 'pending' })}><Icon name="clock" size={16} />
          {L('অপেক্ষমাণ আবেদন', 'Waiting requests')}{!!pending.data?.length && <span className="tab-count">{n(pending.data.length)}</span>}</button>
      </nav>
      {(staff.error || pending.error) ? <p className="da-error">{lifeFriendly(staff.error || pending.error)}</p> : null}

      {tab === 'active' && <section className="panel">
        <DataTable<Employee> title={`${hub.name} — ${L('সক্রিয় স্টাফ', 'active staff')}`} file={`active-staff-${hub.name}`} prefKey="manager-staff" rows={staff.data} rowKey={e => e.id}
          empty={<p className="muted">{staff.loading ? L('লোড হচ্ছে…', 'Loading…') : L('এই হাবে কোনো সক্রিয় স্টাফ নেই।', 'No active staff in this hub.')}</p>}
          cols={[
            { key: 'code', label: L('আইডি', 'ID'), value: e => e.employee_code ?? '', render: e => <strong>{e.employee_code ?? '—'}</strong> },
            { key: 'name', label: L('নাম', 'Name'), primary: true, value: e => e.full_name,
              render: e => <>{e.full_name}{waiting.has(e.id) && <> <Badge tone="warn">{L('অপেক্ষমাণ', 'Waiting')}</Badge></>}</> },
            { key: 'mobile', label: L('মোবাইল', 'Mobile'), value: e => e.mobile ?? '', render: e => <Contact phone={e.mobile} /> },
            { key: 'pos', label: L('পদবি', 'Position'), value: e => (e.position_id ? o.names.pos[e.position_id] ?? '' : '') },
            { key: 'join', label: L('যোগদান', 'Joined'), value: e => dmy(e.joining_date) },
            { key: 'act', label: '', noExport: true, render: e => <RowMenu label={`${e.full_name} — ${L('কাজ', 'actions')}`} items={menu(e)} /> },
          ]} />
      </section>}

      {tab === 'pending' && <section className="panel">
        {!pending.data?.length ? <p className="muted">{pending.loading ? L('লোড হচ্ছে…', 'Loading…') : L('কোনো আবেদন অপেক্ষায় নেই।', 'Nothing is waiting.')}</p>
          : <div className="lc-list">{pending.data.map(p => <div key={p.id} className="lc-row">
            <span className={`rq-kind-tag t-${LIFE[p.kind].tone}`}><Icon name={LIFE[p.kind].icon} size={14} />{p.kind === 'id_create' ? L('নতুন স্টাফ', 'New staff') : L('চাকরি ছাড়া', 'Left the job')}</span>
            <span className="lc-main"><b>{p.data.full_name || '—'}{p.data.employee_code ? ` · ${p.data.employee_code}` : ''}</b>
              <small>{p.request_no} · {dmy(p.created_at)}{p.data.reason ? ` · ${p.data.reason}` : ''}</small></span>
            <Badge tone="warn">{L('জোনাল ম্যানেজারের অপেক্ষায়', 'Waiting for the zonal manager')}</Badge>
          </div>)}</div>}
      </section>}
    </>}

    {act?.kind === 'leave' && <LeaveRequestModal emp={act.emp} decides={decides} onClose={() => setAct(null)} onDone={done} />}
    {act?.kind === 'transfer' && <TransferRequestModal emp={act.emp} hubs={(o.data?.hubs ?? []).filter(h => h.id !== act.emp.hub_id).map(h => ({ value: h.id, label: h.name, sub: o.names.zone[h.zone_id] }))}
      onClose={() => setAct(null)} onDone={done} />}
    {act?.kind === 'join' && hub && <JoinRequestModal hub={hub} decides={decides} onClose={() => setAct(null)} onDone={m => { done(m); setSp({ tab: 'pending' }) }} />}
  </AppShell>
}

// ───────────── জোনাল / HR / অ্যাডমিন পূর্ণ ভিউ ─────────────
const qs = () => new URLSearchParams(typeof location !== 'undefined' ? location.search : '')

function FullStaffView() {
  const { can } = useAuth()
  const nav = useNavigate()
  const o = useOrg()
  const { toast, node } = useToast()
  const [q, setQ] = useState(() => qs().get('q') ?? '')
  const [zone, setZone] = useState('')
  const [hubF, setHubF] = useState('')
  const [status, setStatus] = useState(() => (qs().get('q') ? '' : 'active'))
  const [post, setPost] = useState('')
  const [showMatrix, setShowMatrix] = useState(false)
  const [newApp, setNewApp] = useState(false)
  const [quick, setQuick] = useState(false)
  const [exportFmt, setExportFmt] = useState(false)
  const list = useLoad(() => hr.employees({ limit: 2000 }), [])
  const leave = useLoad(() => hr.onLeaveToday().catch(() => [] as string[]), [])
  const [act, setAct] = useState<{ kind: 'transfer' | 'status' | 'wrong' | 'ids'; list: Employee[]; clear: () => void } | null>(null)
  const all = list.data ?? []
  const onLeave = useMemo(() => new Set(leave.data ?? []), [leave.data])
  const hubName = (e: Employee) => (e.hub_id ? o.names.hub[e.hub_id] ?? '' : '')
  const posName = (e: Employee) => (e.position_id ? o.names.pos[e.position_id] ?? '' : '')
  const base = useMemo(() => all.filter(e => (!zone || e.zone_id === zone) && (!hubF || e.hub_id === hubF)
    && matches(`${e.full_name} ${e.full_name_bn ?? ''} ${e.employee_code ?? ''} ${e.mobile ?? ''}`, q)), [all, zone, hubF, q])
  const scoped = useMemo(() => base.filter(e => inStatus(e, status)), [base, status])
  const rows = useMemo(() => scoped.filter(e => !post || (post === 'leave' ? onLeave.has(e.id) : e.position_id === post)), [scoped, post, onLeave])
  const posts = (o.data?.positions ?? []).map(p => ({ p, count: scoped.filter(e => e.position_id === p.id).length })).filter(x => x.count > 0)
  const leaveCount = scoped.filter(e => onLeave.has(e.id)).length
  const zones = o.data?.zones ?? []
  const hubList = (o.data?.hubs ?? []).filter(h => !zone || h.zone_id === zone)
  const canMove = can('hr.employee.edit') || can('hr.transfer.edit')
  const done = (m: string) => { act?.clear(); setAct(null); toast(m); void list.reload() }
  const activeCount = all.filter(e => e.status === 'active').length
  const hasFilters = !!(q || zone || hubF || status !== 'active' || post)
  const clearFilters = () => { setQ(''); setZone(''); setHubF(''); setStatus('active'); setPost('') }
  const ready = !!list.data && !list.error
  const stat = (v: number) => ready ? bn(v) : '—'
  const idFile = () => { void downloadIdCreateFile({ zone: zone || null, hub: hubF || null, status: status || 'active', q: q || null }).then(n2 => toast(n2 ? `আইডি তৈরির ফাইল নামানো হয়েছে — ${n2} জন` : 'কোনো কর্মী পাওয়া যায়নি')).catch((e: unknown) => toast(e instanceof Error ? e.message : 'ফাইল বানানো যায়নি')) }
  const moreMenu: RowMenuItem[] = [
    { label: showMatrix ? 'ম্যাট্রিক্স লুকান' : 'হাব-ম্যাট্রিক্স', icon: 'hub', onClick: () => setShowMatrix(s => !s) },
    { label: 'আইডি তৈরির ফাইল', icon: 'xls', onClick: idFile },
    { label: 'ফরম্যাটে এক্সপোর্ট', icon: 'xls', onClick: () => setExportFmt(true) },
  ]

  return <AppShell title="কর্মী ব্যবস্থাপনা" subtitle={ready ? `${bn(activeCount)} জন সক্রিয় কর্মী — পদ, এরিয়া বা হাব ধরে দেখুন; টিক দিয়ে একসাথে অনেকের কাজ করুন।` : 'পদ, এরিয়া বা হাব ধরে কর্মী দেখুন; টিক দিয়ে একসাথে অনেকের কাজ করুন।'}
    actions={<>
      {canMove && <button className="secondary" onClick={() => setQuick(true)}>⇄ হাব বদলি</button>}
      {can('hr.application.create') && <button className="nv-wide-only" onClick={() => setNewApp(true)}>+ নতুন কর্মী</button>}
      <span className="hr-more no-print"><RowMenu label="আরও কাজ" items={moreMenu} /></span></>}>
    {node}
    <section className="hr-emp-stats no-print" role="group" aria-label="অবস্থা অনুযায়ী">
      {STATUS_TABS.map(([k, l, tone, hint]) => <button key={k || 'all'} type="button" className={`hr-emp-stat ${tone}${status === k ? ' on' : ''}`} aria-pressed={status === k} title={hint} onClick={() => setStatus(k)}>
        <small>{l}</small><strong>{stat(base.filter(e => inStatus(e, k)).length)}</strong></button>)}
    </section>

    {showMatrix && <HubPostMatrix zone={zone || null} onHub={id => setHubF(id)} />}

    <section className="panel emp-board hr-emp-board">
      <div className="hr-emp-list-heading"><div><h2>কর্মী তালিকা</h2><p aria-live="polite">{list.error ? 'তালিকা আনা যায়নি' : !list.data ? 'তথ্য লোড হচ্ছে…' : `${bn(all.length)} জনের মধ্যে ${bn(rows.length)} জন দেখানো হচ্ছে`}</p></div>{hasFilters && <button type="button" className="hr-emp-clear" onClick={clearFilters}>সব ফিল্টার মুছুন ×</button>}</div>
      <div className="eb-bar no-print">
        <label className="emp-search"><Icon name="search" size={18} />
          <input type="search" placeholder="নাম, আইডি বা মোবাইল দিয়ে খুঁজুন…" value={q} onChange={e => setQ(e.target.value)} aria-label="খুঁজুন" />
          {q && <button type="button" className="icon-btn" aria-label="মুছুন" onClick={() => setQ('')}><Icon name="x" size={16} /></button>}</label>
        {zones.length > 1 && <div className="eb-sel"><Combo label="এরিয়া" value={zone} onChange={v => { setZone(v); setHubF('') }} placeholder="সব এরিয়া" options={zones.map(z => ({ value: z.id, label: z.name }))} /></div>}
        <div className="eb-sel"><Combo label="হাব" value={hubF} onChange={setHubF} placeholder="সব হাব" options={hubList.map(h => ({ value: h.id, label: h.name }))} /></div>
      </div>
      <div className="eb-chips no-print" role="group" aria-label="পদ অনুযায়ী">
        <button type="button" className={`chip-toggle${post === '' ? ' on' : ''}`} aria-pressed={post === ''} onClick={() => setPost('')}>সব পদ <b>{bn(scoped.length)}</b></button>
        {posts.map(({ p, count }) => <button key={p.id} type="button" className={`chip-toggle${post === p.id ? ' on' : ''}`} aria-pressed={post === p.id} onClick={() => setPost(post === p.id ? '' : p.id)}>
          {o.names.pos[p.id] ?? p.name} <b>{bn(count)}</b></button>)}
        <button type="button" className={`chip-toggle${post === 'leave' ? ' on' : ''}`} aria-pressed={post === 'leave'} onClick={() => setPost(post === 'leave' ? '' : 'leave')}>আজ ছুটিতে <b>{bn(leaveCount)}</b></button>
      </div>
      {list.error ? <p className="da-error" role="alert">{hrFriendly(list.error)} <button type="button" className="link" onClick={() => void list.reload()}>আবার চেষ্টা করুন</button></p> : null}
      <DataTable<Employee> title="কর্মী তালিকা" file="employees" rows={list.data ? rows : null} rowKey={e => e.id} search={false} quickFilters={false} phoneView="list" onRowClick={e => nav(`/app/hr/employees/${e.id}`)}
        empty={<p className="muted">{hasFilters ? <>এই বাছাইয়ে কোনো কর্মী নেই। <button type="button" className="link" onClick={clearFilters}>সব ফিল্টার মুছুন</button></> : 'এখনো কোনো কর্মী নেই।'}</p>}
        bulk={(marked, clear) => <>
          {canMove && <button type="button" className="sm" onClick={() => setAct({ kind: 'transfer', list: marked, clear })}>অন্য হাবে বদলি</button>}
          {can('hr.employee.edit') && <button type="button" className="sm" onClick={() => setAct({ kind: 'status', list: marked, clear })}>সক্রিয় / নিষ্ক্রিয়</button>}
          {can('hr.application.approve') && <button type="button" className="sm" onClick={() => setAct({ kind: 'ids', list: marked, clear })}>আইডি দিন</button>}
          {can('hr.employee.archive') && <button type="button" className="sm danger" onClick={() => setAct({ kind: 'wrong', list: marked, clear })}>ভুল এন্ট্রি — মুছুন</button>}
          <button type="button" className="secondary sm" onClick={clear}>বাছাই তুলুন</button></>}
        cols={[
          { key: 'full_name', label: 'নাম', primary: true, value: e => e.full_name, render: e => <span className="emp-tname"><span className={`ec-av sm t-${toneOf(e.full_name)}`}>{initials(e.full_name)}</span>
            <span><b>{e.full_name}</b><span className="sec">{e.employee_code ? `আইডি ${e.employee_code}` : 'আইডি বাকি'}{e.full_name_bn ? ` · ${e.full_name_bn}` : ''}</span></span></span> },
          { key: 'employee_code', label: 'আইডি', hidden: true, value: e => e.employee_code ?? '' },
          { key: 'mobile', label: 'মোবাইল', value: e => e.mobile ?? '', render: e => <Contact phone={e.mobile} /> },
          { key: 'pos', label: 'পদবি', value: posName, render: e => posName(e) ? <Badge tone="ok">{posName(e)}</Badge> : <Badge tone="neutral">পদ দেওয়া নেই</Badge> },
          { key: 'hub', label: 'হাব', value: hubName },
          { key: 'status', label: 'অবস্থা', value: e => EMP_STATUS[e.status as EmployeeStatus]?.[0] ?? e.status, render: e => <EmpBadge status={e.status} /> },
          { key: 'act', label: 'কাজ', noExport: true, className: 'r', render: e => <span className="row-acts" onClick={ev => ev.stopPropagation()}>
            {can('hr.employee.edit') && e.status !== 'applicant' && <button type="button" className="secondary sm" onClick={() => nav(`/app/hr/employees/${e.id}?edit=1`)}>এডিট</button>}
            <button type="button" className="sm" onClick={() => nav(`/app/hr/employees/${e.id}`)}>দেখুন</button></span> },
        ]} />
    </section>
    {can('hr.application.create') && <button type="button" className="nv-fab no-print" onClick={() => setNewApp(true)}><Icon name="plus" size={22} /> নতুন কর্মী</button>}
    {act?.kind === 'transfer' && <TransferAction list={act.list} hubs={o.data?.hubs ?? []} onClose={() => setAct(null)} onDone={done} />}
    {act?.kind === 'status' && <StatusAction list={act.list} onClose={() => setAct(null)} onDone={done} />}
    {act?.kind === 'ids' && <GiveIdsAction list={act.list} onClose={() => setAct(null)} onDone={done} />}
    {act?.kind === 'wrong' && <RemoveWrong list={act.list} onClose={() => setAct(null)} onDone={done} />}
    {exportFmt && <ExportByFormatDialog zone={zone || null} hub={hubF || null} status={status || null} q={q || null} title="কর্মী তালিকা" onClose={() => setExportFmt(false)} />}
    {quick && <QuickTransfer onClose={() => setQuick(false)} onDone={m => { setQuick(false); toast(m); void list.reload() }} />}
    {newApp && <NewApplication onClose={() => setNewApp(false)} onDone={id => { toast('আবেদন খোলা হয়েছে — বাকি তথ্য দিয়ে সাবমিট করুন'); nav(`/app/hr/employees/${id}`) }} />}
  </AppShell>
}

// ───────────── shared helpers (previously exported from ZonalStaff) ─────────────
export function Names({ list }: { list: Employee[] }) {
  const { L, n } = usePrefs()
  return <p className="muted small">{n(list.length)} {L('জন:', 'people:')} {list.slice(0, 8).map(e => `${e.employee_code ?? '—'} ${e.full_name}`).join(', ')}{list.length > 8 ? ` … +${n(list.length - 8)}` : ''}</p>
}

function Who({ emp }: { emp: Employee }) {
  return <p className="lc-who"><Icon name="user" size={16} /><b>{emp.full_name}</b>{emp.employee_code && <span>· {emp.employee_code}</span>}{emp.mobile && <span>· {emp.mobile}</span>}</p>
}

// ───── bulk: active/inactive (direct, for zonal/HR) ─────
export function StatusAction({ list, onClose, onDone }: { list: Employee[]; onClose: () => void; onDone: (m: string) => void }) {
  const { L, n } = usePrefs()
  const { can } = useAuth()
  const full = can('hr.employee.edit'); const approve = can('hr.employee.approve')
  const [to, setTo] = useState<EmployeeStatus>('inactive')
  const [date, setDate] = useState(todayDhaka())
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const targets = list.filter(e => e.status !== to && (e.status === 'active' || e.status === 'inactive'
    || (to === 'active' && approve && (e.status === 'resigned' || e.status === 'terminated'))))
  const needsActive = to === 'resigned' || to === 'terminated'
  async function go() {
    setErr('')
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter a reason'))
    if (!targets.length) return setErr(L('বাছাই করা কারও অবস্থা বদলানোর নেই', 'None of the selected staff need this change'))
    setBusy(true)
    let ok = 0; const bad: string[] = []
    for (const e of targets) {
      try { await hr.changeStatus(e.id, to, date, reason.trim()); ok++ }
      catch (x) { bad.push(`${e.full_name}: ${hrFriendly(x)}`) }
    }
    setBusy(false)
    if (ok) onDone(L(`${n(ok)} জনের অবস্থা বদলানো হয়েছে`, `${ok} updated`) + (bad.length ? L(`, ${n(bad.length)} জনে সমস্যা`, `, ${bad.length} failed`) : ''))
    if (!ok) setErr(bad.join(' · '))
  }
  return <Modal title={L('সক্রিয় / নিষ্ক্রিয় করুন', 'Active / inactive')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{L('বদলান', 'Change')}</button></>}>
    <Names list={list} />
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label={L('নতুন অবস্থা', 'New status')}><select value={to} onChange={e => setTo(e.target.value as EmployeeStatus)}>
        <option value="inactive">{L('নিষ্ক্রিয় করুন', 'Make inactive')}</option>
        <option value="active">{L('আবার সক্রিয় করুন', 'Make active again')}</option>
        {full && <option value="resigned">{L('চাকরি ছেড়েছেন', 'Resigned')}</option>}
        {approve && <option value="terminated">{L('অব্যাহতি দেওয়া হয়েছে', 'Terminated')}</option>}</select></Field>
      <Field label={L('যেদিন থেকে', 'From')}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field wide label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: ছুটিতে আছেন / কাজে ফিরেছেন', 'e.g. on long leave / back at work')} /></Field>
    </div>
    <p className="muted small">{needsActive
      ? L('“চাকরি ছেড়েছেন” বা “অব্যাহতি” করলে কর্মীর কাজ শেষ ধরা হবে। এর পরেই তাঁকে তালিকা থেকে সরানো যাবে। বকেয়া হিসাব থাকলে আগে মেটাতে হবে।',
          'Resigned or terminated closes their employment. Only then can they be removed from the list; any dues must be settled first.')
      : L('নিষ্ক্রিয় করলে কর্মী তালিকায় থাকবেন, হাজিরা আর বেতনের হিসাবে আসবেন না। আবার সক্রিয় করা যাবে।',
          'An inactive employee stays on the list but is left out of attendance and salary. You can make them active again.')}</p>
    {targets.length !== list.length && <p className="notice">{L(`বাছাই করা ${n(list.length)} জনের মধ্যে ${n(targets.length)} জনের অবস্থা বদলাবে, বাকিরা আগেই ওই অবস্থায় আছেন বা আবেদনকারী।`,
      `${targets.length} of ${list.length} will change; the rest are already in that state or are applicants.`)}</p>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

// ───── Hub transfer (direct, for zonal/HR) with Excel export ─────
function QuickTransfer({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const { L } = usePrefs()
  const o = useOrg()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Employee[]>([])
  const [next, setNext] = useState(false)
  const found = useLoad(() => q.trim().length >= 2 ? hr.employees({ q: q.trim(), status: 'active', limit: 20 }) : Promise.resolve([] as Employee[]), [q])
  const has = (e: Employee) => picked.some(x => x.id === e.id)
  const fromHubs = new Set(picked.map(e => e.hub_id))
  if (next) return <TransferAction list={picked} hubs={(o.data?.hubs ?? []).filter(h => !(fromHubs.size === 1 && fromHubs.has(h.id)))} onClose={onClose} onDone={onDone} />
  return <Modal title={L('হাব বদলি — কর্মী বাছুন', 'Hub transfer — choose staff')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      <button disabled={!picked.length} onClick={() => setNext(true)}>{L('পরের ধাপ', 'Next')} ({picked.length})</button></>}>
    <Field label={L('খুঁজুন', 'Search')} hint={L('এমপ্লয়ি আইডি, নাম বা মোবাইল — শুধু সক্রিয় কর্মী', 'Employee ID, name or mobile — active staff only')}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={L('যেমন 1234 বা রহিম', 'e.g. 1234 or Rahim')} /></Field>
    {picked.length > 0 && <div className="focus-pick" style={{ margin: '8px 0' }}>{picked.map(e =>
      <button key={e.id} type="button" className="secondary sm" onClick={() => setPicked(p => p.filter(x => x.id !== e.id))}>{e.full_name} ✕</button>)}</div>}
    {found.error ? <p className="da-error">{hrFriendly(found.error)}</p> : null}
    <ul className="duty-list">{(found.data ?? []).map(e => <li key={e.id} className="duty" style={{ cursor: 'pointer' }}
        onClick={() => setPicked(p => has(e) ? p.filter(x => x.id !== e.id) : [...p, e])}>
      <input type="checkbox" style={{ width: 'auto' }} readOnly checked={has(e)} />
      <div style={{ flex: 1, minWidth: 0 }}><b>{e.full_name}</b> {e.employee_code && <span className="muted">#{e.employee_code}</span>}
        <div className="muted small">{e.hub_id ? o.names.hub[e.hub_id] ?? '' : ''}{e.position_id ? ` · ${o.names.pos[e.position_id] ?? ''}` : ''}</div></div></li>)}
      {q.trim().length >= 2 && !found.loading && !found.data?.length && <li className="muted">{L('কাউকে পাওয়া যায়নি', 'Nobody found')}</li>}</ul>
  </Modal>
}

export function TransferAction({ list, hubs, onClose, onDone }: { list: Employee[]; hubs: Array<{ id: string; name: string }>; onClose: () => void; onDone: (m: string) => void }) {
  const { L, n } = usePrefs()
  const o = useOrg()
  const [hub, setHub] = useState('')
  const [date, setDate] = useState(todayDhaka())
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [moved, setMoved] = useState<{ people: Employee[]; msg: string; bad: string[] } | null>(null)
  const targets = list.filter(e => e.status === 'active')
  const hubName = (id: string | null) => id ? o.names.hub[id] ?? hubs.find(h => h.id === id)?.name ?? '' : ''
  function excel(people: Employee[], remark: string) {
    download(xlsxBlob('Employee Transfer', `${hubName(hub)} · ${date}`,
      ['SL', 'Employee ID', 'Name', 'Phone Number', 'Designation', 'Present Hub', 'Transfer Hub', 'Effective Date', 'Reason', 'Reference Name & ID', 'Remarks'],
      people.map((e, i) => [i + 1, e.employee_code, e.full_name, e.mobile, e.position_id ? o.names.posEn[e.position_id] ?? '' : '', hubName(e.hub_id), hubName(hub), date, reason.trim(), e.reference_info, remark])),
      `Transfer-${date}.xlsx`)
  }
  function check() {
    if (!hub) return L('কোন হাবে যাবেন বেছে নিন', 'Choose the new hub')
    if (!reason.trim()) return L('কারণ লিখুন', 'Enter a reason')
    if (!targets.length) return L('শুধু সক্রিয় কর্মীদের বদলি করা যায়', 'Only active staff can be transferred')
    return ''
  }
  async function go() {
    const problem = check()
    setErr(problem)
    if (problem) return
    setBusy(true)
    const d: Employee[] = []; const bad: string[] = []
    for (const e of targets) {
      try {
        await hr.transfer(e.id, { hub, department: e.department_id, position: e.position_id, manager: e.reporting_manager_id, effective: date, reason: reason.trim(), type: 'transfer' })
        d.push(e)
      } catch (x) { bad.push(`${e.full_name}: ${hrFriendly(x)}`) }
    }
    setBusy(false)
    if (!d.length) return setErr(bad.join(' · '))
    setMoved({ people: d, bad, msg: L(`${n(d.length)} জনকে বদলি করা হয়েছে`, `${d.length} transferred`) + (bad.length ? L(`, ${n(bad.length)} জনে সমস্যা`, `, ${bad.length} failed`) : '') })
  }
  if (moved) return <Modal title={L('বদলি হয়েছে', 'Transfer done')} onClose={() => onDone(moved.msg)}
    actions={<><button className="secondary" onClick={() => onDone(moved.msg)}>{L('বন্ধ করুন', 'Close')}</button>
      <button onClick={() => excel(moved.people, 'সিস্টেমে হয়েছে')}>{L('এক্সেল ফাইল নামান', 'Download Excel file')}</button></>}>
    <p><b>{moved.msg}</b> → {hubName(hub)}</p>
    <Names list={moved.people} />
    {moved.bad.length > 0 && <p className="da-error">{moved.bad.join(' · ')}</p>}
    <p className="muted small">{L('কোম্পানির ফরম্যাটে বদলির এক্সেল ফাইল এখান থেকে নিন। পরে লাগলে “জোনাল ফাইল” পাতায় তারিখ ধরে আবার পাওয়া যাবে।',
      'Take the transfer Excel in the company layout here. Later it is also on the "Zonal files" page by date.')}</p>
  </Modal>
  return <Modal title={L('অন্য হাবে বদলি', 'Transfer to another hub')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      <button className="secondary" disabled={busy} title={L('বদলি না করে শুধু ফাইল', 'File only, no transfer')}
        onClick={() => { const problem = check(); setErr(problem); if (!problem) excel(targets, 'প্রস্তাবিত') }}>{L('শুধু এক্সেল', 'Excel only')}</button>
      <button disabled={busy} onClick={() => void go()}>{L('বদলি করুন', 'Transfer')}</button></>}>
    <Names list={list} />
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field label={L('নতুন হাব', 'New hub')}><Combo value={hub} onChange={setHub} placeholder={L('বেছে নিন…', 'Choose…')} options={hubs.map(h => ({ value: h.id, label: h.name }))} /></Field>
      <Field label={L('যেদিন থেকে', 'From')}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field wide label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: নতুন হাবে জনবল দরকার', 'e.g. the new hub needs staff')} /></Field>
    </div>
    <p className="muted small">{L('পদবি আর বিভাগ আগের মতোই থাকবে। বদলির হিসাব প্রোফাইলের ইতিহাসে থেকে যাবে। বদলির পর কোম্পানির ফরম্যাটে এক্সেল ফাইল নামানো যাবে।',
      'Position and department stay the same. The move is kept in the profile history. After the transfer you can download the Excel file in the company layout.')}</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

// ───── Give IDs (HR) ─────
function GiveIdsAction({ list, onClose, onDone }: { list: Employee[]; onClose: () => void; onDone: (m: string) => void }) {
  const { L, n } = usePrefs()
  const waiting = useMemo(() => list.filter(e => e.status === 'applicant' && !e.employee_code), [list])
  const q = useLoad(async () => {
    if (!waiting.length) return { ready: [] as Employee[], draft: [] as Employee[], codes: [] as string[] }
    const apps = await hr.applications()
    const ok = new Set(apps.filter(a => a.status === 'submitted').map(a => a.employee_id))
    const ready = waiting.filter(e => ok.has(e.id))
    return { ready, draft: waiting.filter(e => !ok.has(e.id)), codes: ready.length ? await staffAdmin.nextCodes(ready.length) : [] }
  }, [waiting.map(e => e.id).join(',')])
  const ready = q.data?.ready ?? []
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const codeOf = (i: number, id: string) => edited[id] ?? q.data?.codes[i] ?? ''
  async function go() {
    setErr('')
    const items = ready.map((e, i) => ({ employee_id: e.id, employee_code: codeOf(i, e.id).trim() }))
    if (!items.length) return setErr(L('কারও আবেদন জমা হয়নি', 'No submitted applications here'))
    if (items.some(x => !x.employee_code)) return setErr(L('প্রত্যেকের জন্য একটা আইডি দিন', 'Give every person an ID'))
    setBusy(true)
    try {
      const made = await staffAdmin.bulkAssignIds(items, note.trim() || 'Bulk ID assignment')
      onDone(L(`${n(made)} জনকে এমপ্লয়ি আইডি দেওয়া হয়েছে`, `${made} staff given an Employee ID`))
    } catch (e) { setErr(formatFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal wide title={L('এমপ্লয়ি আইডি দিন', 'Give Employee IDs')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      <button disabled={busy || !ready.length} onClick={() => void go()}>{L('আইডি দিন', 'Give IDs')}</button></>}>
    {q.error ? <p className="da-error">{formatFriendly(q.error)}</p> : null}
    {!waiting.length ? <p className="muted">{L('বাছাই করা কেউ আইডির অপেক্ষায় নেই। যাঁদের এখনো আইডি নেই তাঁদের বাছাই করুন।', 'None of the selected are waiting for an ID.')}</p> : <>
      {!!q.data?.draft.length && <p className="notice">{L('এঁদের আবেদন এখনো জমা হয়নি, তাই আইডি দেওয়া যাবে না — প্রোফাইলে গিয়ে বাকি তথ্য দিয়ে “আবেদন জমা দিন” চাপুন: ',
        'These applications are not submitted yet, so no ID can be given — open the profile, fill in the rest and submit: ')}{q.data.draft.map(e => e.full_name).join(', ')}</p>}
      {!!ready.length && <>
        <p className="muted small">{L('পরের খালি নম্বরগুলো বসানো আছে — দরকার হলে বদলান। সবগুলো একসাথে হয়, একটাতে সমস্যা হলে কোনোটাই হবে না।',
          'The next free numbers are filled in — change them if you need to. It is all or nothing.')}</p>
        <div className="da-table-wrap"><table className="da-table">
          <thead><tr><th>{L('নাম', 'Name')}</th><th>{L('মোবাইল', 'Mobile')}</th><th>{L('এমপ্লয়ি আইডি', 'Employee ID')}</th></tr></thead>
          <tbody>{ready.map((e, i) => <tr key={e.id}><td>{e.full_name}</td><td>{e.mobile ?? '—'}</td>
            <td><input value={codeOf(i, e.id)} aria-label={e.full_name} onChange={ev => setEdited({ ...edited, [e.id]: ev.target.value })} /></td></tr>)}</tbody></table></div>
        <Field label={L('নোট', 'Note')}><input value={note} onChange={e => setNote(e.target.value)} placeholder={L('যেমন: পুরনো কর্মীদের আইডি', 'e.g. IDs for existing staff')} /></Field>
      </>}
    </>}
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

// ───── Wrong entry removal ─────
function RemoveWrong({ list, onClose, onDone }: { list: Employee[]; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr('')
    if (!reason.trim()) return setErr('কারণ লিখুন')
    setBusy(true)
    let ok = 0; const bad: string[] = []
    for (const e of list) {
      try { await hr.removeWrongEntry(e.id, reason.trim()); ok++ } catch (x) { bad.push(`${e.employee_code ?? ''} ${e.full_name}: ${hrFriendly(x)}`) }
    }
    setBusy(false)
    if (ok && !bad.length) return onDone(`${bn(ok)} জনের ভুল এন্ট্রি মোছা হয়েছে`)
    if (ok) onDone(`${bn(ok)} জনের মোছা হয়েছে, ${bn(bad.length)} জনের হয়নি: ${bad.join(' · ')}`)
    else setErr(bad.join(' · '))
  }
  return <Modal title="ভুল এন্ট্রি — মুছুন" onClose={onClose}
    actions={<><button type="button" className="secondary" onClick={onClose}>বাতিল</button><button type="button" className="danger" disabled={busy} onClick={() => void go()}>{busy ? 'হচ্ছে…' : 'মুছুন'}</button></>}>
    <Names list={list} />
    <p>ভুল করে ওঠা রেকর্ডের জন্য (ভুল লোক, একই লোক দুবার, পরীক্ষার এন্ট্রি)। রেকর্ডটি সব তালিকা থেকে সরে যাবে, আর তার আইডি ও মোবাইল নম্বর আবার ব্যবহার করা যাবে। লগইন থাকলে সেটা বন্ধ হবে।</p>
    <p className="muted small">কারো নামে হাজিরা, হিসাব, বেতন বা ছুটির রেকর্ড থাকলে তাঁকে এভাবে মোছা যাবে না — আইডি ভুল হলে প্রোফাইল থেকে “আইডি সংশোধন” করুন। কিছুই চিরতরে মুছে যায় না; অডিট লগে থাকে।</p>
    <Field label="কারণ" required><input value={reason} onChange={e => setReason(e.target.value)} placeholder="যেমন: একই লোক দুবার উঠেছে" /></Field>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

// ───── Hub-manager request modals (lifecycle.* → zonal approves) ─────
function LeaveRequestModal({ emp, decides, onClose, onDone }: { emp: Employee; decides: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const { L } = usePrefs()
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(todayDhaka())
  const [type, setType] = useState<'resigned' | 'terminated'>('resigned')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr('')
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter the reason'))
    setBusy(true)
    try {
      await lifecycle.leave(emp.id, reason.trim(), date, decides ? type : null)
      onDone(decides ? L(`${emp.full_name} — সম্পন্ন। এক্সিট ফাইল HR রেকর্ডে আছে।`, `${emp.full_name} — done. The exit file is in HR records.`)
        : L('অনুরোধ পাঠানো হয়েছে — জোনাল ম্যানেজারের অনুমোদনের অপেক্ষায়', 'Request sent — waiting for the zonal manager'))
    } catch (e) { setErr(lifeFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L('চাকরি ছেড়ে দিয়েছে', 'Left the job')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      <button className={decides ? 'danger' : ''} disabled={busy} onClick={() => void go()}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : decides ? L('নিশ্চিত করুন', 'Confirm') : L('অনুরোধ পাঠান', 'Send request')}</button></>}>
    <Who emp={emp} />
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      {decides && <Field label={L('ধরন', 'Type')}><select value={type} onChange={e => setType(e.target.value as 'resigned' | 'terminated')}>
        <option value="resigned">{L('চাকরি ছেড়েছেন', 'Resigned')}</option><option value="terminated">{L('অব্যাহতি (অফিস থেকে বাদ)', 'Terminated')}</option></select></Field>}
      <Field label={L('শেষ কর্মদিবস', 'Last working day')}><input type="date" value={date} max={todayDhaka()} onChange={e => setDate(e.target.value)} /></Field>
      <Field wide required label={L('কারণ', 'Reason')}><textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: অন্য চাকরিতে যোগ দিয়েছেন', 'e.g. joined another job')} /></Field>
    </div>
    <p className="muted small">{decides ? L('নিশ্চিত করলে এখনই কার্যকর হবে: আইডি বন্ধ হবে, চূড়ান্ত হিসাবসহ এক্সিট ফাইল তৈরি হবে।', 'This takes effect now: the ID is closed and an exit file with final accounts is made.')
      : L('জোনাল ম্যানেজার অনুমোদন না করা পর্যন্ত নামটি তালিকায় “অপেক্ষমাণ” চিহ্নসহ থাকবে।', 'The name stays on the list, marked “waiting”, until the zonal manager approves.')}</p>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

function TransferRequestModal({ emp, hubs, onClose, onDone }: { emp: Employee; hubs: Array<{ value: string; label: string; sub?: string }>; onClose: () => void; onDone: (m: string) => void }) {
  const { L } = usePrefs()
  const [to, setTo] = useState(''); const [date, setDate] = useState(todayDhaka()); const [reason, setReason] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr('')
    if (!to) return setErr(L('নতুন হাব বেছে নিন', 'Choose the new hub'))
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter the reason'))
    setBusy(true)
    try {
      await lifecycle.transfer(emp.id, to, date, reason.trim())
      onDone(L(`${emp.full_name} → ${hubs.find(h => h.value === to)?.label ?? ''} বদলি হয়েছে। ট্রান্সফার ফাইল HR রেকর্ডে আছে।`, `${emp.full_name} transferred. The transfer file is in HR records.`))
    } catch (e) { setErr(lifeFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L('অন্য হাবে বদলি', 'Transfer to another hub')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void go()}>{busy ? L('হচ্ছে…', 'Working…') : L('বদলি নিশ্চিত করুন', 'Confirm transfer')}</button></>}>
    <Who emp={emp} />
    <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Field required label={L('নতুন হাব', 'New hub')}><Combo value={to} onChange={setTo} options={hubs} /></Field>
      <Field label={L('কবে থেকে', 'From')}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field wide required label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: নতুন হাবে রাইডার কম', 'e.g. the new hub is short of riders')} /></Field>
    </div>
    <p className="muted small">{L('পুরোনো হাবের দায়িত্ব বন্ধ হয়ে নতুন হাবে খুলবে, দুই হাবের ম্যানেজার নোটিফিকেশন পাবেন।', 'The old hub assignment closes, the new one opens, and both hub managers are notified.')}</p>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

function JoinRequestModal({ hub, decides, onClose, onDone }: { hub: { id: string; name: string; zone_id: string }; decides: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const { L, lang } = usePrefs()
  const o = useOrg()
  const form = useLoad(async () => {
    const [formats, custom] = await Promise.all([staffAdmin.formats(), customFields()])
    const format = pickJoinFormat(formats, hub.zone_id)
    return { format, fields: joinFields(format, custom, lang) }
  }, [hub.zone_id, lang])
  const [v, setV] = useState<Record<string, string>>({ full_name: '', mobile: '', joining_date: todayDhaka() })
  const [position, setPosition] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [tried, setTried] = useState(false)
  const set = (k: string, x: string) => { setErr(''); setV(s => ({ ...s, [k]: x })) }
  useEffect(() => { const p = o.data?.positions ?? []; if (!position && p.length === 1) setPosition(p[0].id) }, [o.data, position])

  async function go() {
    setErr(''); setTried(true)
    if (v.full_name.trim().length < 2) return setErr(L('পুরো নাম লিখুন', 'Enter the full name'))
    if (!BD_MOBILE.test(cleanMobile(v.mobile))) return setErr(L('সঠিক মোবাইল নম্বর দিন (যেমন 01711000000)', 'Enter a valid mobile number'))
    if (!position) return setErr(L('পদবি বেছে নিন', 'Choose the position'))
    const miss = (form.data?.fields ?? []).find(f => f.required && !(v[f.key] ?? '').trim())
    if (miss) return setErr(L(`“${miss.label}” ঘরটি পূরণ করুন`, `Fill in “${miss.label}”`))
    setBusy(true)
    try {
      const data: Record<string, string> = {}
      for (const [k, x] of Object.entries(v)) if (x.trim()) data[k] = k === 'mobile' || k === 'emergency_contact_phone' ? cleanMobile(x) : x.trim()
      await lifecycle.join(hub.id, position, data)
      onDone(decides ? L('আবেদন জমা হয়েছে — অন্য একজন অনুমোদন করবেন', 'Submitted — another person will approve it')
        : L('আবেদন পাঠানো হয়েছে — জোনাল ম্যানেজারের অনুমোদনের অপেক্ষায়', 'Sent — waiting for the zonal manager'))
    } catch (e) { setErr(lifeFriendly(e)) } finally { setBusy(false) }
  }
  const box = (f: JoinField) => f.type === 'select' ? <select value={v[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}><option value="">—</option>
      {f.options?.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
    : f.type === 'textarea' ? <textarea rows={2} value={v[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />
    : f.type === 'phone' ? <TextInput kind="phone" value={v[f.key] ?? ''} onChange={x => set(f.key, x)} placeholder="01XXXXXXXXX" rules={[rules.mobile()]} showError={tried} />
    : <input type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} value={v[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />

  return <Modal wide title={L('নতুন স্টাফ যোগ', 'Add new staff')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy || form.loading} onClick={() => void go()}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('আবেদন পাঠান', 'Send request')}</button></>}>
    <p className="lc-who"><Icon name="hub" size={16} /><b>{hub.name}</b>{form.data?.format && <span>· {L('ফরম্যাট', 'Format')}: {lang === 'bn' && form.data.format.name_bn ? form.data.format.name_bn : form.data.format.name}</span>}</p>
    <div className="hr-form">
      <Field required label={L('পুরো নাম', 'Full name')}><input value={v.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Md. Rahim Uddin" autoComplete="off" /></Field>
      <Field required label={L('মোবাইল', 'Mobile')}><TextInput kind="phone" value={v.mobile} onChange={x => set('mobile', x)} placeholder="01XXXXXXXXX" rules={[rules.required('মোবাইল নম্বর'), rules.mobile()]} showError={tried} /></Field>
      <Field required label={L('পদবি', 'Position')}><Combo value={position} onChange={setPosition}
        options={(o.data?.positions ?? []).map(p => ({ value: p.id, label: o.names.pos[p.id] ?? p.name, sub: o.names.dept[p.department_id] }))} /></Field>
      {(form.data?.fields ?? []).map(f => <Field key={f.key} label={f.label} required={f.required} wide={f.type === 'textarea'}>{box(f)}</Field>)}
    </div>
    {form.loading && <p className="muted small">{L('ফরম লোড হচ্ছে…', 'Loading the form…')}</p>}
    <p className="muted small">{decides ? L('দুই-জনের নিয়ম: আপনার পাঠানো আবেদন আপনি নিজে অনুমোদন করতে পারবেন না — অন্য একজন (এইচআর / অ্যাডমিন) অনুমোদন করবেন।', 'Two-person rule: you cannot approve your own request — HR or an admin will.')
      : L('জোনাল ম্যানেজার অনুমোদন করলে এমপ্লয়ি আইডি তৈরি হবে আর স্টাফ সক্রিয় তালিকায় আসবেন।', 'Once the zonal manager approves, the Employee ID is made and the person joins the active list.')}</p>
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}
