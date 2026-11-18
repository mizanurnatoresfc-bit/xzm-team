// Advanced Role & Permission Management — one place for: roles and what they may do, each person's access,
// the hub / zone their data is limited to, the history of every change, and the Super Admin's own controls.
import { useMemo, useState } from 'react'
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Badge, Stat, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { access, reachOf, type Override } from '../../lib/access'
import { type RoleRow } from '../../lib/roles'
import { userFriendly, users, type UserRow } from '../../lib/users'
import { isSuperGrant, roleName, useAccessBase } from './common'
import { UsersTab } from './UsersTab'
import { ScopeTab } from './ScopeTab'
import { HistoryTab } from './HistoryTab'
import { SuperTab } from './SuperTab'

export type CenterData = {
  base: ReturnType<typeof useAccessBase>
  /** null while loading or when the viewer may not list accounts */
  people: UserRow[] | null
  peopleError: unknown
  reloadPeople: () => void
  /** personal permissions of everyone; `installed` false = the database part is not applied yet */
  overrides: Override[]
  installed: boolean
  reloadOverrides: () => void
  sup: boolean
}

const TABS: Array<[key: string, bn: string, en: string, icon: string]> = [
  ['overview', 'সারসংক্ষেপ', 'Overview', 'dash'],
  ['roles', 'রোল ও অনুমতি', 'Roles & permissions', 'shield'],
  ['users', 'ইউজারের অ্যাক্সেস', 'User access', 'users'],
  ['scope', 'হাব ও জোনের সীমা', 'Hub & zone limits', 'map'],
  ['history', 'বদলের ইতিহাস', 'Change history', 'log'],
  ['super', 'সুপার অ্যাডমিন', 'Super Admin', 'key'],
]

export function AccessCenter() {
  const { section = 'overview' } = useParams()
  const tab = TABS.some(t => t[0] === section) ? section : 'overview'
  const { grants } = useAuth()
  const { L } = usePrefs()
  const nav = useNavigate()
  const sup = isSuperGrant(grants)
  const base = useAccessBase()
  const peopleQ = useLoad(() => users.list(), [])
  const ovQ = useLoad(async () => {
    try { const rows = await access.overrides(null); return { installed: rows !== null, rows: rows ?? [] } }
    catch { return { installed: true, rows: [] as Override[] } }   // installed, but this viewer may not read them
  }, [])
  const data: CenterData = { base, people: peopleQ.data, peopleError: peopleQ.error, reloadPeople: () => void peopleQ.reload(),
    overrides: ovQ.data?.rows ?? [], installed: ovQ.data?.installed ?? true, reloadOverrides: () => void ovQ.reload(), sup }

  return <AppShell title={L('অ্যাডভান্সড রোল ও পারমিশন', 'Advanced Role & Permission Management')}
    subtitle={L('কে কোন মডিউল ও সাব-মেনুতে কী করতে পারবে, কোন হাব বা জোনের তথ্য দেখবে — সব এখান থেকে।', 'Who may do what in which module and sub-menu, and which hub or zone they see — all from here.')}
    actions={sup && (tab === 'roles' || tab === 'overview') ? <button onClick={() => nav('/app/access/role/new')}><Icon name="plus" size={16} />{L('নতুন রোল', 'New role')}</button> : null}>
    <nav className="rq-tabs ax-tabs no-print" aria-label={L('অংশ', 'Sections')}>
      {TABS.map(([k, bn, en, ic]) => <NavLink key={k} to={k === 'overview' ? '/app/access' : `/app/access/${k}`} end className={`rq-tab ax-tab${tab === k ? ' on' : ''}`}><Icon name={ic} size={15} />{L(bn, en)}</NavLink>)}
    </nav>
    {!sup && <p className="notice">{L('আপনি শুধু দেখতে পারেন। রোল, অনুমতি বা কারও অ্যাক্সেস বদলানো শুধু সুপার অ্যাডমিন পারেন।', 'You can only view. Only the Super Admin changes roles, permissions or anyone’s access.')}</p>}
    {base.error ? <p className="da-error">{userFriendly(base.error)}</p> : null}
    {tab === 'overview' && <Overview d={data} />}
    {tab === 'roles' && <RolesTab d={data} />}
    {tab === 'users' && <UsersTab d={data} />}
    {tab === 'scope' && <ScopeTab d={data} />}
    {tab === 'history' && <HistoryTab d={data} />}
    {tab === 'super' && <SuperTab d={data} />}
  </AppShell>
}

