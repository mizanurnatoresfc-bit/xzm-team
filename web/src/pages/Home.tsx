import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from '../components/Icon'
import { PublicTop } from '../components/PublicTop'
import { usePrefs } from '../lib/prefs'

const FEATS: Array<[string, string, string, string, string]> = [
  ['users', 'এইচআর ও এমপ্লয়ি আইডি', 'HR & Employee IDs', 'তিন ধাপে আইডি আবেদন, HR যাচাই, ডকুমেন্ট, বদলি ও প্রোফাইল।', 'Three-step ID applications, HR review, documents, transfers and profiles.'],
  ['hub', 'হাব ও কুরিয়ার অপারেশন', 'Hubs & courier operations', 'পিকআপ, ডেলিভারি ও ক্যাশ — ডুপ্লিকেট ও গরমিল যাচাইসহ।', 'Pickups, deliveries and cash — with duplicate and mismatch checks.'],
  ['ledger', 'আজকের হিসাব খাতা', 'Daily accounts', 'হাবভিত্তিক দৈনিক হিসাব, একবার সাবমিট, অ্যাকাউন্টস ম্যানেজারের যাচাই।', 'Hub daily sheets, submitted once, verified by the Accounts Manager.'],
  ['cal', 'হাজিরা ও ছুটি', 'Attendance & leave', 'দৈনিক হাজিরা, মাসিক হিসাব, ছুটির অনুরোধ ও অনুমোদন।', 'Daily attendance, monthly summary, leave requests and approval.'],
  ['chart', 'রিপোর্ট', 'Reports', 'দৈনিক থেকে মাসিক রিপোর্ট — Excel, PDF ও প্রিন্ট।', 'Daily to monthly reports — Excel, PDF and print.'],
  ['shield', 'নিরাপত্তা ও অডিট', 'Security & audit', 'জোন ও হাবের তথ্যসীমা ডাটাবেসেই নিয়ন্ত্রিত; প্রতিটি পরিবর্তনের লগ থাকে।', 'Zone and hub limits enforced by the database; every change is logged.'],
]

/** Public home page shown before sign-in. */
export function Home() {
  const { session, loading } = useAuth()
  const { L } = usePrefs()
  if (!loading && session) return <Navigate to="/app" replace />
  return <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>
    <PublicTop />
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow" style={{ color: 'var(--primary)' }}>MANAGEMENT + ACCOUNTS ERP</p>
          <h1>{L('হেড অফিস, জোন ও হাবের জন্য একটাই সিস্টেম', 'One system for Head Office, zones and hubs')}</h1>
          <p>{L('XZM-TEAM এইচআর, কুরিয়ার অপারেশন, হিসাব, হাজিরা ও রিপোর্ট — সব এক নিরাপদ, অডিটযোগ্য জায়গায়, বাংলা ও ইংরেজিতে।',
            'XZM-TEAM brings HR, courier operations, accounts, attendance and reports into one secure, auditable workspace — in বাংলা and English.')}</p>
          <div className="row" style={{ marginTop: 18 }}><Link to="/staff/login"><button><Icon name="key" size={16} />{L('স্টাফ লগইন', 'Staff login')}</button></Link>
            <a href="#features"><button className="secondary">{L('মডিউলগুলো দেখুন', 'See the modules')}</button></a></div>
        </div>
        <div className="hero-card" aria-hidden="true">
          <div className="row" style={{ justifyContent: 'space-between' }}><strong>{L('আজকের সারসংক্ষেপ', "Today's summary")}</strong><span className="da-badge b-ok">{L('লাইভ', 'Live')}</span></div>
          {[['users', L('সক্রিয় কর্মী', 'Active staff')], ['ledger', L('আজকের হিসাব খাতা', 'Daily sheets')], ['cal', L('হাজিরা', 'Attendance')]].map(([ic, t]) =>
            <div key={t} className="row" style={{ gap: 10 }}><span className="da-card" style={{ padding: 0, border: 0, boxShadow: 'none', background: 'transparent' }}><span className="ri"><Icon name={ic} /></span></span><span>{t}</span></div>)}
          <div className="muted small">{L('ক্যাশ হ্যান্ডওভার যাচাই', 'Cash handover reconciled')}</div><div className="meter"><i style={{ width: '72%' }} /></div>
        </div>
      </section>
      <section className="feat" id="features">
        <h2 style={{ marginBottom: 14 }}>{L('মডিউল', 'Modules')}</h2>
        <div className="feat-grid">{FEATS.map(([ic, bn, en, dbn, den]) => <div key={en} className="panel">
          <span className="da-card" style={{ padding: 0, border: 0, boxShadow: 'none', background: 'transparent', display: 'inline-flex' }}><span className="ri"><Icon name={ic} /></span></span>
          <h3>{L(bn, en)}</h3><p className="muted" style={{ margin: 0 }}>{L(dbn, den)}</p></div>)}</div>
      </section>
    </main>
    <footer className="pub-foot">© XZM-TEAM · {L('শুধু অনুমোদিত স্টাফদের জন্য', 'For authorised staff only')}</footer>
  </div>
}
