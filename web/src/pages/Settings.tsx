import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { ViewAsPicker } from '../components/ViewAs'
import { isNativeApp } from '../lib/native'
import { FONTS, usePrefs, type Theme } from '../lib/prefs'

type Row = [to: string, icon: string, bn: string, en: string, perms: string[]]
// Every settings / set-up page in the system, grouped. A row shows only when the role may open it.
const ADMIN: Array<[bn: string, en: string, rows: Row[]]> = [
  ['সিস্টেম ও ইউজার', 'System & users', [
    ['/app/users', 'key', 'ইউজার ও রোল দেওয়া', 'Users & their roles', ['system.user.view']],
    ['/app/roles', 'shield', 'রোল ও অনুমতি', 'Roles & permissions', ['system.role.view']],
    ['/app/role-dashboards', 'chart', 'রোল অনুযায়ী ড্যাশবোর্ড', 'Dashboard by role', ['system.role.edit']],
    ['/app/branding', 'form', 'নাম, লোগো ও রঙ', 'Name, logo & colour', ['system.settings.configure']],
    ['/app/nodi', 'gear', 'নদী AI (API ও সীমা)', 'Nodi AI (API & limits)', ['nodi.settings.configure']],
  ]],
  ['প্রতিষ্ঠান', 'Organisation', [
    ['/app/org', 'org', 'এরিয়া, হাব ও পদ', 'Areas, hubs & posts', ['org.zone.view', 'org.hub.view', 'org.department.view']],
    ['/app/org/hubs', 'map', 'হাব তালিকা ও ম্যাপ', 'Hub list & map', ['org.hub.view']],
    ['/app/sorting/centers', 'hub', 'শটিং সেন্টার ও হাব', 'Sorting centers & hubs', ['sorting.center.view', 'sorting.center.create']],
    ['/app/office/places', 'home', 'অফিস ও আবাসিক', 'Offices & residences', ['office.property.view', 'office.property.create']],
  ]],
  ['স্টাফ / HR', 'Staff / HR', [
    ['/app/hr/fields', 'form', 'প্রোফাইলের ঘর, কলাম ও ফরম্যাট', 'Profile fields, columns & formats', ['hr.profile_field.configure', 'hr.referral.configure']],
    ['/app/hr/duties', 'tasks', 'কাজের দায়িত্ব', 'Duties', ['hr.duty.view', 'hr.duty.edit']],
    ['/app/hr/import', 'upload', 'কর্মী ইমপোর্ট (Excel)', 'Import employees', ['hr.import.create']],
    ['/app/hr/requests?tab=settings', 'form', 'HR রিকুয়েস্টের ফরম্যাট', 'HR request formats', ['hr.request.configure']],
  ]],
  ['হিসাব ও গাড়ি', 'Accounts & vehicles', [
    ['/app/accounts/settings', 'gear', 'হিসাব সেটিংস (খাত, ব্যাংক চার্জ, ফিক্সড)', 'Accounts settings', ['da.settings.configure']],
    ['/app/vehicles/settings', 'truck', 'গাড়ি সেটিংস', 'Vehicle settings', ['vehicle.settings.configure']],
  ]],
]

