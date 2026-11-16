import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from '../components/Icon'
import { PublicTop } from '../components/PublicTop'
import { useBrandText } from '../components/Brand'
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

/** The way of working (owner, 17 Nov 2026): [icon, English, বাংলা, text bn, text en] */
const MOTTO: Array<[string, string, string, string, string]> = [
  ['check', 'Less Work', 'কম কাজ', 'এক ক্লিক, আগে থেকে বসানো তথ্য — একই জিনিস দুবার লিখতে হয় না।', 'One tap and details already filled in — nothing is typed twice.'],
  ['play', 'More Automation', 'বেশি অটোমেশন', 'স্ক্রিনশট পড়া, নম্বর ও মেমো তৈরি, হিসাব মেলানো, নোটিফিকেশন — সিস্টেম নিজে করে।', 'Reading screenshots, numbering, memos, matching figures, alerts — the system does them.'],
  ['chart', 'Better Manage', 'সহজ ম্যানেজমেন্ট', 'কী আটকে আছে, কে দায়িত্বে, আগে কী করা দরকার — এক নজরে।', 'What is stuck, who owns it, what to do first — at a glance.'],
]

const STEPS: Array<[string, string, string, string]> = [
  ['রোল আগে ঠিক করা হয়', 'The roles are set first', 'কে কী দেখবে আর কী করতে পারবে — সুপার অ্যাডমিন আগে সেটাই ঠিক করে নেন।', 'Who sees what, and who may do what, is what the Super Admin settles first.'],
  ['কাজ যার যার হাতে যায়', 'The work lands with the right person', 'রোল অনুযায়ী প্রত্যেকের হোম পেজে শুধু তার নিজের কাজ আর অপেক্ষমাণ জিনিসগুলো আসে।', 'By role, each person’s home page shows their own work and what is waiting on them.'],
  ['একবার লিখলেই সবখানে', 'Written once, counted everywhere', 'হাবে যা লেখা হয়, জোন আর হেড অফিসের হিসাবে তা নিজে থেকেই যোগ হয়।', 'What a hub writes down adds itself to the zone’s and Head Office’s figures.'],
]

/** Public home page shown before sign-in. */
export function Home() {
  const { session, loading } = useAuth()
  const { L } = usePrefs()
  const { name } = useBrandText()
  if (!loading && session) return <Navigate to="/app" replace />
  return <div className="nh">
    <PublicTop />
    <main>
      <section className="nh-hero">
        <div className="nh-hero-card">
          <p className="nh-eyebrow">{L('ব্যক্তিগত কাজের টুল', 'A PERSONAL WORK TOOL')}</p>
          <h1><span>Less Work,</span> <span>More Automation,</span> <span>Better Manage.</span></h1>
          <p className="nh-bn">{L('কম কাজ · বেশি অটোমেশন · সহজ ম্যানেজমেন্ট', `${name}’s way of working`)}</p>
          <div className="nh-acts">
            <Link to="/staff/login" className="nh-btn"><Icon name="key" size={18} />{L('স্টাফ লগইন', 'Staff login')}</Link>
            <a href="#work" className="nh-btn ghost">{L('কী কী কাজ হয়', 'What it handles')}</a>
          </div>
        </div>
        <div className="nh-motto">{MOTTO.map(([ic, en, bn, dbn, den]) => <div key={en} className="nh-m">
          <span className="nh-ic"><Icon name={ic} size={22} /></span>
          <div><b>{en}</b><span className="nh-m-bn">{L(bn, '')}</span><p>{L(dbn, den)}</p></div></div>)}</div>
      </section>

      <section className="nh-sec">
        <div className="nh-card nh-about">
          <p>{L(`${name} নিজের কাজের জন্য বানানো একটি ব্যক্তিগত টুল। দৈনন্দিন কাজ — কর্মীর তথ্য, হাজিরা, হিসাব আর পার্সেল — এক জায়গায় থাকে, তাই কে কী করবে পরিষ্কার থাকে আর হিসাব মেলাতে সময় নষ্ট হয় না। এর আলাদা কোনো উদ্দেশ্য নেই; এটি কোনো প্রতিষ্ঠানের অফিশিয়াল সিস্টেম নয়, বাইরের কারও জন্য কোনো সেবাও নয়।`,
            `${name} is a personal tool, built for my own work. The daily work — staff records, attendance, accounts and parcels — stays in one place, so what is whose is clear and no time goes into chasing figures. It has no other purpose: it is not any company’s official system, and not a service for anyone outside.`)}</p>
          <p className="muted small">{L('শুধু যাঁদের অ্যাকাউন্ট দেওয়া হয়েছে তাঁদের জন্য।', 'Only for the people who have been given an account.')}</p>
        </div>
      </section>

      <section className="nh-sec" id="work">
        <h2 className="nh-h">{L('কী কী কাজ এখানে হয়', 'What the work here covers')}</h2>
        <div className="nh-list">{WORK.map(([ic, bn, en, dbn, den]) => <div key={en} className="nh-row">
          <span className="nh-ic"><Icon name={ic} size={20} /></span>
          <div><b>{L(bn, en)}</b><p>{L(dbn, den)}</p></div></div>)}</div>
      </section>

      <section className="nh-sec">
        <h2 className="nh-h">{L('কাজ ভাগ হয় যেভাবে', 'How the work gets shared out')}</h2>
        <div className="nh-card nh-steps">{STEPS.map(([bn, en, dbn, den], i) => <div key={en} className="nh-step">
          <span className="nh-no">{L(['১', '২', '৩'][i], String(i + 1))}</span>
          <div><b>{L(bn, en)}</b><p>{L(dbn, den)}</p></div></div>)}</div>
      </section>

      <section className="nh-sec">
        <div className="nh-card">
          <h3>{L('এটি যা নয়', 'What it is not')}</h3>
          <p className="muted" style={{ margin: 0 }}>{L('এটি কোনো প্রতিষ্ঠানের অফিশিয়াল সিস্টেম নয়, পাবলিক সার্ভিস নয়, বিক্রির কোনো প্রোডাক্টও নয়। এখানে কারও কাছ থেকে টাকা নেওয়া হয় না, কোনো বিজ্ঞাপন নেই, আর যে কাজের জন্য বানানো তার বাইরে কোনো তথ্য রাখা হয় না।',
            'It is not any company’s official system, not a public service, and not a product for sale. No money is taken from anyone, there are no advertisements, and nothing is kept here beyond the work it was made for.')}</p>
          <p className="muted small" style={{ marginBottom: 0 }}><Link to="/terms">{L('ব্যবহারের শর্তাবলি পড়ুন', 'Read the terms and conditions')}</Link></p>
        </div>
      </section>
    </main>
    <div className="nh-bottom"><Link to="/staff/login" className="nh-btn solid"><Icon name="key" size={18} />{L('স্টাফ লগইন', 'Staff login')}</Link></div>
    <footer className="pub-foot">© {name} · {L('শুধু যাঁদের অ্যাকাউন্ট দেওয়া আছে', 'Only for those given an account')} · <Link to="/terms">{L('শর্তাবলি', 'Terms')}</Link></footer>
  </div>
}
