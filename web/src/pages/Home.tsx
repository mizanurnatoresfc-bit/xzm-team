import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from '../components/Icon'
import { PublicTop } from '../components/PublicTop'
import { usePrefs } from '../lib/prefs'

/** [icon, title bn, title en, text bn, text en] */
const WORK: Array<[string, string, string, string, string]> = [
  ['users', 'কর্মী ও আইডি', 'Staff and IDs', 'আবেদন থেকে এমপ্লয়ি আইডি, প্রোফাইল, বদলি ও ডকুমেন্ট — হাব অনুযায়ী এক তালিকায়।', 'From application to Employee ID, with profiles, transfers and documents — hub by hub in one list.'],
  ['cal', 'হাজিরা ও ছুটি', 'Attendance and leave', 'দৈনিক হাজিরা, মাসিক হিসাব, ছুটির আবেদন ও অনুমোদন এক জায়গায়।', 'Daily attendance, the monthly summary, leave requests and approvals in one place.'],
  ['ledger', 'আজকের হিসাব খাতা', 'Today’s account sheet', 'রাইডারের লাইন, মার্চেন্ট পেমেন্ট ও খরচ — একবার সাবমিট, তারপর যাচাই।', 'Rider lines, merchant payments and expenses — submitted once, then checked.'],
  ['hub', 'কুরিয়ার অপারেশন', 'Courier operations', 'পিকআপ, ডেলিভারি, পার্সেল সমস্যা ও ক্যাশ হ্যান্ডওভার।', 'Pickups, deliveries, parcel problems and cash handovers.'],
  ['chart', 'রিপোর্ট', 'Reports', 'দৈনিক থেকে মাসিক হিসাব — Excel, PDF বা প্রিন্ট করে নিন।', 'Daily to monthly figures — take them as Excel, PDF or print.'],
  ['shield', 'অনুমতি ও লগ', 'Permissions and logs', 'কে কী দেখবে তা রোল দিয়ে ঠিক করা, আর প্রতিটি বদলের রেকর্ড থাকে।', 'Roles decide who sees what, and every change leaves a record.'],
]