const soon = (d: string | null, days: number) => { if (!d) return false; const t = new Date(`${d}T23:59:59+06:00`).getTime() - Date.now(); return t >= 0 && t <= days * 86_400_000 }

// ---------------------------------------------------------------- overview
function Overview({ d }: { d: CenterData }) {
  const { L, n, lang } = usePrefs()
  const list = (d.base.data?.list ?? []).filter(r => !r.archived_at)
  const people = (d.people ?? []).filter(u => !u.archived_at)
  const live = d.overrides.filter(o => o.live)
  const supers = people.filter(u => u.status === 'active' && u.roles.some(r => r.is_super))
  const whole = people.filter(u => u.status === 'active' && !u.roles.some(r => r.is_super) && reachOf(u.roles) === 'global')
  const limited = Object.values(d.base.menuByRole).filter(m => m !== null).length

  // things worth a look, worked out from the data
  const notes: Array<{ tone: 'warn' | 'info'; icon: string; text: string; to: string }> = []
  const noRole = people.filter(u => u.status === 'active' && !u.roles.length)
  if (noRole.length) notes.push({ tone: 'warn', icon: 'userx', to: '/app/access/users?reach=none', text: L(`${n(noRole.length)} জনের লগইন আছে কিন্তু কোনো রোল নেই — লগইন করেও কিছু দেখবেন না।`, `${noRole.length} accounts can sign in but hold no role — they see nothing.`) })
  if (d.people && supers.length === 1) notes.push({ tone: 'warn', icon: 'key', to: '/app/access/super', text: L('সুপার অ্যাডমিন মাত্র একজন। তাঁর পাসওয়ার্ড হারালে কেউ ঠিক করতে পারবে না — বিশ্বস্ত আরেকজনকে রাখুন।', 'There is only one Super Admin. If that password is lost nobody can fix it — keep a second trusted one.') })
  if (whole.length) notes.push({ tone: 'info', icon: 'globe', to: '/app/access/scope', text: L(`${n(whole.length)} জন পুরো কোম্পানির সব হাবের তথ্য দেখেন। দরকার না হলে তাঁদের জোন বা হাবে সীমিত করুন।`, `${whole.length} people see every hub of the company. Limit them to a zone or hub if that is not needed.`) })
  const unused = list.filter(r => !r.is_system && !r.user_count)
  if (unused.length) notes.push({ tone: 'info', icon: 'shield', to: '/app/access/roles?kind=custom', text: L(`নিজের বানানো ${n(unused.length)}টি রোল কাউকে দেওয়া হয়নি: ${unused.slice(0, 3).map(r => roleName(r, lang)).join(', ')}${unused.length > 3 ? ' …' : ''}`, `${unused.length} custom roles are given to nobody: ${unused.slice(0, 3).map(r => r.name).join(', ')}${unused.length > 3 ? ' …' : ''}`) })
  const off = list.filter(r => r.status !== 'active')
  if (off.length) notes.push({ tone: 'warn', icon: 'alert', to: '/app/access/roles', text: L(`${n(off.length)}টি রোল বন্ধ রাখা আছে: ${off.map(r => roleName(r, lang)).join(', ')}`, `${off.length} roles are switched off: ${off.map(r => r.name).join(', ')}`) })
  const empty = list.filter(r => !r.is_super && !r.permission_count && r.user_count > 0)
  if (empty.length) notes.push({ tone: 'warn', icon: 'alert', to: '/app/access/roles', text: L(`${empty.map(r => roleName(r, lang)).join(', ')} — এই রোলে কোনো অনুমতি নেই অথচ লোক আছে।`, `${empty.map(r => r.name).join(', ')} — no permissions, yet people hold it.`) })
  const ending = live.filter(o => soon(o.valid_to, 7))
  if (ending.length) notes.push({ tone: 'info', icon: 'clock', to: '/app/access/users?own=1', text: L(`${n(ending.length)}টি ব্যক্তিগত অনুমতির মেয়াদ ৭ দিনের মধ্যে শেষ হবে।`, `${ending.length} personal permissions end within 7 days.`) })
  const rolesEnding = people.flatMap(u => u.roles.filter(r => soon(r.valid_to, 7)).map(() => u))
  if (rolesEnding.length) notes.push({ tone: 'info', icon: 'clock', to: '/app/access/users', text: L(`${n(rolesEnding.length)}টি অস্থায়ী রোলের মেয়াদ ৭ দিনের মধ্যে শেষ হবে।`, `${rolesEnding.length} temporary role assignments end within 7 days.`) })

  const guide: Array<[bn: string, en: string, how_bn: string, how_en: string, to: string, icon: string]> = [
    ['নতুন রোল বানানো', 'Dynamic Role Creation', 'যত খুশি রোল বানান, কপি করুন, বন্ধ রাখুন বা আর্কাইভ করুন', 'Create as many roles as you like; copy, switch off or archive them', '/app/access/role/new', 'plus'],
    ['নিজের মতো অনুমতি সাজানো', 'Custom Permission Builder', 'রোল খুলে টিক দিয়ে সাজান — “সব / শুধু দেখা / কাজ করবে / কিছুই না” এক চাপে', 'Open a role and tick — “all / view only / work / nothing” in one tap', '/app/access/roles', 'grid'],
    ['মডিউল ধরে অনুমতি', 'Module-wise Permission', 'প্রতিটি মডিউলের (হিসাব, এইচআর, অফিস…) অনুমতি আলাদা, পুরো মডিউল একসাথে চালু-বন্ধ', 'Each module (accounts, HR, office…) on its own; a whole module on or off at once', '/app/access/roles', 'table'],
    ['সাব-মেনু ধরে অনুমতি', 'Sub-menu Permission', 'প্রতিটি সাব-মেনু (পাতা) আলাদা করে চালু বা বন্ধ — বন্ধ পাতা মেনুতেও আসে না, ঠিকানা লিখেও খোলে না', 'Each sub-menu (page) on or off — an off page is neither in the menu nor opens by its address', '/app/access/roles', 'menu'],
    ['দেখা · তৈরি · এডিট · ডিলিট · অনুমোদন · এক্সপোর্ট', 'View / Create / Edit / Delete / Approve / Export Access', 'প্রতিটি সাব-মেনুতে ছয় রকম কাজের আলাদা টিক', 'Six separate ticks on every sub-menu', '/app/access/roles', 'checkall'],
    ['হাব অনুযায়ী তথ্যের সীমা', 'Hub-wise Data Restriction', 'কাউকে এক বা একাধিক হাবে সীমিত করুন — অন্য হাবের তথ্য ডাটাবেসই দেয় না', 'Limit someone to one or more hubs — the database itself hides every other hub', '/app/access/scope?kind=hub', 'hub'],
    ['জোন অনুযায়ী তথ্যের সীমা', 'Zone-wise Data Restriction', 'কাউকে এক বা একাধিক জোনে সীমিত করুন — সেই জোনের সব হাব, এর বাইরে কিছু নয়', 'Limit someone to one or more zones — every hub inside, nothing outside', '/app/access/scope?kind=zone', 'map'],
    ['একজনের জন্য আলাদা অনুমতি', 'Individual User Override', 'রোল না বদলে একজনকে বাড়তি অনুমতি দিন বা কোনো অনুমতি বন্ধ করুন — মেয়াদসহ', 'Give one person something extra or switch something off without touching the role — with an end date', '/app/access/users', 'user'],
    ['অনুমতি বদলের ইতিহাস', 'Permission Change History', 'কে, কখন, কার কী বদলেছে, কেন — সব লেখা থাকে; এক্সেল/পিডিএফ নেওয়া যায়', 'Who changed what for whom, when and why — all recorded; Excel / PDF', '/app/access/history', 'log'],
    ['সুপার অ্যাডমিনের পূর্ণ নিয়ন্ত্রণ', 'Super Admin Full Control', 'সুপার অ্যাডমিনের সব ক্ষমতা সবসময় থাকে; শুধু তিনিই এই পাতার সব কিছু বদলাতে পারেন', 'The Super Admin always holds everything; only they change anything here', '/app/access/super', 'key'],
  ]

  return <>
    <div className="da-stats">
      <Stat icon="shield" label={L('রোল', 'Roles')} value={n(list.length)} sub={`${n(list.filter(r => !r.is_system).length)} ${L('টি নিজের বানানো', 'custom')}`} />
      <Stat icon="users" label={L('লগইন অ্যাকাউন্ট', 'Login accounts')} value={d.people ? n(people.length) : '—'} sub={d.people ? `${n(people.filter(u => u.status === 'active').length)} ${L('সক্রিয়', 'active')}` : undefined} />
      <Stat icon="menu" label={L('পাতা সীমিত করা রোল', 'Roles with a page list')} value={n(limited)} />
      <Stat icon="globe" label={L('পুরো কোম্পানি দেখেন', 'See the whole company')} value={d.people ? n(whole.length) : '—'} />
      <Stat icon="user" label={L('ব্যক্তিগত অনুমতি', 'Personal permissions')} value={d.installed ? n(live.length) : '—'}
        sub={d.installed ? `+${n(live.filter(o => o.effect === 'grant').length)} / −${n(live.filter(o => o.effect === 'deny').length)}` : L('ডাটাবেস আপডেট বাকি', 'database update pending')} />
      <Stat icon="key" label={L('সুপার অ্যাডমিন', 'Super Admins')} value={d.people ? n(supers.length) : '—'} tone={d.people && supers.length === 1 ? 'warn' : undefined} />
    </div>

    <section className="panel">
      <h2>{L('নজর দিন', 'Worth a look')}</h2>
      {!notes.length ? <p className="ax-allok"><Icon name="checkall" size={18} />{d.base.loading || !d.people ? L('যাচাই হচ্ছে…', 'Checking…') : L('সব ঠিক আছে — এখন নজর দেওয়ার মতো কিছু নেই।', 'All good — nothing needs attention right now.')}</p>
        : <ul className="ax-notes">{notes.map((x, i) => <li key={i} className={`t-${x.tone}`}><span className="i"><Icon name={x.icon} size={18} /></span><span className="tx">{x.text}</span>
            <Link to={x.to} className="small">{L('দেখুন', 'Open')} →</Link></li>)}</ul>}
    </section>

    <section className="panel">
      <h2>{L('কোন কাজ কোথায়', 'Where to do what')}</h2>
      <div className="ax-guide">{guide.map(([bn, en, hb, he, to, ic], i) => <Link key={en} to={to} className="ax-g">
        <span className="no">{n(i + 1)}</span><span className="i"><Icon name={ic} size={20} /></span>
        <span className="tx"><b>{L(bn, en)}</b>{lang === 'bn' && <em>{en}</em>}<small>{L(hb, he)}</small></span><Icon name="chev" size={16} /></Link>)}</div>
    </section>
  </>
}

