import { Link } from 'react-router-dom'
import { isDark, usePrefs } from '../lib/prefs'
import { Icon } from './Icon'

/** Top bar for pages before sign-in: logo, language and theme switches, staff login. */
export function PublicTop({ showLogin = true }: { showLogin?: boolean }) {
  const { L, lang, setLang, theme, setTheme } = usePrefs()
  return <header className="pub-top">
    <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'var(--text)' }}><span className="brand-mark small">X</span><strong>XZM-TEAM</strong></Link>
    <span className="spacer" />
    <button className="secondary sm" onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}><Icon name="globe" size={15} />{lang === 'bn' ? 'English' : 'বাংলা'}</button>
    <button className="icon" aria-label={L('ডার্ক / লাইট মোড', 'Dark / light mode')} onClick={() => setTheme(isDark(theme) ? 'light' : 'dark')}><Icon name="sun" /></button>
    {showLogin && <Link to="/staff/login"><button><Icon name="key" size={16} />{L('স্টাফ লগইন', 'Staff login')}</button></Link>}
  </header>
}
