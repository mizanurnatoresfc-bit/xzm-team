import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { usePrefs, type Theme } from '../lib/prefs'

/** Personal settings: language, light/dark, password, and shortcuts to the admin settings the role may open. */
export function Settings() {
  const { can } = useAuth()
  const { L, lang, setLang, theme, setTheme } = usePrefs()
  const themes: Array<[Theme, string, string]> = [['light', 'লাইট', 'Light'], ['dark', 'ডার্ক', 'Dark'], ['system', 'ফোনের মতো', 'Same as device']]
  const admin: Array<[string, string, string, string, boolean]> = [
    ['/app/accounts/settings', 'gear', 'হিসাব সেটিংস', 'Accounts settings', can('da.settings.configure')],
    ['/app/hr/fields', 'form', 'প্রোফাইলের ঘর ও কলাম', 'Profile fields', can('hr.profile_field.configure')],
    ['/app/roles', 'shield', 'রোল ও অনুমতি', 'Roles & permissions', can('system.role.view')],
    ['/app/branding', 'form', 'নাম, লোগো ও রঙ', 'Name, logo & colour', can('system.settings.configure')],
  ]
  return <AppShell title={L('সেটিং', 'Setting')}>
    <section className="panel">
      <h2>{L('ভাষা', 'Language')}</h2>
      <div className="da-seg">{(['bn', 'en'] as const).map(l => <button key={l} className={lang === l ? '' : 'secondary'} onClick={() => setLang(l)}>{l === 'bn' ? 'বাংলা' : 'English'}</button>)}</div>
      <h2 style={{ marginTop: 18 }}>{L('রঙ', 'Theme')}</h2>
      <div className="da-seg">{themes.map(([t, bn, en]) => <button key={t} className={theme === t ? '' : 'secondary'} onClick={() => setTheme(t)}>{L(bn, en)}</button>)}</div>
    </section>
    <section className="panel">
      <h2>{L('অ্যাকাউন্ট', 'Account')}</h2>
      <div className="hub-links">
        <Link to="/app/password" className="hub-link"><Icon name="key" size={18} /><span>{L('পাসওয়ার্ড বদলান', 'Change password')}</span><Icon name="chev" size={14} /></Link>
        <Link to="/app/me" className="hub-link"><Icon name="user" size={18} /><span>{L('আমার প্রোফাইল', 'My profile')}</span><Icon name="chev" size={14} /></Link>
        <Link to="/app/accounts/mine" className="hub-link"><Icon name="wallet" size={18} /><span>{L('আমার হিসাব', 'My accounts')}</span><Icon name="chev" size={14} /></Link>
      </div>
    </section>
    {admin.some(a => a[4]) && <section className="panel">
      <h2>{L('সিস্টেম সেটিংস', 'System settings')}</h2>
      <div className="hub-links">{admin.filter(a => a[4]).map(([to, ic, bn, en]) => <Link key={to} to={to} className="hub-link"><Icon name={ic} size={18} /><span>{L(bn, en)}</span><Icon name="chev" size={14} /></Link>)}</div>
    </section>}
  </AppShell>
}
