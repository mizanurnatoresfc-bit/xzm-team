import { Link } from 'react-router-dom'
import { PublicTop } from '../components/PublicTop'
import { Icon } from '../components/Icon'
import { usePrefs } from '../lib/prefs'
import { useBrandText } from '../components/Brand'

const UPDATED = ['১৪ নভেম্বর ২০২৬', '14 November 2026']

/** [title bn, title en, paragraphs [bn, en][]] */
const SECTIONS: Array<[string, string, Array<[string, string]>]> = [
  ['এটা কী', 'What this is', [
    ['এটি নিজের কাজের জন্য বানানো একটি ব্যক্তিগত টুল। দৈনন্দিন কাজ — কর্মীর তথ্য, হাজিরা, ছুটি, কুরিয়ার অপারেশন, দৈনিক হিসাব ও রিপোর্ট — এক জায়গায় এনে কাজ সহজ করা আর দ্রুত ভাগ করে দেওয়াই এর একমাত্র উদ্দেশ্য।',
     'This is a personal tool, built for my own work. Its only purpose is to bring the daily work — staff records, attendance, leave, courier operations, daily accounts and reports — into one place, so the work is easier to do and quicker to share out.'],
    ['এটি কোনো প্রতিষ্ঠানের অফিশিয়াল সিস্টেম নয়, বাইরের কারও জন্য কোনো সেবাও নয়। এখানে কিছু বিক্রি হয় না, কারও কাছ থেকে টাকা নেওয়া হয় না, এবং যে কাজের জন্য বানানো তার বাইরে অন্য কোনো উদ্দেশ্যে ব্যবহার হয় না।',
     'It is not any company’s official system, and not a service for anyone outside. Nothing is sold here, no money is taken from anyone, and it is not used for any purpose beyond the work it was made for.'],
  ]],
  ['কে ব্যবহার করতে পারবেন', 'Who may use it', [
    ['শুধু যাঁদের অ্যাকাউন্ট দেওয়া হয়েছে তাঁরা। অ্যাকাউন্ট তৈরি করে দেন সিস্টেম অ্যাডমিন; নিজে থেকে কেউ অ্যাকাউন্ট খুলতে পারেন না।',
     'Only the people who have been given an account. Accounts are created by the system administrator; nobody can open one for themselves.'],
    ['নিজের অ্যাকাউন্ট নিজেই ব্যবহার করবেন। অন্যের অ্যাকাউন্টে ঢোকা বা নিজের অ্যাকাউন্ট অন্যকে দেওয়া — কোনোটাই করা যাবে না।',
     'Use your own account. Do not sign in to anyone else’s account, and do not hand yours to another person.'],
  ]],
  ['পাসওয়ার্ড ও নিরাপত্তা', 'Password and security', [
    ['পাসওয়ার্ড আপনার নিজের দায়িত্ব — কাউকে বলবেন না, কোথাও লিখে রাখবেন না। প্রথমবার লগইনের পর পাসওয়ার্ড বদলে নিতে হয়।',
     'Your password is yours to protect — tell nobody, write it nowhere. You change it yourself after the first sign-in.'],
    ['পরপর ৫ বার ভুল পাসওয়ার্ড দিলে অ্যাকাউন্ট ৩০ মিনিটের জন্য বন্ধ থাকে। অ্যাকাউন্ট নিয়ে সন্দেহ হলে সঙ্গে সঙ্গে সিস্টেম অ্যাডমিনকে জানাবেন।',
     'Five wrong passwords in a row lock the account for 30 minutes. If anything about your account looks wrong, tell the system administrator at once.'],
  ]],
  ['কী তথ্য রাখা হয়', 'What is kept here', [
    ['কাজের প্রয়োজনে যা লাগে তাই: কর্মীর প্রোফাইল ও পদবি, হাজিরা ও ছুটি, বেতন-সংক্রান্ত হিসাব, পার্সেল ও পেমেন্টের রেকর্ড, দৈনিক হিসাবের লাইন এবং আপলোড করা বিল, ভাউচার ও স্ক্রিনশট।',
     'What the work needs: staff profiles and positions, attendance and leave, pay-related records, parcel and payment records, the daily account lines, and the bills, vouchers and screenshots uploaded with them.'],
    ['ব্যক্তিগত তথ্য (যেমন NID, জন্মতারিখ, ঠিকানা) শুধু চাকরি-সংক্রান্ত প্রয়োজনে রাখা হয় এবং যাঁদের দেখার অনুমতি আছে তাঁরাই দেখতে পান।',
     'Personal details such as NID, date of birth and address are kept only for employment purposes, and only people with permission to see them can.'],
  ]],
  ['কে কী দেখতে পাবেন', 'Who sees what', [
    ['প্রত্যেকে নিজের রোল ও এলাকার (এরিয়া/হাব) তথ্যই দেখতে পান। এই সীমা ডাটাবেসেই বসানো — পাতা বা মেনু লুকিয়ে নয়, তাই লিংক জানা থাকলেও সীমার বাইরের তথ্য আসে না।',
     'Everyone sees the records of their own role and their own area (zone or hub). These limits sit in the database itself, not in hidden pages or menus, so knowing a link does not bring back anything beyond them.'],
    ['কোন রোল কী দেখবে ও করতে পারবে, তা ঠিক করেন সুপার অ্যাডমিন।',
     'What each role may see and do is decided by the Super Admin.'],
  ]],
  ['প্রতিটি কাজের রেকর্ড থাকে', 'Every change is recorded', [
    ['কে কখন কী যোগ করেছেন, বদলেছেন বা বাদ দিয়েছেন — সবই লগে থাকে। হিসাব বা রিপোর্টে গরমিল হলে এই লগ দেখেই মেলানো হয়।',
     'Who added, changed or removed what, and when, is kept in the log. When the accounts or a report do not agree, that log is how it is settled.'],
  ]],
  ['যা করবেন না', 'What you must not do', [
    ['মিথ্যা বা বানানো তথ্য দেওয়া, অন্যের নামে এন্ট্রি করা, বা বিল-ভাউচার সাজিয়ে দেওয়া।',
     'Enter false or invented information, make entries in someone else’s name, or dress up bills and vouchers.'],
    ['এখানকার তথ্য, স্ক্রিনশট বা রিপোর্ট বাইরের কাউকে দেওয়া, সোশ্যাল মিডিয়ায় দেওয়া বা নিজের আলাদা কাজে ব্যবহার করা।',
     'Pass the data, screenshots or reports kept here to outsiders, post them on social media, or use them for ends of your own.'],
    ['সিস্টেমের নিরাপত্তা পরীক্ষা বা ভাঙার চেষ্টা, অন্যের অনুমতি নেওয়ার চেষ্টা, বা কোনো স্বয়ংক্রিয় টুল দিয়ে তথ্য টেনে নেওয়া।',
     'Probe or break the system’s security, try to take someone else’s permissions, or pull data out with automated tools.'],
  ]],
  ['তথ্যের মালিকানা', 'Who the records belong to', [
    ['এখানে রাখা সব রেকর্ড এই টুলের মালিকের। প্রয়োজনে তিনি এই তথ্য দেখতে, নিতে ও ব্যবহার করতে পারেন।',
     'Every record kept here belongs to the owner of this tool, who may look at it, take a copy of it and use it as the work requires.'],
  ]],
  ['ভুল হলে সংশোধন', 'Putting mistakes right', [
    ['কোনো তথ্য ভুল থাকলে নিজে মুছবেন না — সংশ্লিষ্ট ম্যানেজার বা হেড অফিসকে জানিয়ে সংশোধন করান। সংশোধনের ইতিহাস রেকর্ডে থেকে যায়, এটাই নিয়ম।',
     'If something is wrong, do not quietly delete it — ask the manager concerned or Head Office to correct it. The history of the correction stays on the record; that is how it is meant to work.'],
  ]],
  ['চাকরি শেষ হলে', 'When someone leaves', [
    ['কর্মী চলে গেলে তাঁর লগইন বন্ধ করে দেওয়া হয়। তাঁর করা কাজের রেকর্ড হিসাবের প্রয়োজনে সংরক্ষিত থাকে।',
     'When a member of staff leaves, their login is closed. The records of the work they did stay, because the accounts need them.'],
  ]],
  ['সিস্টেম বন্ধ থাকা', 'When the system is down', [
    ['রক্ষণাবেক্ষণ, আপডেট বা ইন্টারনেট সমস্যার কারণে সিস্টেম মাঝেমধ্যে বন্ধ থাকতে পারে। জরুরি কাজ যেন আটকে না যায়, সে জন্য হাতে লেখা রেকর্ড রাখার অভ্যাস রাখবেন।',
     'The system may be down now and then for maintenance, updates or internet trouble. Keep the habit of a written note so urgent work is not held up.'],
  ]],
  ['নিয়ম না মানলে', 'If these rules are broken', [
    ['নিয়ম ভাঙলে অ্যাক্সেস বন্ধ করা হতে পারে, এবং বিষয়টি নিয়ে পরে আলাদা ব্যবস্থা নেওয়া হতে পারে।',
     'Access may be closed, and the matter may be taken further afterwards.'],
  ]],
  ['শর্ত বদলানো', 'Changes to these terms', [
    ['প্রয়োজনে এই শর্তাবলি বদলানো হতে পারে। বদলানো হলে এই পাতায় নতুন তারিখসহ দেওয়া থাকবে।',
     'These terms may change when they need to. A change appears on this page with its new date.'],
  ]],
  ['যোগাযোগ', 'Who to ask', [
    ['অ্যাকাউন্ট, অনুমতি বা তথ্য সংক্রান্ত যেকোনো বিষয়ে সিস্টেম অ্যাডমিনের সঙ্গে যোগাযোগ করুন।',
     'For anything about accounts, permissions or records, speak to the system administrator.'],
  ]],
]

