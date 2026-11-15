import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { PublicTop } from '../components/PublicTop'
import { usePrefs } from '../lib/prefs'
import { strongEnough, userFriendly, users } from '../lib/users'

/** Own password change. Forced (standalone screen) while the account still has a temporary password. */
export function ChangePassword() {
  const { mustChangePassword, recovering, endRecovery, refreshGrants, signOut, session } = useAuth()
  const { L } = usePrefs()
  const nav = useNavigate()
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [show, setShow] = useState(false)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr('')
    if (!strongEnough(pw)) return setErr(L('কমপক্ষে ৮ অক্ষর দিন, এতে অক্ষর ও সংখ্যা দুটোই থাকবে।', 'Use at least 8 characters with both letters and digits.'))
    if (pw !== pw2) return setErr(L('দুটি পাসওয়ার্ড মিলছে না।', 'The two passwords do not match.'))
    setBusy(true)
    try { await users.changeMyPassword(pw); endRecovery(); await refreshGrants(); setOk(true); setPw(''); setPw2(''); if (mustChangePassword) nav('/app', { replace: true }) }
    catch (x) { setErr(userFriendly(x)) } finally { setBusy(false) }
  }

  const form = <form className="login-card" onSubmit={submit} style={mustChangePassword ? undefined : { margin: 0, maxWidth: 460 }}>
    {mustChangePassword && <><div className="brand-mark">X</div><h1>{recovering ? L('নতুন পাসওয়ার্ড দিন', 'Set a new password') : L('নিজের পাসওয়ার্ড দিন', 'Set your own password')}</h1>
      <p className="muted">{recovering ? L('ইমেইলের লিংক দিয়ে ঢুকেছেন। এখন নতুন পাসওয়ার্ড বসান — এরপর থেকে এটা দিয়েই লগইন করবেন।', 'You came in through the email link. Set a new password now — you will sign in with it from here on.') : L('আপনি অস্থায়ী পাসওয়ার্ড দিয়ে ঢুকেছেন। কাজ শুরুর আগে নতুন পাসওয়ার্ড বসান — এটা শুধু আপনি জানবেন।',
        'You signed in with a temporary password. Set a new one before you start — only you should know it.')}</p>
      <p className="muted small">{session?.user.email}</p></>}
    <label>{L('নতুন পাসওয়ার্ড', 'New password')}<input type={show ? 'text' : 'password'} autoComplete="new-password" required value={pw} onChange={e => setPw(e.target.value)} /></label>
    <label>{L('আবার লিখুন', 'Repeat it')}<input type={show ? 'text' : 'password'} autoComplete="new-password" required value={pw2} onChange={e => setPw2(e.target.value)} /></label>
    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} style={{ width: 'auto' }} />{L('পাসওয়ার্ড দেখান', 'Show password')}</label>
    <p className="muted small">{L('কমপক্ষে ৮ অক্ষর, অক্ষর ও সংখ্যা দুটোই। নাম বা মোবাইল নম্বর দেবেন না।', 'At least 8 characters, letters and digits. Do not use your name or mobile number.')}</p>
    {err && <p className="da-error" role="alert">{err}</p>}
    {ok && !mustChangePassword && <p className="notice">{L('পাসওয়ার্ড বদলানো হয়েছে।', 'Password changed.')}</p>}
    <button disabled={busy} style={{ width: '100%' }}><Icon name="key" size={16} />{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('পাসওয়ার্ড সেভ করুন', 'Save password')}</button>
    {mustChangePassword && <button type="button" className="secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => void signOut()}>{L('লগআউট', 'Sign out')}</button>}
  </form>

  if (mustChangePassword) return <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}><PublicTop showLogin={false} /><main className="login-wrap">{form}</main></div>
  return <AppShell title={L('পাসওয়ার্ড বদলান', 'Change password')}><section className="panel">{form}</section></AppShell>
}
