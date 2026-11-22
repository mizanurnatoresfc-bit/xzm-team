import { useState, type FormEvent, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { LoginError, useAuth } from '../auth/AuthProvider'
import { Icon } from '../components/Icon'
import { BrandMark, useBrandText } from '../components/Brand'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { isDark, usePrefs } from '../lib/prefs'
import '../login.css'

/** "মনে রাখুন": the login ID is kept on this device and filled in next time (never the password). */
const REMEMBER_KEY = 'xzm_login_id'
const readRemembered = () => { try { return localStorage.getItem(REMEMBER_KEY) ?? '' } catch { return '' } }

export function Login() {
  const { session, signIn } = useAuth()
  const { L, lang, setLang, theme, setTheme } = usePrefs()
  const { name, tagline } = useBrandText()
  const [email, setEmail] = useState(readRemembered)
  const [remember, setRemember] = useState(() => readRemembered() !== '')
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
    try {
      await signIn(email.trim(), password)
      try { if (remember) localStorage.setItem(REMEMBER_KEY, email.trim()); else localStorage.removeItem(REMEMBER_KEY) } catch { /* private window */ }
    }
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

  const shell = (card: ReactElement) => <div className="lg-page">
    <div className="lg-bar">
      <button type="button" onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}><Icon name="globe" size={15} />{lang === 'bn' ? 'English' : 'বাংলা'}</button>
      <button type="button" aria-label={L('ডার্ক / লাইট মোড', 'Dark / light mode')} onClick={() => setTheme(isDark(theme) ? 'light' : 'dark')}><Icon name="sun" size={16} /></button>
    </div>
    <main className="lg-main">{card}</main>
  </div>
  const brand = <>
    <div className="lg-brand"><BrandMark size="large" /><strong>{name}</strong></div>
    <p className="lg-sub">{tagline || L('স্টাফ পোর্টাল', 'Staff Portal')}</p>
  </>
  const configNote = !supabaseConfigured && <p className="notice">{L('Supabase সেটআপ বাকি: web/.env.local ফাইলে URL ও anon key দিন।', 'Supabase is not set up: add the URL and anon key in web/.env.local.')}</p>

  if (forgot) return shell(<form className="lg-card" onSubmit={sendLink}>
    {brand}
    <p className="lg-lead">{L('অ্যাকাউন্টের ইমেইল লিখুন — নতুন পাসওয়ার্ড বসানোর লিংক যাবে', 'Type the account’s email — a link to set a new password goes there')}</p>
    <label className="lg-field"><span className="lg-ic"><Icon name="sms" size={20} /></span>
      <input className="lg-in" type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}
        placeholder={L('ইমেইল', 'Email')} aria-label={L('ইমেইল', 'Email')} /></label>
    {error && <p className="da-error" role="alert">{error}</p>}
    {sent && <p className="notice" role="status">{sent}</p>}
    <button className="lg-go" disabled={busy || !supabaseConfigured}>{busy ? L('পাঠানো হচ্ছে…', 'Sending…') : L('লিংক পাঠান', 'Send the link')}</button>
    <button type="button" className="secondary lg-back" onClick={() => { setForgot(false); setError(''); setSent('') }}>{L('লগইনে ফিরে যান', 'Back to sign in')}</button>
    <p className="lg-note">{L('এমপ্লয়ি আইডি বা মোবাইল দিয়ে লগইন করলে ইমেইলে লিংক যায় না — ম্যানেজার বা সিস্টেম অ্যাডমিনকে পাসওয়ার্ড নতুন করে দিতে বলুন।',
      'If you sign in with an Employee ID or mobile, no email can be sent — ask your manager or system administrator to reset the password.')}</p>
  </form>)

  return shell(<form className="lg-card" onSubmit={submit}>
    {brand}
    <p className="lg-lead">{L('আপনার অ্যাকাউন্টে সাইন ইন করুন', 'Sign in to your account')}</p>
    {configNote}
    <label className="lg-field"><span className="lg-ic"><Icon name="phone" size={20} /></span>
      <input className="lg-in" type="text" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}
        placeholder={L('মোবাইল নম্বর বা আইডি', 'Mobile number or ID')} aria-label={L('এমপ্লয়ি আইডি, মোবাইল বা ইমেইল', 'Employee ID, mobile or email')} /></label>
    <label className="lg-field"><span className="lg-ic"><Icon name="a_lock" size={20} /></span>
      <input className="lg-in has-eye" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}
        placeholder={L('পাসওয়ার্ড', 'Password')} aria-label={L('পাসওয়ার্ড', 'Password')} />
      <button type="button" className="lg-eye" onClick={() => setShow(s => !s)} aria-pressed={show} aria-label={show ? L('পাসওয়ার্ড লুকান', 'Hide password') : L('পাসওয়ার্ড দেখুন', 'Show password')}>
        <Icon name="eye" size={22} /></button></label>
    <div className="lg-row">
      <label className="lg-rem"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />{L('মনে রাখুন', 'Remember me')}</label>
      <button type="button" className="lg-link" onClick={() => { setForgot(true); setError(''); setSent(''); if (!email.includes('@')) setEmail('') }}>{L('পাসওয়ার্ড ভুলে গেছেন?', 'Forgot password?')}</button>
    </div>
    {error && <p className="da-error" role="alert">{error}</p>}
    <button className="lg-go" disabled={busy || !supabaseConfigured}>{busy ? L('প্রবেশ করা হচ্ছে…', 'Signing in…') : L('সাইন ইন', 'Sign in')}</button>
    <p className="lg-note">{L('লগইন করলে আপনি ', 'By signing in you accept the ')}<Link to="/terms">{L('ব্যবহারের শর্তাবলি', 'terms and conditions')}</Link>
      {L(' মেনে নিচ্ছেন। ৫ বার ভুল পাসওয়ার্ড দিলে অ্যাকাউন্ট ৩০ মিনিট লক থাকে।', '. 5 wrong passwords lock the account for 30 minutes.')}</p>
  </form>)
}