/** Settings: language, theme and Bangla font for this device; the account; and every admin setting the role may open. */
export function Settings() {
  const { can, isSuperAdmin, viewAs } = useAuth()
  const { L, lang, setLang, theme, setTheme, font, setFont } = usePrefs()
  const [asRole, setAsRole] = useState(false)
  const [copied, setCopied] = useState(false)
  const themes: Array<[Theme, string, string]> = [['light', 'লাইট', 'Light'], ['dark', 'ডার্ক', 'Dark'], ['system', 'ফোনের মতো', 'Same as device']]
  const groups = ADMIN.map(([bn, en, rows]) => [bn, en, rows.filter(r => r[4].some(p => can(p)))] as const).filter(g => g[2].length)
  const loginUrl = `${location.origin}/staff/login`
  async function share() {
    try {
      if (navigator.share) { await navigator.share({ title: document.title, url: loginUrl }); return }
      await navigator.clipboard.writeText(loginUrl); setCopied(true); window.setTimeout(() => setCopied(false), 2500)
    } catch { /* the person closed the share sheet */ }
  }
  return <AppShell title={L('সেটিং', 'Setting')}>
    <section className="panel">
      <h2>{L('ভাষা', 'Language')}</h2>
      <div className="da-seg">{(['bn', 'en'] as const).map(l => <button key={l} className={lang === l ? '' : 'secondary'} onClick={() => setLang(l)}>{l === 'bn' ? 'বাংলা' : 'English'}</button>)}</div>
      <h2 style={{ marginTop: 18 }}>{L('রঙ', 'Theme')}</h2>
      <div className="da-seg">{themes.map(([t, bn, en]) => <button key={t} className={theme === t ? '' : 'secondary'} onClick={() => setTheme(t)}>{L(bn, en)}</button>)}</div>
      <h2 style={{ marginTop: 18 }}>{L('বাংলা ফন্ট', 'Bangla font')}</h2>
      <div className="font-pick">{FONTS.map(f => <button key={f.key} type="button" className={font === f.key ? 'on' : ''} aria-pressed={font === f.key} onClick={() => setFont(f.key)}
        style={{ fontFamily: `"${f.family}","Hind Siliguri",sans-serif` }}><b>{f.label}</b><span>আমার সোনার বাংলা — ১২৩৪৫</span></button>)}</div>
      <p className="muted small">{L('ভাষা, রঙ ও ফন্ট শুধু এই ডিভাইসে মনে থাকে।', 'Language, theme and font are remembered on this device only.')}</p>
    </section>
    <section className="panel">
      <h2>{L('অ্যাকাউন্ট', 'Account')}</h2>
      <div className="hub-links">
        <Link to="/app/password" className="hub-link"><Icon name="key" size={18} /><span>{L('পাসওয়ার্ড বদলান', 'Change password')}</span><Icon name="chev" size={14} /></Link>
        <Link to="/app/me" className="hub-link"><Icon name="user" size={18} /><span>{L('আমার প্রোফাইল', 'My profile')}</span><Icon name="chev" size={14} /></Link>
        <Link to="/app/me/permissions" className="hub-link"><Icon name="shield" size={18} /><span>{L('আমার অনুমতি', 'My permissions')}</span><Icon name="chev" size={14} /></Link>
        <Link to="/app/accounts/mine" className="hub-link"><Icon name="wallet" size={18} /><span>{L('আমার হিসাব', 'My accounts')}</span><Icon name="chev" size={14} /></Link>
        {!isNativeApp() && <button type="button" className="hub-link as-btn" onClick={() => void share()}><Icon name="globe" size={18} />
          <span>{copied ? L('লিংক কপি হয়েছে', 'Link copied') : L('লগইন লিংক শেয়ার করুন', 'Share the login link')}</span><Icon name="chev" size={14} /></button>}
      </div>
    </section>
    {isSuperAdmin && <section className="panel">
      <h2>{L('সুপার অ্যাডমিন', 'Super Admin')}</h2>
      <div className="hub-links">
        <button type="button" className="hub-link as-btn" onClick={() => setAsRole(true)}><Icon name="shield" size={18} />
          <span>{viewAs ? `${L('দেখছেন:', 'Viewing as:')} ${viewAs.name}` : L('রোল হিসেবে দেখুন', 'View as a role')}</span><Icon name="chev" size={14} /></button>
      </div>
      <p className="muted small">{L('যেকোনো রোল বেছে নিয়ে দেখুন ওই রোলের মানুষ মেনু, ড্যাশবোর্ড আর পাতা কেমন দেখেন।', 'Pick any role to see the menu, dashboard and pages the way people in that role see them.')}</p>
    </section>}
    {groups.map(([bn, en, rows]) => <section className="panel" key={en}>
      <h2>{L(bn, en)}</h2>
      <div className="hub-links">{rows.map(([to, ic, b, e]) => <Link key={to} to={to} className="hub-link"><Icon name={ic} size={18} /><span>{L(b, e)}</span><Icon name="chev" size={14} /></Link>)}</div>
    </section>)}
    {asRole && <ViewAsPicker onClose={() => setAsRole(false)} />}
  </AppShell>
}
