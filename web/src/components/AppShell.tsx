import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { isDark, usePrefs } from '../lib/prefs'
import { Icon } from './Icon'

type Item = { to: string; icon: string; bn: string; en: string; perms: string[] | null; count?: CountKey }
type Group = { key: string; icon: string; bn: string; en: string; items: Item[] }
type CountKey = 'apps' | 'leave' | 'sheets'

const HOME: Item[] = [
  { to: '/app', icon: 'dash', bn: 'ড্যাশবোর্ড', en: 'Dashboard', perms: null },
  { to: '/app/me', icon: 'user', bn: 'আমার প্রোফাইল', en: 'My profile', perms: null },
]
const GROUPS: Group[] = [
  { key: 'org', icon: 'map', bn: 'জোনাল ম্যানেজমেন্ট', en: 'Zonal Management', items: [
    { to: '/app/org', icon: 'org', bn: 'জোন, হাব ও পদ', en: 'Zones, hubs & posts', perms: ['org.zone.view', 'org.hub.view', 'org.department.view'] },
    { to: '/app/zonal/staff', icon: 'users', bn: 'হাব অনুযায়ী কর্মী', en: 'Staff by hub', perms: ['hr.employee.view'] },
  ] },
  { key: 'staff', icon: 'users', bn: 'স্টাফ ম্যানেজমেন্ট', en: 'Staff Management', items: [
    { to: '/app/hr', icon: 'chart', bn: 'HR ড্যাশবোর্ড', en: 'HR dashboard', perms: ['hr.employee.view'] },
    { to: '/app/hr/employees', icon: 'users', bn: 'কর্মী', en: 'Employees', perms: ['hr.employee.view', 'hr.application.create'] },
    { to: '/app/hr/referrals', icon: 'users', bn: 'রেফারেন্স', en: 'Referrals', perms: ['hr.referral.view'] },
    { to: '/app/hr/fields', icon: 'form', bn: 'প্রোফাইলের ঘর ও কলাম', en: 'Profile fields', perms: ['hr.profile_field.configure', 'hr.referral.configure'] },
    { to: '/app/hr/import', icon: 'upload', bn: 'কর্মী ইমপোর্ট (Excel)', en: 'Import employees', perms: ['hr.import.create'] },
    { to: '/app/hr/applications', icon: 'form', bn: 'আইডি আবেদন', en: 'ID applications', perms: ['hr.application.view', 'hr.application.create'], count: 'apps' },
    { to: '/app/hr/attendance', icon: 'cal', bn: 'হাজিরা', en: 'Attendance', perms: ['hr.attendance.view', 'hr.attendance.create'] },
    { to: '/app/hr/leave', icon: 'log', bn: 'ছুটি', en: 'Leave', perms: ['hr.leave.view', 'hr.leave.create'], count: 'leave' },
  ] },
  { key: 'acc', icon: 'book', bn: 'হিসাব ম্যানেজমেন্ট', en: 'Accounts Management', items: [
    { to: '/app/accounts/daily', icon: 'ledger', bn: 'আজকের হিসাব খাতা', en: 'Daily accounts', perms: null, count: 'sheets' },
    { to: '/app/accounts/mine', icon: 'wallet', bn: 'আমার হিসাব', en: 'My accounts', perms: null },
    { to: '/app/accounts/reports', icon: 'chart', bn: 'হিসাবের রিপোর্ট', en: 'Accounts reports', perms: ['da.report.view'] },
    { to: '/app/accounts/settings', icon: 'gear', bn: 'হিসাব সেটিংস', en: 'Accounts settings', perms: ['da.settings.configure'] },
  ] },
  { key: 'sys', icon: 'shield', bn: 'সিস্টেম', en: 'System', items: [
    { to: '/app/users', icon: 'key', bn: 'ইউজার ও রোল', en: 'Users & roles', perms: ['system.user.view'] },
    { to: '/app/roles', icon: 'shield', bn: 'রোল ও অনুমতি', en: 'Roles & permissions', perms: ['system.role.view'] },
  ] },
]

