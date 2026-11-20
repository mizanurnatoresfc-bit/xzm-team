import { useMemo, useState } from 'react'

type DemoUser = { id: string; name: string; email: string; role: string; hub: string; status: 'সক্রিয়' | 'বন্ধ' | 'লক'; employeeId: string }

const DEMO_USERS: DemoUser[] = [
  { id: 'demo-01', name: 'রাফি উদাহরণ', email: 'rafi.demo@example.test', role: 'সাধারণ স্টাফ', hub: 'নাটোর ডেমো হাব', status: 'সক্রিয়', employeeId: 'DEMO-001' },
  { id: 'demo-02', name: 'সুমাইয়া নমুনা', email: 'sumaiya.demo@example.test', role: 'হাব ম্যানেজার', hub: 'রাজশাহী ডেমো হাব', status: 'সক্রিয়', employeeId: 'DEMO-002' },
  { id: 'demo-03', name: 'তানভীর নমুনা', email: 'tanvir.demo@example.test', role: 'ড্রাইভার', hub: 'নাটোর ডেমো হাব', status: 'লক', employeeId: 'DEMO-003' },
  { id: 'demo-04', name: 'মেহের উদাহরণ', email: 'meher.demo@example.test', role: 'হেল্পার', hub: 'বগুড়া ডেমো হাব', status: 'বন্ধ', employeeId: 'DEMO-004' },
  { id: 'demo-05', name: 'আরিফ নমুনা', email: 'arif.demo@example.test', role: 'জোনাল ম্যানেজার', hub: 'উত্তরাঞ্চল ডেমো জোন', status: 'সক্রিয়', employeeId: 'DEMO-005' },
]

