import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { LoginError, useAuth } from '../auth/AuthProvider'
import { Icon } from '../components/Icon'
import { BrandMark, useBrandText } from '../components/Brand'
import { PublicTop } from '../components/PublicTop'
import { supabase, supabaseConfigured } from '../lib/supabase'
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
  const [forgot, setForgot] = useState(false)
  const [sent, setSent] = useState('')

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
      else if (code === 'invalid' || code === 'bad_request') setError(L('আইডি/মোবাইল/ইমেইল বা পাসওয়ার্ড ভুল। ৫ বার ভুল হলে অ্যাকাউন্ট ৩০ মিনিটের জন্য লক হবে।', 'Wrong ID/mobile/email or password. After 5 wrong tries the account is locked for 30 minutes.'))
      else setError(L('সার্ভারে পৌঁছানো যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।', 'Could not reach the server. Check the internet connection and try again.'))
    }
    finally { setBusy(false) }
  }

  // "Forgot password": a link goes to the email on the account. The answer is the same whether or not the email exists.
  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(''); setSent('')
    const to = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      setError(L('এখানে অ্যাকাউন্টের ইমেইল ঠিকানা লিখুন। এমপ্লয়ি আইডি বা মোবাইল দিয়ে যাঁরা লগইন করেন, তাঁদের পাসওয়ার্ড ম্যানেজার বা সিস্টেম অ্যাডমিন নতুন করে দেবেন।',
        'Type the email address of the account. If you sign in with an Employee ID or mobile, ask your manager or system administrator to reset the password.'))
      return
    }
    setBusy(true)
    try {
      const { error: e } = await supabase.auth.resetPasswordForEmail(to, { redirectTo: `${location.origin}/staff/login` })
      if (e && /rate|limit|seconds/i.test(e.message)) setError(L('একটু আগে লিংক পাঠানো হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন।', 'A link was sent a moment ago. Try again in a few minutes.'))
      else setSent(L('এই ইমেইলে অ্যাকাউন্ট থাকলে পাসওয়ার্ড বদলানোর লিংক পাঠানো হয়েছে। ইনবক্স ও স্প্যাম ফোল্ডার দেখুন, লিংকে চাপলে নতুন পাসওয়ার্ড বসানোর পাতা খুলবে।',
        'If an account uses this email, a link to change the password has been sent. Check the inbox and spam folder; the link opens the page to set a new password.'))
    } catch { setError(L('সার্ভারে পৌঁছানো যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।', 'Could not reach the server. Check the internet connection and try again.')) }
    finally { setBusy(false) }
  }

  if (forgot) return <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>
    <PublicTop showLogin={false} />
    <main className="login-wrap">
      <form className="login-card" onSubmit={sendLink}>
        <BrandMark size="large" />
        <h1>{L('পাসওয়ার্ড ভুলে গেছেন?', 'Forgot your password?')}</h1>
        <p className="muted">{L('অ্যাকাউন্টের ইমেইল ঠিকানা লিখুন। সেই ইমেইলে একটি লিংক যাবে — লিংকে চাপলে নতুন পাসওয়ার্ড বসাতে পারবেন।',
          'Type the email address of the account. A link goes to that email — it lets you set a new password.')}</p>
        <label>{L('ইমেইল', 'Email')}<input type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label>
        {error && <p className="da-error" role="alert">{error}</p>}
        {sent && <p className="notice" role="status">{sent}</p>}
        <button disabled={busy || !supabaseConfigured} style={{ width: '100%', marginTop: 6 }}><Icon name="key" size={16} />{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('লিংক পাঠান', 'Send the link')}</button>
        <button type="button" className="secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => { setForgot(false); setError(''); setSent('') }}>{L('লগইনে ফিরে যান', 'Back to sign in')}</button>
        <p className="muted small" style={{ marginTop: 12 }}>{L('এমপ্লয়ি আইডি বা মোবাইল দিয়ে লগইন করলে ইমেইলে লিংক যায় না — ম্যানেজার বা সিস্টেম অ্যাডমিনকে পাসওয়ার্ড নতুন করে দিতে বলুন।',
          'If you sign in with an Employee ID or mobile, no email can be sent — ask your manager or system administrator to reset the password.')}</p>
      </form>
    </main>
  </div>

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
        <label>{L('এমপ্লয়ি আইডি, মোবাইল বা ইমেইল', 'Employee ID, mobile or email')}<input type="text" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder={L('যেমন 10086 বা 01711000000', 'e.g. 10086 or 01711000000')} /></label>
        <label>{L('পাসওয়ার্ড', 'Password')}<span className="pw" style={{ display: 'block' }}>
          <input type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} style={{ paddingRight: 84 }} />
          <button type="button" className="secondary sm" onClick={() => setShow(s => !s)} aria-label={show ? L('পাসওয়ার্ড লুকান', 'Hide password') : L('পাসওয়ার্ড দেখুন', 'Show password')}>
            <Icon name="eye" size={14} />{show ? L('লুকান', 'Hide') : L('দেখুন', 'Show')}</button></span></label>
        {error && <p className="da-error" role="alert">{error}</p>}
        <button disabled={busy || !supabaseConfigured} style={{ width: '100%', marginTop: 6 }}><Icon name="key" size={16} />{busy ? L('প্রবেশ করা হচ্ছে…', 'Signing in…') : L('লগইন করুন', 'Sign in')}</button>
        <button type="button" className="link" style={{ display: 'block', margin: '10px auto 0' }} onClick={() => { setForgot(true); setError(''); setSent(''); if (!email.includes('@')) setEmail('') }}>{L('পাসওয়ার্ড ভুলে গেছি', 'Forgot password')}</button>
        <p className="muted small" style={{ marginTop: 12 }}>{L('অ্যাকাউন্ট বা অনুমতি প্রয়োজন হলে সিস্টেম অ্যাডমিনের সঙ্গে যোগাযোগ করুন। ৫ বার ভুল পাসওয়ার্ড দিলে অ্যাকাউন্ট ৩০ মিনিট লক থাকে।',
          'Need an account or access? Contact your system administrator. 5 wrong passwords lock the account for 30 minutes.')}</p>
        <p className="muted small" style={{ marginTop: 4 }}>{L('লগইন করলে আপনি ', 'By signing in you accept the ')}
          <Link to="/terms">{L('ব্যবহারের শর্তাবলি', 'terms and conditions')}</Link>
          {L(' মেনে নিচ্ছেন। এখানকার প্রতিটি কাজের রেকর্ড রাখা হয়।', '. Everything done here is recorded.')}</p>
      </form>
    </main>
  </div>
}
