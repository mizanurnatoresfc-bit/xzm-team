import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { LoginError, useAuth } from '../auth/AuthProvider'
import { Icon } from '../components/Icon'
import { BrandMark, useBrandText } from '../components/Brand'
import { PublicTop } from '../components/PublicTop'
import { supabaseConfigured } from '../lib/supabase'
import { usePrefs } from '../lib/prefs'

export function Login() {
  const { session, signIn } = useAuth()
  const { L, lang } = usePrefs()
  const { name, tagline } = useBrandText()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/app" replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try { await signIn(email.trim(), password) }
    catch (e) {
      const code = e instanceof LoginError ? e.code : 'network'
      if (code === 'locked') {
        const t = e instanceof LoginError && e.lockedUntil
          ? new Date(e.lockedUntil).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'short', timeStyle: 'short' }) : ''
        setError(L(`বারবার ভুল পাসওয়ার্ড দেওয়ায় অ্যাকাউন্ট সাময়িকভাবে লক হয়েছে।${t ? ` ${t}-এর পর আবার চেষ্টা করুন।` : ''}`,
          `Too many wrong passwords — the account is locked for a while.${t ? ` Try again after ${t}.` : ''}`))
      } else if (code === 'blocked') setError(L('এই অ্যাকাউন্ট এখন সক্রিয় নয় বা লক করা। সিস্টেম অ্যাডমিনের সঙ্গে যোগাযোগ করুন।', 'This account is inactive or locked. Contact your system administrator.'))
      else if (code === 'rate_limited') setError(L('অল্প সময়ে অনেকবার চেষ্টা হয়েছে। ১০ মিনিট পর আবার চেষ্টা করুন।', 'Too many attempts. Try again in 10 minutes.'))
      else if (code === 'invalid' || code === 'bad_request') setError(L('ইমেইল বা পাসওয়ার্ড ভুল। ৫ বার ভুল হলে অ্যাকাউন্ট ৩০ মিনিটের জন্য লক হবে।', 'Wrong email or password. After 5 wrong tries the account is locked for 30 minutes.'))
      else setError(L('সার্ভারে পৌঁছানো যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।', 'Could not reach the server. Check the internet connection and try again.'))
    }
    finally { setBusy(false) }
  }

  return <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>
    <PublicTop showLogin={false} />
    <main className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <BrandMark size="large" />
        <p className="eyebrow">{name}{tagline ? ` · ${tagline}` : ''}</p>
        <h1>{L('স্টাফ ও অ্যাডমিন লগইন', 'Staff and admin login')}</h1>
        <p className="muted">{L('প্রতিষ্ঠানের দেওয়া অ্যাকাউন্ট দিয়ে প্রবেশ করুন। যে রোল আপনাকে দেওয়া হয়েছে, পাতাগুলো সেই অনুযায়ীই আসবে।',
          'Sign in with the account the company gave you. The pages you get follow the role you were given.')}</p>
        {!supabaseConfigured && <p className="notice">{L('Supabase সেটআপ বাকি: web/.env.local ফাইলে URL ও anon key দিন।', 'Supabase is not set up: add the URL and anon key in web/.env.local.')}</p>}
        <label>{L('ইমেইল', 'Email')}<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>{L('পাসওয়ার্ড', 'Password')}<span className="pw" style={{ display: 'block' }}>
          <input type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} style={{ paddingRight: 84 }} />
          <button type="button" className="secondary sm" onClick={() => setShow(s => !s)} aria-label={show ? L('পাসওয়ার্ড লুকান', 'Hide password') : L('পাসওয়ার্ড দেখুন', 'Show password')}>
            <Icon name="eye" size={14} />{show ? L('লুকান', 'Hide') : L('দেখুন', 'Show')}</button></span></label>
        {error && <p className="da-error" role="alert">{error}</p>}
        <button disabled={busy || !supabaseConfigured} style={{ width: '100%', marginTop: 6 }}><Icon name="key" size={16} />{busy ? L('প্রবেশ করা হচ্ছে…', 'Signing in…') : L('লগইন করুন', 'Sign in')}</button>
        <p className="muted small" style={{ marginTop: 12 }}>{L('অ্যাকাউন্ট বা অনুমতি প্রয়োজন হলে সিস্টেম অ্যাডমিনের সঙ্গে যোগাযোগ করুন। ৫ বার ভুল পাসওয়ার্ড দিলে অ্যাকাউন্ট ৩০ মিনিট লক থাকে।',
          'Need an account or access? Contact your system administrator. 5 wrong passwords lock the account for 30 minutes.')}</p>
        <p className="muted small" style={{ marginTop: 4 }}>{L('লগইন করলে আপনি ', 'By signing in you accept the ')}
          <Link to="/terms">{L('ব্যবহারের শর্তাবলি', 'terms and conditions')}</Link>
          {L(' মেনে নিচ্ছেন। এখানকার প্রতিটি কাজের রেকর্ড রাখা হয়।', '. Everything done here is recorded.')}</p>
      </form>
    </main>
  </div>
}
