import { useMemo, useState } from 'react'

type DemoUser = { id: number; name: string; email: string; mobile: string; role: string; area: string; status: 'Active' | 'Locked' | 'Disabled'; lastLogin: string }

const SAMPLE: DemoUser[] = [
  { id: 1, name: 'রহিম উদ্দিন', email: 'rahim.demo@example.test', mobile: '01700-000001', role: 'Zonal Manager', area: 'Natore Zone', status: 'Active', lastLogin: 'Today, 09:30' },
  { id: 2, name: 'সুমাইয়া আক্তার', email: 'sumaiya.demo@example.test', mobile: '01700-000002', role: 'Staff', area: 'Natore Sadar', status: 'Active', lastLogin: 'Today, 08:15' },
  { id: 3, name: 'ইমরান হোসেন', email: 'imran.demo@example.test', mobile: '01700-000003', role: 'Rider', area: 'Baraigram Hub', status: 'Locked', lastLogin: 'Yesterday' },
  { id: 4, name: 'নুসরাত জাহান', email: 'nusrat.demo@example.test', mobile: '01700-000004', role: 'Manager', area: 'Lalpur Hub', status: 'Active', lastLogin: 'Yesterday' },
  { id: 5, name: 'আরিফুল ইসলাম', email: 'arif.demo@example.test', mobile: '01700-000005', role: 'Helper', area: 'Natore Sadar', status: 'Disabled', lastLogin: '—' },
  { id: 6, name: 'তানভীর আহমেদ', email: 'tanvir.demo@example.test', mobile: '01700-000006', role: 'Staff', area: 'Singra Zone', status: 'Active', lastLogin: '20 Nov 2026' },
  { id: 7, name: 'মেহেদী হাসান', email: 'mehedi.demo@example.test', mobile: '01700-000007', role: 'Rider', area: 'Gurudaspur Hub', status: 'Active', lastLogin: '20 Nov 2026' },
  { id: 8, name: 'ফারজানা ইয়াসমিন', email: 'farzana.demo@example.test', mobile: '01700-000008', role: 'Staff', area: 'Naldanga Zone', status: 'Locked', lastLogin: '19 Nov 2026' },
]