/** Public terms of use for the people given an account here. */
export function Terms() {
  const { L, n } = usePrefs()
  const { name } = useBrandText()
  return <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>
    <PublicTop />
    <main className="doc-wrap">
      <article className="doc">
        <p className="eyebrow">{name}</p>
        <h1>{L('ব্যবহারের শর্তাবলি', 'Terms and conditions')}</h1>
        <p className="muted">{L(`নিজের কাজের জন্য ব্যক্তিগত টুল · সর্বশেষ হালনাগাদ ${UPDATED[0]}`,
          `A personal work tool · last updated ${UPDATED[1]}`)}</p>
        <p className="notice">{L('এই সিস্টেমে লগইন করার অর্থ — আপনি নিচের শর্তগুলো পড়েছেন ও মেনে চলতে রাজি আছেন।',
          'Signing in to this system means you have read the terms below and agree to follow them.')}</p>

        {SECTIONS.map(([bn, en, paras], i) => <section key={en}>
          <h2>{n(i + 1)}. {L(bn, en)}</h2>
          {paras.map(([pb, pe]) => <p key={pe}>{L(pb, pe)}</p>)}
        </section>)}

        <div className="row no-print" style={{ marginTop: 22 }}>
          <Link to="/staff/login"><button><Icon name="key" size={16} />{L('স্টাফ লগইন', 'Staff login')}</button></Link>
          <button className="secondary" onClick={() => window.print()}><Icon name="print" size={16} />{L('প্রিন্ট / PDF', 'Print / PDF')}</button>
          <Link to="/"><button className="secondary">{L('হোম পেজ', 'Home')}</button></Link>
        </div>
      </article>
    </main>
    <footer className="pub-foot">© {name} · {L('শুধু যাঁদের অ্যাকাউন্ট দেওয়া আছে', 'Only for those given an account')}</footer>
  </div>
}
