/**
 * Flow mockups preview — design review page.
 * Route: /app/preview/flow-mockups
 *
 * Shows three key screens as a storyboard:
 *   1. Staff daily entry (mobile)
 *   2. Hub manager verification + daily report (desktop)
 *   3. Zonal manager cross-hub summary (desktop)
 *
 * All data is STATIC / for visual review only. Once a screen is approved
 * it can be lifted out into its own route (/app/staff/entry, /app/hub/verify,
 * /app/zonal/today) and wired to the real supabase queries.
 */
import { Fragment, type ReactNode } from 'react'
import { AppShell } from '../../components/AppShell'
import './flow-mockups.css'

type ChipTone = 'ok' | 'pend' | 'warn' | 'bad' | 'info'
function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`fm-chip fm-chip-${tone}`}><span className="d" />{children}</span>
}

// ---------- SCREEN 1: Staff entry (mobile) ----------
function StaffEntryScreen() {
  const cells: Array<{ label: string; value: string; filled: boolean; hint: string }> = [
    { label: 'পিকআপ', value: '৪২', filled: true, hint: '✓ বসানো' },
    { label: 'ডেলিভারি', value: '৩৮', filled: true, hint: '✓ বসানো' },
    { label: 'ফেরত পার্সেল', value: '৩', filled: true, hint: '✓ বসানো' },
    { label: 'ডেলিভারি টাকা', value: '৳ —', filled: false, hint: 'কাস্টমার থেকে তোলা টাকা' },
  ]
  const history = [
    { d: 'সোম, ২৪ নভে', n: '৪৫ পার্সেল', st: 'ok' as ChipTone, lbl: 'অনুমোদিত' },
    { d: 'রবি, ২৩ নভে', n: '৪১ পার্সেল', st: 'ok' as ChipTone, lbl: 'অনুমোদিত' },
    { d: 'শনি, ২২ নভে', n: '৩৭ পার্সেল', st: 'pend' as ChipTone, lbl: 'যাচাইয়ে' },
  ]
  return (
    <div className="fm-phone">
      <div className="fm-phone-notch" />
      <div className="fm-phone-inner">
        <div className="fm-mob-top">
          <div className="fm-mob-row">
            <div>
              <div className="fm-mob-name">রাকিব হোসেন</div>
              <div className="fm-mob-sub">অটো চালক · ঢাকা জোন-১</div>
            </div>
            <div className="fm-avatar">র</div>
          </div>
        </div>
        <div className="fm-mob-date">
          <span>আজ · মঙ্গলবার, ২৫ নভেম্বর</span>
          <span>🕕 ৬:০৬ PM</span>
        </div>
        <div className="fm-mob-body">
          <div className="fm-mob-title">আজকের এন্ট্রি</div>
          <div className="fm-entry-grid">
            {cells.map(c => (
              <div key={c.label} className={`fm-entry-cell${c.filled ? ' fm-filled' : ''}`}>
                <div className="fm-lbl">{c.label}</div>
                <div className="fm-val">{c.value}</div>
                <div className="fm-tap">{c.hint}</div>
              </div>
            ))}
          </div>
          <div className="fm-divider" />
          <div className="fm-section-title">গত ৭ দিনের এন্ট্রি</div>
          <div className="fm-history">
            {history.map(h => (
              <div key={h.d} className="fm-history-row">
                <span className="fm-h-d">{h.d}</span>
                <span className="fm-h-n">{h.n}</span>
                <Chip tone={h.st}>{h.lbl}</Chip>
              </div>
            ))}
          </div>
        </div>
        <div className="fm-mob-submit">
          <button className="fm-btn-submit">সাবমিট করুন → হাবে পাঠান</button>
        </div>
      </div>
    </div>
  )
}