// ---- small caches so the frame does not refetch on every page ----
type MyRole = { code: string; name: string; scope_type: string; zone: string | null; hub: string | null }
let rolesCache: { user: string; at: number; p: Promise<MyRole[]> } | null = null
let countCache: { key: string; at: number; p: Promise<Record<CountKey, number>> } | null = null
function myRoles(user: string): Promise<MyRole[]> {
  if (rolesCache && rolesCache.user === user && Date.now() - rolesCache.at < 300_000) return rolesCache.p
  const p = (async () => {
    const { data } = await supabase.from('user_roles').select('scope_type, zone_id, hub_id, revoked_at, roles(code, name), zones(name), hubs(name)').eq('user_id', user).is('revoked_at', null)
    return ((data ?? []) as Array<Record<string, unknown>>).map(r => {
      const role = (r.roles ?? {}) as { code?: string; name?: string }
      return { code: role.code ?? '', name: role.name ?? '', scope_type: String(r.scope_type ?? ''),
        zone: ((r.zones ?? null) as { name?: string } | null)?.name ?? null, hub: ((r.hubs ?? null) as { name?: string } | null)?.name ?? null }
    })
  })().catch(() => [])
  rolesCache = { user, at: Date.now(), p }; return p
}
async function countOf(table: string, col: string, val: string): Promise<number> {
  const res = await supabase.from(table).select('id', { count: 'exact', head: true }).eq(col, val) as { count?: number | null; data?: unknown[] | null; error?: unknown }
  if (res.error) return 0
  return res.count ?? (Array.isArray(res.data) ? res.data.length : 0)
}
function counts(user: string, can: (p: string) => boolean): Promise<Record<CountKey, number>> {
  const key = [user, can('hr.application.approve'), can('hr.leave.approve'), can('da.sheet.approve')].join('|')
  if (countCache && countCache.key === key && Date.now() - countCache.at < 60_000) return countCache.p
  const p = Promise.all([
    can('hr.application.approve') ? countOf('employee_applications', 'status', 'submitted') : 0,
    can('hr.leave.approve') ? countOf('leave_requests', 'status', 'pending') : 0,
    can('da.sheet.approve') ? countOf('da_sessions', 'status', 'submitted') : 0,
  ]).then(([apps, leave, sheets]) => ({ apps, leave, sheets })).catch(() => ({ apps: 0, leave: 0, sheets: 0 }))
  countCache = { key, at: Date.now(), p }; return p
}
export function refreshShellCounts() { countCache = null }

function roleClass(code: string) {
  if (code === 'super_admin' || code === 'admin') return 'rb-super'
  if (/zonal|zone|head_office|operations/.test(code)) return 'rb-zone'
  if (/hub|pickup|delivery/.test(code)) return 'rb-hub'
  if (/account|auditor/.test(code)) return 'rb-acct'
  return 'rb-self'
}