export function DemoUsersPreview() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('সব')
  const [view, setView] = useState<'table' | 'cards'>('table')
  const [page, setPage] = useState(1)
  const pageSize = 4
  const filtered = useMemo(() => DEMO_USERS.filter(user => {
    const matches = `${user.name} ${user.email} ${user.role} ${user.hub} ${user.employeeId}`.toLowerCase().includes(query.trim().toLowerCase())
    return matches && (status === 'সব' || user.status === status)
  }), [query, status])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const reset = () => { setQuery(''); setStatus('সব'); setPage(1) }
  const exportCsv = () => {
    const rows = [['নাম', 'ইমেইল', 'রোল', 'হাব', 'স্ট্যাটাস', 'কর্মী আইডি'], ...filtered.map(u => [u.name, u.email, u.role, u.hub, u.status, u.employeeId])]
    const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'xzm-demo-users.csv'; a.click(); URL.revokeObjectURL(url)
  }
  return <main className="demo-users">
    <header className="demo-header">
      <a className="demo-brand" href="/">XZM-TEAM</a>
      <span className="demo-pill">PUBLIC DEMO · SAMPLE DATA ONLY</span>
    </header>
    <section className="demo-intro">
      <p className="demo-eyebrow">XZM-TEAM · PREVIEW WORKSPACE</p>
      <h1>ইউজার ও রোল — ডেমো প্রিভিউ</h1>
      <p>লগইন ছাড়াই UI পরীক্ষা করুন। এখানে দেখানো সব নাম, ইমেইল ও অ্যাকাউন্ট সম্পূর্ণ কাল্পনিক নমুনা। কোনো লাইভ ডেটা লোড বা পরিবর্তন করা হয় না।</p>
    </section>
    <section className="demo-stats" aria-label="ডেমো সারসংক্ষেপ">
      <article><span>মোট অ্যাকাউন্ট</span><strong>{DEMO_USERS.length}</strong></article>
      <article><span>সক্রিয়</span><strong>{DEMO_USERS.filter(u => u.status === 'সক্রিয়').length}</strong></article>
      <article><span>লক</span><strong>{DEMO_USERS.filter(u => u.status === 'লক').length}</strong></article>
      <article><span>নমুনা ডেটা</span><strong>১০০%</strong></article>
    </section>
    <section className="demo-panel">
      <div className="demo-panel-head"><div><h2>অ্যাকাউন্ট তালিকা</h2><span>{filtered.length}টি নমুনা অ্যাকাউন্ট</span></div><span className="demo-readonly">শুধু দেখার জন্য</span></div>
      <div className="demo-filters">
        <label>খুঁজুন<input value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} placeholder="নাম, ইমেইল, রোল, হাব বা আইডি" /></label>
        <label>অবস্থা<select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option>সব</option><option>সক্রিয়</option><option>বন্ধ</option><option>লক</option></select></label>
        <button className="demo-secondary" onClick={reset}>রিসেট</button>
      </div>
      <div className="demo-toolbar">
        <div><button className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}>টেবিল</button><button className={view === 'cards' ? 'selected' : ''} onClick={() => setView('cards')}>কার্ড</button></div>
        <div><button className="demo-secondary" onClick={() => window.print()}>প্রিন্ট</button><button className="demo-primary" onClick={exportCsv}>CSV এক্সপোর্ট</button></div>
      </div>
      {view === 'table' ? <div className="demo-table-wrap"><table className="demo-table"><thead><tr><th>নাম</th><th>রোল ও জায়গা</th><th>কর্মী আইডি</th><th>অবস্থা</th></tr></thead><tbody>
        {visible.map(u => <tr key={u.id}><td><strong>{u.name}</strong><small>{u.email}</small></td><td>{u.role}<small>{u.hub}</small></td><td>{u.employeeId}</td><td><span className={'demo-status ' + (u.status === 'সক্রিয়' ? 'good' : u.status === 'লক' ? 'warn' : 'off')}>{u.status}</span></td></tr>)}
      </tbody></table></div> : <div className="demo-cards">{visible.map(u => <article key={u.id}><div><strong>{u.name}</strong><span className={'demo-status ' + (u.status === 'সক্রিয়' ? 'good' : u.status === 'লক' ? 'warn' : 'off')}>{u.status}</span></div><small>{u.email}</small><p>{u.role} · {u.hub}</p><small>{u.employeeId}</small></article>)}</div>}
      {visible.length === 0 && <p className="demo-empty">কোনো নমুনা অ্যাকাউন্ট পাওয়া যায়নি।</p>}
      <footer className="demo-pagination"><span>পৃষ্ঠা {page} / {pageCount}</span><div><button className="demo-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>আগের</button><button className="demo-secondary" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}>পরের</button></div></footer>
    </section>
    <footer className="demo-foot">XZM-TEAM Preview · কোনো লগইন, API বা লাইভ ডেটাবেস সংযোগ নেই</footer>
    <style>{`
      .demo-users{max-width:1180px;margin:0 auto;padding:24px;color:#172033;font-family:inherit}.demo-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e7eaf0;padding:8px 0 20px}.demo-brand{font-size:20px;font-weight:800;color:inherit;text-decoration:none}.demo-pill,.demo-readonly{font-size:11px;font-weight:700;letter-spacing:.04em;border-radius:30px;padding:7px 11px;background:#eaf4ff;color:#155a9a}.demo-intro{padding:34px 0 22px}.demo-eyebrow{font-size:12px;font-weight:800;color:#52637c;letter-spacing:.1em}.demo-intro h1{font-size:clamp(26px,4vw,38px);margin:8px 0}.demo-intro p:last-child{max-width:760px;color:#637087;line-height:1.7}.demo-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:14px 0 22px}.demo-stats article,.demo-panel{background:white;border:1px solid #e5e9f0;border-radius:16px;padding:18px}.demo-stats span{display:block;color:#65738a;font-size:13px}.demo-stats strong{display:block;font-size:28px;margin-top:7px}.demo-panel-head,.demo-toolbar,.demo-pagination,.demo-cards article>div{display:flex;align-items:center;justify-content:space-between;gap:12px}.demo-panel-head h2{font-size:19px;margin:0 0 4px}.demo-panel-head span{font-size:12px;color:#69768a}.demo-filters{display:grid;grid-template-columns:minmax(220px,1fr) 190px auto;gap:12px;align-items:end;margin:20px 0}.demo-filters label{font-size:12px;font-weight:700;color:#526078}.demo-filters input,.demo-filters select{display:block;width:100%;margin-top:7px;border:1px solid #d9e0ea;border-radius:10px;padding:11px;background:#fff;color:#172033;font:inherit}.demo-toolbar{padding:12px 0;border-top:1px solid #edf0f4}.demo-toolbar>div{display:flex;gap:8px}.demo-toolbar button,.demo-secondary,.demo-primary{border:1px solid #d9e0ea;border-radius:9px;padding:9px 13px;background:#fff;color:#27364d;font:inherit;font-size:13px;cursor:pointer}.demo-toolbar button.selected,.demo-primary{background:#173f75;color:white;border-color:#173f75}.demo-table-wrap{overflow-x:auto}.demo-table{width:100%;border-collapse:collapse;text-align:left}.demo-table th{font-size:12px;color:#68758a;background:#f7f9fc}.demo-table th,.demo-table td{padding:14px 12px;border-bottom:1px solid #edf0f4}.demo-table td{font-size:13px}.demo-table small,.demo-cards small{display:block;color:#748096;margin-top:4px}.demo-status{display:inline-block;border-radius:30px;padding:5px 9px;font-size:11px;font-weight:700}.demo-status.good{background:#e6f7ee;color:#147344}.demo-status.warn{background:#fff2d8;color:#8a5a00}.demo-status.off{background:#edf0f4;color:#5e6878}.demo-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.demo-cards article{border:1px solid #e8ecf2;border-radius:12px;padding:14px}.demo-cards p{font-size:13px;color:#526078}.demo-empty{text-align:center;padding:30px;color:#68758a}.demo-pagination{padding-top:16px;color:#68758a;font-size:13px}.demo-pagination div{display:flex;gap:8px}.demo-secondary:disabled{opacity:.45;cursor:not--allowed}.demo-foot{text-align:center;color:#788397;font-size:12px;padding:24px}.demo-users button:focus-visible,.demo-users input:focus-visible,.demo-users select:focus-visible{outline:3px solid #9cc9ff;outline-offset:2px}@media(max-width:700px){.demo-users{padding:16px}.demo-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.demo-filters{grid-template-columns:1fr}.demo-cards{grid-template-columns:1fr}.demo-panel{padding:13px}.demo-toolbar{align-items:flex-start;flex-direction:column}.demo-pill{font-size:9px}}@media print{.demo-filters,.demo-toolbar,.demo-pagination,.demo-foot{display:none!important}.demo-users{max-width:none;padding:0}.demo-panel,.demo-stats article{break-inside:avoid}}
    `}</style>
  </main>
}