// ---------------------------------------------------------------- roles
function RolesTab({ d }: { d: CenterData }) {
  const { L, n, lang } = usePrefs()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const kind = sp.get('kind') ?? ''
  const [q, setQ] = useState('')
  const all = d.base.data?.list ?? []
  const mods = d.base.catalog.mods
  const rows = useMemo(() => all.filter(r => {
    if (kind === 'archived') return !!r.archived_at
    if (r.archived_at) return false
    if (kind === 'custom' && r.is_system) return false
    if (kind === 'system' && !r.is_system) return false
    const s = q.trim().toLowerCase()
    return !s || `${r.name} ${r.name_bn ?? ''} ${r.code} ${r.description ?? ''}`.toLowerCase().includes(s)
  }), [all, kind, q])
  const setKind = (k: string) => { const x = new URLSearchParams(sp); if (k) x.set('kind', k); else x.delete('kind'); setSp(x, { replace: true }) }
  const kinds: Array<[string, string, string, number]> = [
    ['', 'সব', 'All', all.filter(r => !r.archived_at).length], ['system', 'শুরুর রোল', 'Built-in', all.filter(r => !r.archived_at && r.is_system).length],
    ['custom', 'নিজের বানানো', 'Custom', all.filter(r => !r.archived_at && !r.is_system).length], ['archived', 'আর্কাইভ', 'Archived', all.filter(r => r.archived_at).length]]
  const cover = (r: RoleRow) => mods.map(m => ({ m, on: r.is_super ? m.codes.length : m.codes.filter(c => r.permissions.includes(c)).length })).filter(x => x.on > 0)

  return <>
    <section className="panel ax-filter no-print">
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('রোল খুঁজুন…', 'Search roles…')} aria-label={L('রোল খুঁজুন', 'Search roles')} />
      <div className="ax-chips">{kinds.map(([k, bn, en, c]) => <button key={k} type="button" className={`chip-toggle${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{L(bn, en)} <b>{n(c)}</b></button>)}</div>
    </section>
    {d.base.loading && !d.base.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : !rows.length ? <p className="muted">{L('কোনো রোল পাওয়া যায়নি।', 'No roles found.')}</p> : null}
    <div className="ax-roles">{rows.map(r => {
      const menu = d.base.menuByRole[r.id]
      const cv = cover(r)
      return <article key={r.id} className={`ax-role${r.status !== 'active' ? ' off' : ''}`} data-role={r.code} tabIndex={0} role="link"
        onClick={() => nav(`/app/access/role/${r.id}`)} onKeyDown={e => { if (e.key === 'Enter') nav(`/app/access/role/${r.id}`) }}>
        <header><span className="i"><Icon name={r.is_super ? 'key' : 'shield'} size={20} /></span>
          <span className="tx"><b>{roleName(r, lang)}</b><small className="no-bn">{lang === 'bn' && r.name_bn ? r.name : r.code}</small></span>
          {r.is_super ? <Badge tone="bad">{L('সব ক্ষমতা', 'Full control')}</Badge> : r.is_system ? <Badge tone="neutral">{L('শুরুর রোল', 'Built-in')}</Badge> : <Badge tone="info">{L('নিজের বানানো', 'Custom')}</Badge>}</header>
        {r.description && <p className="muted small">{r.description}</p>}
        <p className="ax-nums"><span><b>{r.is_super ? L('সব', 'All') : n(r.permission_count)}</b> {L('অনুমতি', 'permissions')}</span><span><b>{n(r.user_count)}</b> {L('জন', 'people')}</span>
          <span>{r.is_super || !menu ? L('সব পাতা', 'Every page') : <><b>{n(menu.length)}</b> {L('টি পাতা', 'pages')}</>}</span></p>
        <p className="ax-cover">{cv.length ? cv.map(({ m, on }) => <span key={m.key} className={on === m.codes.length ? 'full' : ''} title={`${L(m.bn, m.en)}: ${on}/${m.codes.length}`}>{L(m.bn, m.en)}</span>)
          : <span className="none">{L('কোনো মডিউলে অনুমতি নেই', 'No module yet')}</span>}</p>
        <footer>{r.status !== 'active' && !r.archived_at ? <Badge tone="warn">{L('বন্ধ রাখা', 'Switched off')}</Badge> : null}{r.archived_at ? <Badge tone="neutral">{L('আর্কাইভ', 'Archived')}</Badge> : null}
          <span className="go">{d.sup && !r.is_super && !r.archived_at ? L('অনুমতি সাজান', 'Set permissions') : L('দেখুন', 'Open')} <Icon name="chev" size={14} /></span>
          {d.sup && !r.archived_at && <button type="button" className="secondary sm" onClick={e => { e.stopPropagation(); nav(`/app/access/role/new?copy=${r.id}`) }}>{L('কপি', 'Copy')}</button>}</footer>
      </article>
    })}</div>
  </>
}