/** Page frame for every signed-in screen: grouped icon menu, top bar (search, alerts, language, theme, profile), title row. */
export function AppShell({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const { can, signOut, session } = useAuth()
  const { L, n, lang, setLang, theme, setTheme } = usePrefs()
  const nav = useNavigate()
  const user = session?.user.id ?? ''
  const name = (session?.user.user_metadata?.full_name as string | undefined) || session?.user.email || ''
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [menuQ, setMenuQ] = useState('')
  const [pop, setPop] = useState<'bell' | 'me' | null>(null)
  const [roles, setRoles] = useState<MyRole[]>([])
  const [cnt, setCnt] = useState<Record<CountKey, number>>({ apps: 0, leave: 0, sheets: 0 })
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(sessionStorage.getItem('xzm_ng') || '{}') } catch { return {} } })
  const popRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (user) { void myRoles(user).then(setRoles); void counts(user, can).then(setCnt) } }, [user, can])
  useEffect(() => {
    if (!pop) return
    const f = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setPop(null) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null) }
    document.addEventListener('mousedown', f); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k) }
  }, [pop])
  useEffect(() => { document.title = `${title} · XZM-TEAM ERP` }, [title])

  const allowed = (p: string[] | null) => !p || p.some(x => can(x))
  const here = typeof location !== 'undefined' ? location.pathname : ''
  const mq = menuQ.trim().toLowerCase()
  const hit = (i: Item) => !mq || `${i.bn} ${i.en}`.toLowerCase().includes(mq)
  const top = roles[0]
  const scopeText = roles.length ? roles.map(r => `${r.name}${r.hub ? ` · ${r.hub}` : r.zone ? ` · ${r.zone}` : ''}`).join(' · ') : L('কোনো রোল নেই', 'No role')
  const alerts: Array<[string, number, string, string]> = ([
    ['/app/hr/applications', cnt.apps, L('আইডি আবেদন যাচাইয়ের অপেক্ষায়', 'ID applications waiting for review'), 'form'],
    ['/app/hr/leave', cnt.leave, L('ছুটির অনুরোধ অপেক্ষমাণ', 'Leave requests waiting'), 'log'],
    ['/app/accounts/daily', cnt.sheets, L('হিসাব খাতা যাচাইয়ের অপেক্ষায়', 'Daily sheets waiting for verification'), 'ledger'],
  ] as Array<[string, number, string, string]>).filter(a => a[1] > 0)
  const totalAlerts = alerts.reduce((a, x) => a + x[1], 0)
  const toggleGroup = (k: string, v: boolean) => { const g = { ...groupOpen, [k]: v }; setGroupOpen(g); try { sessionStorage.setItem('xzm_ng', JSON.stringify(g)) } catch { /* ignore */ } }
  const link = (i: Item) => <NavLink key={i.to} to={i.to} end className="nl"><Icon name={i.icon} size={16} /><span>{L(i.bn, i.en)}</span>
    {i.count && cnt[i.count] ? <span className="count">{n(cnt[i.count])}</span> : null}</NavLink>

  return <div className="app-frame">
    <aside className={`side no-print${open ? ' open' : ''}${mq ? ' searching' : ''}`} aria-label={L('মূল মেনু', 'Main menu')}>
      <Link to="/app" className="logo" onClick={() => setOpen(false)}><span className="brand-mark small">X</span><span>XZM-TEAM</span></Link>
      <div className="side-user"><span className="avatar" aria-hidden="true">{(name || '?').slice(0, 2)}</span>
        <div style={{ minWidth: 0 }}><b>{name}</b><div style={{ marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {roles.slice(0, 2).map((r, i) => <span key={i} className={`rb ${roleClass(r.code)}`}><Icon name="shield" size={12} />{r.name}</span>)}</div></div></div>
      <input className="side-search" type="search" value={menuQ} onChange={e => setMenuQ(e.target.value)} placeholder={L('মেনু খুঁজুন…', 'Search menu…')} aria-label={L('মেনু খুঁজুন', 'Search menu')} />
      {HOME.filter(i => allowed(i.perms) && hit(i)).map(link)}
      {GROUPS.map(g => {
        const vis = g.items.filter(i => allowed(i.perms) && (hit(i) || `${g.bn} ${g.en}`.toLowerCase().includes(mq)))
        if (!vis.length) return null
        const has = vis.some(i => i.to === here)
        const isOpen = groupOpen[g.key] ?? true
        const badge = vis.reduce((a, i) => a + (i.count ? cnt[i.count] : 0), 0)
        return <div key={g.key} className={`ngrp${isOpen ? ' open' : ''}${has ? ' has-on' : ''}`}>
          <button type="button" className="ngh" aria-expanded={isOpen} onClick={() => toggleGroup(g.key, !isOpen)}>
            <span className="gi"><Icon name={g.icon} size={16} />{badge > 0 && !isOpen ? <span className="gdot">{n(badge)}</span> : null}</span>
            <span className="t">{L(g.bn, g.en)}</span><span className="chev"><Icon name="chev" size={14} /></span></button>
          <div className="ngi" onClick={() => setOpen(false)}>{vis.map(link)}</div>
        </div>
      })}
      <div className="side-foot">{L('এই রোল যা খুলতে পারে মেনুতে শুধু সেটাই দেখায়।', 'The menu shows only what your role may open.')}</div>
    </aside>
    <div className={`side-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
    <div className="app-main">
      <header className="top no-print">
        <button className="icon menu-btn" aria-label={L('মেনু', 'Menu')} aria-expanded={open} onClick={() => setOpen(o => !o)}><Icon name="menu" /></button>
        <form className="search" role="search" onSubmit={e => { e.preventDefault(); if (q.trim()) nav(`/app/hr/employees?q=${encodeURIComponent(q.trim())}`) }}>
          <Icon name="search" size={16} /><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('কর্মীর নাম, আইডি বা মোবাইল খুঁজুন…', 'Search employee name, ID or mobile…')} aria-label={L('খুঁজুন', 'Search')} />
        </form>
        <span className="spacer" />
        <div className="rel" ref={pop === 'bell' ? popRef : undefined}>
          <button className="icon" aria-label={L('নোটিফিকেশন', 'Notifications')} onClick={() => setPop(pop === 'bell' ? null : 'bell')}><Icon name="bell" />
            {totalAlerts > 0 && <span className="dotn">{n(totalAlerts)}</span>}</button>
          {pop === 'bell' && <div className="top-pop" role="menu"><div className="hd">{L('অপেক্ষমাণ কাজ', 'Waiting for you')}</div>
            {alerts.length ? alerts.map(([to, c, t, ic]) => <Link key={to} to={to} onClick={() => setPop(null)}><Icon name={ic} size={16} /><span style={{ flex: 1 }}>{t}</span><span className="count">{n(c)}</span></Link>)
              : <div className="muted small" style={{ padding: '6px 10px' }}>{L('এখন কিছু অপেক্ষমাণ নেই', 'Nothing waiting right now')}</div>}</div>}
        </div>
        <button className="secondary sm hide-sm" onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')} aria-label="Language"><Icon name="globe" size={15} />{lang === 'bn' ? 'English' : 'বাংলা'}</button>
        <button className="icon" aria-label={L('ডার্ক / লাইট মোড', 'Dark / light mode')} onClick={() => setTheme(isDark(theme) ? 'light' : 'dark')}><Icon name="sun" /></button>
        <div className="rel" ref={pop === 'me' ? popRef : undefined}>
          <button className="icon" aria-label={L('প্রোফাইল', 'Profile')} onClick={() => setPop(pop === 'me' ? null : 'me')} style={{ borderRadius: '50%', fontWeight: 700, fontSize: 13 }}>{(name || '?').slice(0, 2).toUpperCase()}</button>
          {pop === 'me' && <div className="top-pop" role="menu">
            <div className="hd" style={{ color: 'var(--text)' }}>{name}</div>
            <div className="muted small" style={{ padding: '0 10px 6px' }}>{top ? scopeText : L('কোনো রোল নেই', 'No role')}</div>
            <button className="mi" onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}><Icon name="globe" size={16} />{lang === 'bn' ? 'English' : 'বাংলা'}</button>
            <Link to="/app/accounts/mine" onClick={() => setPop(null)}><Icon name="wallet" size={16} />{L('আমার হিসাব', 'My accounts')}</Link>
            <Link to="/app/me" onClick={() => setPop(null)}><Icon name="user" size={16} />{L('আমার প্রোফাইল', 'My profile')}</Link>
            <Link to="/app/password" onClick={() => setPop(null)}><Icon name="key" size={16} />{L('পাসওয়ার্ড বদলান', 'Change password')}</Link>
            <button className="mi" onClick={() => void signOut()}><Icon name="out" size={16} />{L('লগআউট', 'Sign out')}</button>
          </div>}
        </div>
      </header>
      <div className="scope-bar no-print"><strong>{L('কাজ করছেন:', 'Acting as:')}</strong> {scopeText} <span className="muted">— {L('এর বাইরের তথ্য দেখানো হয় না', 'data outside this scope is not shown')}</span></div>
      <main className="da-main">
        <div className="da-head"><div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
          {actions && <div className="da-actions no-print">{actions}</div>}</div>
        {children}
      </main>
    </div>
  </div>
}