// ---------- SCREEN 2: Hub manager (desktop) ----------
function HubManagerScreen() {
  const stats = [
    { lbl: 'আজকের পিকআপ', val: '৩২১', delta: '▲ ৮% কাল থেকে', tone: '' },
    { lbl: 'ডেলিভারি', val: '৪১৮', delta: '▲ ১২%', tone: '' },
    { lbl: 'রিটার্ন', val: '১৭', delta: '▲ ৩ বেশি', tone: 'warn' },
    { lbl: 'ডেলিভারি টাকা', val: '৳৬২,৪০০', delta: '৪ জন বাকি মার্চেন্টে জমা দিতে', tone: 'info' },
  ]
  const entries = [
    { name: 'রাকিব হোসেন', meta: 'অটো চালক · ১৮:০৬', pk: '৪২', dl: '৩৮', rt: '৩', ca: '৳৮,২০০', pending: true },
    { name: 'নাহিদ ইসলাম', meta: 'ডেলিভারি ম্যান · ১৭:৫৮', pk: '২৭', dl: '৩৫', rt: '২', ca: '৳৬,৪৫০', pending: true },
    { name: 'জাকির আলী', meta: 'ডেলিভারি ম্যান · ১৭:৪২', pk: '৩৮', dl: '৪১', rt: '১', ca: '৳৯,১০০', pending: true },
    { name: 'সাজ্জাদ হক', meta: 'অটো চালক · ১৭:৩৫', pk: '৪৫', dl: '৩৯', rt: '৪', ca: '৳৭,৮৫০', pending: true },
    { name: 'মাহমুদ শেখ', meta: 'ডেলিভারি ম্যান · ১৬:২০', pk: '১৮', dl: '২২', rt: '১', ca: '৳৩,২০০', pending: false, late: true },
  ]
  return (
    <div className="fm-desktop">
      <div className="fm-dsk-bar">
        <div className="fm-dsk-dot" /><div className="fm-dsk-dot" /><div className="fm-dsk-dot" />
        <div className="fm-dsk-url">xzmteam.com/app/hub/dashboard</div>
      </div>
      <div className="fm-dsk-inner">
        <div className="fm-dsk-top">
          <div className="fm-dsk-brand">
            <img src="/logo.svg" width={28} height={28} alt="XZM" />
            <div className="fm-dsk-brand-txt">XZM<span className="fm-dot">·</span>TEAM</div>
          </div>
          <div className="fm-dsk-nav">
            <a className="active">ড্যাশবোর্ড</a><a>স্টাফ</a><a>কুরিয়ার</a><a>রিপোর্ট</a><a>হিসাব</a>
          </div>
          <div className="fm-dsk-user">
            <Chip tone="ok">অনলাইন</Chip>
            <div className="fm-dsk-ava">ক</div>
          </div>
        </div>

        <div className="fm-dsk-body">
          <div className="fm-dsk-page-head">
            <div>
              <h1>ঢাকা জোন-১ হাব — আজকের ড্যাশবোর্ড</h1>
              <div className="fm-dsk-sub">ম্যানেজার: করিম · ১২ জন স্টাফ · মঙ্গলবার ২৫ নভে</div>
            </div>
            <button className="fm-btn-view">⟳ রিফ্রেশ</button>
          </div>

          <div className="fm-stat-row">
            {stats.map(s => (
              <div key={s.lbl} className={`fm-stat ${s.tone}`}>
                <div className="fm-stat-ic">◆</div>
                <div className="fm-stat-lbl">{s.lbl}</div>
                <div className="fm-stat-val">{s.val}</div>
                <div className="fm-stat-delta">{s.delta}</div>
              </div>
            ))}
          </div>

          <div className="fm-dsk-cols">
            <div className="fm-panel">
              <div className="fm-panel-tabs">
                <div className="fm-panel-tab active">যাচাইয়ের অপেক্ষায় (৫)</div>
                <div className="fm-panel-tab">অনুমোদিত (৭)</div>
                <div className="fm-panel-tab">বাতিল (০)</div>
              </div>
              <table className="fm-tbl">
                <thead>
                  <tr><th>স্টাফ</th><th>পিকআপ</th><th>ডেলি.</th><th>রিটার্ন</th><th>ডেলি. টাকা</th><th>অ্যাকশন</th></tr>
                </thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.name} className={e.late ? 'fm-row-warn' : ''}>
                      <td className="fm-name">
                        <b>{e.name}</b>
                        <span>{e.meta}{e.late && <> <Chip tone="warn">দেরি</Chip></>}</span>
                      </td>
                      <td className="fm-nums">{e.pk}</td>
                      <td className="fm-nums">{e.dl}</td>
                      <td className="fm-nums">{e.rt}</td>
                      <td className="fm-nums">{e.ca}</td>
                      <td>
                        {e.pending ? (
                          <>
                            <button className="fm-btn fm-btn-approve">✓ অনুমোদন</button>
                            <button className="fm-btn fm-btn-reject">বাতিল</button>
                          </>
                        ) : (
                          <button className="fm-btn fm-btn-view">বিস্তারিত</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="fm-panel">
              <div className="fm-panel-head"><h3>আজকের হাব রিপোর্ট</h3></div>
              <div className="fm-report-card">
                <div className="fm-total">
                  <div className="fm-total-l">মোট ডেলিভারি টাকা</div>
                  <div className="fm-total-v">৳৬২,৪০০</div>
                </div>
                <div className="fm-report-line"><span className="fm-k">মোট পিকআপ</span><span className="fm-v">৩২১</span></div>
                <div className="fm-report-line"><span className="fm-k">মোট ডেলিভারি</span><span className="fm-v">৪১৮</span></div>
                <div className="fm-report-line"><span className="fm-k">মোট রিটার্ন</span><span className="fm-v">১৭</span></div>
                <div className="fm-report-line fm-highlight"><span className="fm-k">মার্চেন্টে জমা</span><span className="fm-v">৳৫৫,৪০০</span></div>
                <div className="fm-report-line"><span className="fm-k">হাব খরচ</span><span className="fm-v">৳২,১০০</span></div>
                <div className="fm-report-line"><span className="fm-k">ব্যাংক জমা</span><span className="fm-v">৳৫৩,৩০০</span></div>
                <button className="fm-report-btn">রিপোর্ট জমা দিন → জোনে পাঠান</button>
                <button className="fm-btn-view fm-wide">↓ Excel এক্সপোর্ট</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- SCREEN 3: Zonal manager (desktop) ----------
function ZonalManagerScreen() {
  const stats = [
    { lbl: 'মোট ডেলিভারি', val: '১,৮৪২', delta: '▲ ১৫% কাল', tone: '' },
    { lbl: 'মোট পিকআপ', val: '১,৪২৭', delta: '▲ ৯%', tone: '' },
    { lbl: 'রিটার্ন', val: '৮৬', delta: '৪.৭% হার', tone: 'warn' },
    { lbl: 'মোট ডেলিভারি টাকা', val: '৳২,৪৮,৬০০', delta: '৩ হাব রিপোর্ট জমা', tone: 'info' },
  ]
  const hubs: Array<{ name: string; mgr: string; staff: string; pk: string; dl: string; rt: string; ca: string; status: ChipTone; statusLbl: string; action: string; row?: string }> = [
    { name: 'ঢাকা জোন-১', mgr: 'করিম · ১২ স্টাফ', staff: '১২/১২', pk: '৩২১', dl: '৪১৮', rt: '১৭', ca: '৳৬২,৪০০', status: 'ok', statusLbl: 'রিপোর্ট জমা', action: 'বিস্তারিত' },
    { name: 'চট্টগ্রাম জোন-২', mgr: 'সালাম · ৮ স্টাফ', staff: '৭/৮', pk: '২১০', dl: '২৮৬', rt: '৯', ca: '৳৪১,৮৫০', status: 'warn', statusLbl: 'রিপোর্ট বাকি', action: 'মনে করান', row: 'warn' },
    { name: 'সিলেট জোন-৩', mgr: 'জামিল · ৯ স্টাফ', staff: '৯/৯', pk: '২৯৮', dl: '৩৭২', rt: '২১', ca: '৳৫৮,৭০০', status: 'ok', statusLbl: 'রিপোর্ট জমা', action: 'বিস্তারিত' },
    { name: 'খুলনা জোন-৪', mgr: 'রহমান · ১০ স্টাফ', staff: '৫/১০ ⚠', pk: '১৮৭', dl: '২৪১', rt: '১৮', ca: '৳৩৫,২০০', status: 'bad', statusLbl: 'হাজিরা কম', action: 'কল করুন', row: 'bad' },
    { name: 'রাজশাহী জোন-৫', mgr: 'আলম · ৯ স্টাফ', staff: '৯/৯', pk: '৪১১', dl: '৫২৫', rt: '২১', ca: '৳৫০,৪৫০', status: 'ok', statusLbl: 'রিপোর্ট জমা', action: 'বিস্তারিত' },
  ]
  return (
    <div className="fm-desktop">
      <div className="fm-dsk-bar">
        <div className="fm-dsk-dot" /><div className="fm-dsk-dot" /><div className="fm-dsk-dot" />
        <div className="fm-dsk-url">xzmteam.com/app/zonal/dashboard</div>
      </div>
      <div className="fm-dsk-inner">
        <div className="fm-dsk-top">
          <div className="fm-dsk-brand">
            <img src="/logo.svg" width={28} height={28} alt="XZM" />
            <div className="fm-dsk-brand-txt">XZM<span className="fm-dot">·</span>TEAM</div>
          </div>
          <div className="fm-dsk-nav">
            <a className="active">সব হাব</a><a>স্টাফ</a><a>অ্যাটেনডেন্স</a><a>রুট</a><a>রিপোর্ট</a>
          </div>
          <div className="fm-dsk-user">
            <Chip tone="info">জোনাল ম্যা.</Chip>
            <div className="fm-dsk-ava">ম</div>
          </div>
        </div>
        <div className="fm-dsk-body">
          <div className="fm-dsk-page-head">
            <div>
              <h1>ঢাকা জোন — আজকের অবস্থা</h1>
              <div className="fm-dsk-sub">৫টি হাব · ৪৮ জন স্টাফ · ২৫ নভে ২০২৬</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="fm-btn-view">↓ সব হাবের Excel</button>
              <button className="fm-report-btn" style={{ marginTop: 0, width: 'auto', padding: '8px 14px' }}>+ নতুন অ্যাসাইন</button>
            </div>
          </div>
          <div className="fm-zone-alert">⚠ <b>২টি হাব এখনো দৈনিক রিপোর্ট জমা দেয়নি</b> — চট্টগ্রাম জোন-২, খুলনা জোন-৪ । ৭:০০ PM ডেডলাইন।</div>
          <div className="fm-stat-row">
            {stats.map(s => (
              <div key={s.lbl} className={`fm-stat ${s.tone}`}>
                <div className="fm-stat-ic">◆</div>
                <div className="fm-stat-lbl">{s.lbl}</div>
                <div className="fm-stat-val">{s.val}</div>
                <div className="fm-stat-delta">{s.delta}</div>
              </div>
            ))}
          </div>
          <div className="fm-panel">
            <div className="fm-panel-head">
              <h3>হাবভিত্তিক দৈনিক সারাংশ</h3>
              <input type="text" placeholder="হাব খুঁজুন…" className="fm-search" />
            </div>
            <table className="fm-tbl">
              <thead>
                <tr><th>হাব</th><th>স্টাফ</th><th>পিকআপ · ডেলি · রিটার্ন</th><th>ডেলি. টাকা</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th></tr>
              </thead>
              <tbody>
                {hubs.map(h => (
                  <tr key={h.name} className={h.row === 'warn' ? 'fm-row-warn' : h.row === 'bad' ? 'fm-row-bad' : ''}>
                    <td><div className="fm-hname">{h.name}</div><div className="fm-mgr">{h.mgr}</div></td>
                    <td>{h.staff}</td>
                    <td>
                      <div className="fm-nums-mini">
                        <span>পি: <b>{h.pk}</b></span>
                        <span>ডে: <b>{h.dl}</b></span>
                        <span>রি: <b>{h.rt}</b></span>
                      </div>
                    </td>
                    <td className="fm-nums">{h.ca}</td>
                    <td><Chip tone={h.status}>{h.statusLbl}</Chip></td>
                    <td><button className="fm-btn-view">{h.action}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Flow bar (storyboard header) ----------
function FlowBar() {
  const steps = [
    { n: '১', t: 'স্টাফ এন্ট্রি', s: 'মোবাইল · দৈনিক সংখ্যা' },
    { n: '২', t: 'হাব ম্যানেজার যাচাই', s: 'ডেস্কটপ · অনুমোদন + রিপোর্ট' },
    { n: '৩', t: 'জোনাল সারাংশ', s: 'ডেস্কটপ · সব হাব একসাথে' },
  ]
  return (
    <div className="fm-flow">
      {steps.map((s, i) => (
        <Fragment key={s.n}>
          <div className={`fm-flow-step${i === 0 ? ' active' : ''}`}>
            <div className="fm-flow-num">{s.n}</div>
            <div className="fm-flow-text"><b>{s.t}</b><span>{s.s}</span></div>
          </div>
          {i < steps.length - 1 && <div className="fm-flow-arrow">→</div>}
        </Fragment>
      ))}
    </div>
  )
}

// ---------- Main ----------
export default function FlowMockups() {
  return (
    <AppShell
      title="UI মকআপ — কুরিয়ার ফ্লো প্রিভিউ"
      subtitle="স্টাফ এন্ট্রি → হাব অনুমোদন → জোনাল সারাংশ"
    >
      <div className="fm-notice">
        <b>⚠ ডিজাইন প্রিভিউ</b> — এই পেজের সব ডেটা স্ট্যাটিক, বাটনগুলো কাজ করে না।
        রিভিউর জন্য রাখা আছে, অনুমোদন পেলে প্রতিটা স্ক্রিন আলাদা রাউটে বসিয়ে real data-র সাথে wire করা হবে।
      </div>

      <FlowBar />

      <section className="fm-section">
        <div className="fm-section-head">
          <div className="fm-section-num">১</div>
          <h2>স্টাফ এন্ট্রি <span className="fm-role">মোবাইল · স্টাফ রোল</span></h2>
          <p>স্টাফ দিনশেষে ৪টা সংখ্যা ট্যাপ করে বসায়। সাবমিট করলে হাব ম্যানেজারের কাছে যায়।</p>
        </div>
        <StaffEntryScreen />
      </section>

      <div className="fm-arrow-down">↓</div>

      <section className="fm-section">
        <div className="fm-section-head">
          <div className="fm-section-num">২</div>
          <h2>হাব ম্যানেজার যাচাই <span className="fm-role">ডেস্কটপ · হাব ম্যানেজার</span></h2>
          <p>স্টাফদের জমা হওয়া এন্ট্রি দেখে অনুমোদন দেন, হাবের সারাংশ তৈরি হয়, দিনশেষে এক ক্লিকে রিপোর্ট জোনাল ম্যানেজারের কাছে পাঠান।</p>
        </div>
        <HubManagerScreen />
      </section>

      <div className="fm-arrow-down">↓</div>

      <section className="fm-section">
        <div className="fm-section-head">
          <div className="fm-section-num">৩</div>
          <h2>জোনাল ম্যানেজার সারাংশ <span className="fm-role">ডেস্কটপ · জোনাল ম্যানেজার</span></h2>
          <p>সব হাবের আজকের অবস্থা এক পেজে — কোন হাব জমা দিয়েছে, কোনটা বাকি, কোথায় ইস্যু। এক ক্লিকে সব হাবের Excel।</p>
        </div>
        <ZonalManagerScreen />
      </section>
    </AppShell>
  )
}