const STEPS: Array<[string, string, string, string]> = [
  ['সুপার অ্যাডমিন রোল বানান', 'The Super Admin makes the roles', 'কোন পদ কী দেখবে, কী করতে পারবে — সেটা আগে ঠিক করে নেওয়া হয়।', 'Which post sees what, and may do what, is settled first.'],
  ['কাজ যার যার হাতে যায়', 'The work lands with the right person', 'রোল অনুযায়ী প্রত্যেকের হোম পেজে শুধু তার নিজের কাজ আর অপেক্ষমাণ জিনিসগুলো আসে।', 'By role, each person’s home page shows their own work and what is waiting on them.'],
  ['একবার লিখলেই সবখানে', 'Written once, counted everywhere', 'হাবে যা লেখা হয়, জোন আর হেড অফিসের হিসাবে তা নিজে থেকেই যোগ হয়।', 'What a hub writes down adds itself to the zone’s and Head Office’s figures.'],
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
          <p className="eyebrow" style={{ color: 'var(--primary)' }}>{L('অফিসের নিজস্ব টুল', 'THE OFFICE’S OWN TOOL')}</p>
          <h1>{L('অফিসের কাজ সহজ করতে, আর দ্রুত ভাগ করে নিতে', 'To make the office work easier, and to share it out faster')}</h1>
          <p>{L('XZM-TEAM প্রতিষ্ঠানের নিজের টুল — হেড অফিস, জোন ও হাবের দৈনন্দিন কাজ এক জায়গায় রাখে, যাতে কে কী করবে তা পরিষ্কার থাকে আর হিসাব মেলাতে সময় নষ্ট না হয়। এর আলাদা কোনো উদ্দেশ্য নেই, বাইরের কারও জন্য কোনো সেবা নয়।',
            'XZM-TEAM is the company’s own tool. It keeps the daily work of Head Office, the zones and the hubs in one place, so everyone knows what is theirs to do and no time goes into chasing figures. It has no other purpose, and it is not a service for anyone outside.')}</p>
          <div className="row" style={{ marginTop: 18 }}>
            <Link to="/staff/login"><button><Icon name="key" size={16} />{L('স্টাফ লগইন', 'Staff login')}</button></Link>
            <a href="#work"><button className="secondary">{L('কী কী কাজ হয়', 'What it handles')}</button></a>
          </div>
          <p className="muted small" style={{ marginTop: 14 }}>{L('শুধু অনুমোদিত কর্মীদের জন্য। অ্যাকাউন্ট দেন সিস্টেম অ্যাডমিন।', 'For authorised staff only. Accounts are given by the system administrator.')}</p>
        </div>
        <div className="hero-card" aria-hidden="true">
          <div className="row" style={{ justifyContent: 'space-between' }}><strong>{L('একদিনের কাজ', 'A day’s work')}</strong><span className="da-badge b-ok">{L('লাইভ', 'Live')}</span></div>
          {[['cal', L('হাজিরা দেওয়া হলো', 'Attendance marked')], ['truck', L('ডেলিভারি ও পিকআপ উঠল', 'Deliveries and pickups entered')],
            ['ledger', L('হিসাব খাতা সাবমিট', 'Account sheet submitted')], ['check', L('হেড অফিস যাচাই করল', 'Head Office checked it')]].map(([ic, t]) =>
            <div key={t} className="row" style={{ gap: 10 }}><span className="ri"><Icon name={ic} /></span><span>{t}</span></div>)}
          <div className="muted small">{L('দিনের কাজ শেষ', 'The day closed')}</div><div className="meter"><i style={{ width: '86%' }} /></div>
        </div>
      </section>

      <section className="feat" id="work">
        <h2 style={{ marginBottom: 14 }}>{L('কী কী কাজ এখানে হয়', 'What the work here covers')}</h2>
        <div className="feat-grid">{WORK.map(([ic, bn, en, dbn, den]) => <div key={en} className="panel">
          <span className="ri"><Icon name={ic} /></span>
          <h3>{L(bn, en)}</h3><p className="muted" style={{ margin: 0 }}>{L(dbn, den)}</p></div>)}</div>
      </section>

      <section className="feat">
        <h2 style={{ marginBottom: 14 }}>{L('কাজ ভাগ হয় যেভাবে', 'How the work gets shared out')}</h2>
        <div className="feat-grid">{STEPS.map(([bn, en, dbn, den], i) => <div key={en} className="panel">
          <span className="step-no">{L(['১', '২', '৩'][i], String(i + 1))}</span>
          <h3>{L(bn, en)}</h3><p className="muted" style={{ margin: 0 }}>{L(dbn, den)}</p></div>)}</div>
      </section>

      <section className="feat">
        <div className="panel">
          <h3>{L('এটি যা নয়', 'What it is not')}</h3>
          <p className="muted" style={{ margin: 0 }}>{L('এটি কোনো পাবলিক সার্ভিস, অ্যাপ স্টোরের প্রোডাক্ট বা বিক্রির জিনিস নয়। এখানে কারও কাছ থেকে টাকা নেওয়া হয় না, কোনো বিজ্ঞাপন নেই, আর প্রতিষ্ঠানের কাজের বাইরে কোনো তথ্য রাখা হয় না।',
            'It is not a public service, a product in an app store, or anything for sale. No money is taken from anyone, there are no advertisements, and nothing is kept here beyond the company’s own work.')}</p>
          <p className="muted small" style={{ marginBottom: 0 }}><Link to="/terms">{L('ব্যবহারের শর্তাবলি পড়ুন', 'Read the terms and conditions')}</Link></p>
        </div>
      </section>
    </main>
    <footer className="pub-foot">© XZM-TEAM · {L('শুধু অনুমোদিত স্টাফদের জন্য', 'For authorised staff only')} · <Link to="/terms">{L('শর্তাবলি', 'Terms')}</Link></footer>
  </div>
}