export function UsersDemoPreview() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const filtered = useMemo(() => SAMPLE.filter(user => {
    const haystack = [user.name, user.email, user.mobile, user.role, user.area].join(' ').toLowerCase()
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (status === 'all' || user.status === status)
  }), [query, status])

  return <main className="udp-page">
    <style>{`
      .udp-page{min-height:100vh;background:#f4f7fb;color:#172033;padding:clamp(16px,3vw,36px);font-family:inherit}
      .udp-wrap{max-width:1180px;margin:0 auto}.udp-top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:24px}
      .udp-brand{display:flex;align-items:center;gap:12px}.udp-logo{width:44px;height:44px;border-radius:14px;background:#173b70;color:white;display:grid;place-items:center;font-weight:800}
      .udp-brand strong{display:block;font-size:18px}.udp-brand small{color:#64748b}.udp-demo{border:1px solid #f3d18a;background:#fff8e7;color:#8a5a00;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:700}
      .udp-head{margin-bottom:20px}.udp-head h1{font-size:clamp(24px,3vw,32px);margin:0 0 6px}.udp-head p{margin:0;color:#64748b}
      .udp-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}.udp-stat,.udp-panel{background:white;border:1px solid #e5eaf1;border-radius:16px;box-shadow:0 4px 16px #152b4b08}
      .udp-stat{padding:16px}.udp-stat span{display:block;color:#64748b;font-size:13px}.udp-stat b{display:block;font-size:26px;margin-top:5px}
      .udp-panel{padding:18px}.udp-filters{display:grid;grid-template-columns:minmax(0,1fr) 220px auto;gap:12px;align-items:end;margin-bottom:16px}
      .udp-field label{display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:6px}.udp-field input,.udp-field select{width:100%;height:42px;border:1px solid #dbe3ee;border-radius:10px;padding:0 12px;background:white;color:#172033;font:inherit}
      .udp-btn{height:42px;border:0;border-radius:10px;padding:0 14px;background:#173b70;color:white;font-weight:700;cursor:pointer}.udp-btn.secondary{background:#edf2f8;color:#334155}
      .udp-table-wrap{overflow:auto}.udp-table{width:100%;border-collapse:collapse;min-width:760px}.udp-table th,.udp-table td{text-align:left;padding:13px 12px;border-bottom:1px solid #edf1f6;font-size:13px}.udp-table th{color:#64748b;background:#f8fafc;font-size:12px}.udp-table td strong{display:block}.udp-table td small{display:block;color:#64748b;margin-top:3px}
      .udp-status{display:inline-block;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:700;background:#e8f7ee;color:#14743c}.udp-status.locked{background:#fff4dc;color:#946200}.udp-status.disabled{background:#f1f3f6;color:#64748b}
      .udp-foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:#64748b;font-size:12px;margin-top:14px}.udp-note{margin-top:18px;padding:12px 14px;border-radius:12px;background:#eef5ff;color:#31547e;font-size:13px}
      @media(max-width:760px){.udp-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.udp-filters{grid-template-columns:1fr}.udp-panel{padding:12px}}
      @media print{.udp-page{padding:0;background:white}.udp-demo,.udp-filters,.udp-note,.udp-top button{display:none!important}.udp-panel,.udp-stat{box-shadow:none}}
    `}</style>
    <div className="udp-wrap">
      <header className="udp-top">
        <div className="udp-brand"><div className="udp-logo">XZM</div><div><strong>XZM-TEAM</strong><small>Management Console · Preview</small></div></div>
        <span className="udp-demo">DEMO MODE · SAMPLE DATA ONLY</span>
      </header>
      <section className="udp-head"><h1>ইউজার ও রোল</h1><p>কর্মী অ্যাকাউন্ট, রোল ও অ্যাক্সেসের নমুনা প্রিভিউ</p></section>
      <section className="udp-stats">
        <div className="udp-stat"><span>মোট অ্যাকাউন্ট</span><b>{SAMPLE.length}</b></div>
        <div className="udp-stat"><span>সক্রিয়</span><b>{SAMPLE.filter(x => x.status === 'Active').length}</b></div>
        <div className="udp-stat"><span>লক</span><b>{SAMPLE.filter(x => x.status === 'Locked').length}</b></div>
        <div className="udp-stat"><span>বন্ধ</span><b>{SAMPLE.filter(x => x.status === 'Disabled').length}</b></div>
      </section>
      <section className="udp-panel">
        <div className="udp-filters">
          <div className="udp-field"><label htmlFor="udp-search">খুঁজুন</label><input id="udp-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="নাম, ইমেইল, মোবাইল, রোল বা হাব" /></div>
          <div className="udp-field"><label htmlFor="udp-status">অ্যাকাউন্টের অবস্থা</label><select id="udp-status" value={status} onChange={e => setStatus(e.target.value)}><option value="all">সব অবস্থা</option><option value="Active">সক্রিয়</option><option value="Locked">লক</option><option value="Disabled">বন্ধ</option></select></div>
          <button className="udp-btn secondary" onClick={() => { setQuery(''); setStatus('all') }}>ফিল্টার রিসেট</button>
        </div>
        <div className="udp-table-wrap"><table className="udp-table"><thead><tr><th>নাম ও ইমেইল</th><th>মোবাইল</th><th>রোল</th><th>জোন / হাব</th><th>শেষ লগইন</th><th>অবস্থা</th></tr></thead>
          <tbody>{filtered.map(user => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{user.mobile}</td><td>{user.role}</td><td>{user.area}</td><td>{user.lastLogin}</td><td><span className={`udp-status ${user.status.toLowerCase()}`}>{user.status === 'Active' ? 'সক্রিয়' : user.status === 'Locked' ? 'লক' : 'বন্ধ'}</span></td></tr>)}
          {filtered.length === 0 && <tr><td colSpan={6} style={{textAlign:'center',padding:32,color:'#64748b'}}>কোনো নমুনা অ্যাকাউন্ট পাওয়া যায়নি</td></tr>}</tbody></table></div>
        <div className="udp-foot"><span>{filtered.length} / {SAMPLE.length} টি নমুনা অ্যাকাউন্ট</span><span>এখানে কোনো আসল অ্যাকাউন্ট ডেটা নেই</span></div>
      </section>
      <div className="udp-note">এটি শুধু UI Preview। এখানে দেখানো সব নাম, ইমেইল ও মোবাইল নম্বর কাল্পনিক। কোনো Login, Database বা Live Data-এর সাথে সংযোগ নেই।</div>
    </div>
  </main>
}
