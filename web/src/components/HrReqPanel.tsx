import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { KINDS, STATUS, hrReq } from '../lib/hrreq'
import { usePrefs } from '../lib/prefs'
import { Badge, useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'

/** Dashboard: what I sent to HR, people I referred, what waits for my decision. */
export function HrReqPanel() {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const s = useLoad(() => hrReq.summary().catch(() => null), [])
  const d = s.data
  if (!d) return null
  const sum = (m: Record<string, number>, f: (k: string) => boolean = () => true) => Object.entries(m).filter(([k]) => f(k)).reduce((a, [, v]) => a + v, 0)
  const mine = sum(d.mine), decided = sum(d.decided)
  const kinds = ['id_create', 'id_transfer', 'id_active', 'id_inactive'] as const
  const approve = can('hr.request.approve')
  if (!mine && !d.as_ref && !d.about_me && !(approve && (d.open || decided))) {
    return <section className="panel hrq-panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('এইচআর রিকুয়েস্ট', 'HR requests')}</h2></div>
      <div className="hrq-empty"><span className="muted">{L('এখনো কোনো রিকুয়েস্ট পাঠানো হয়নি।', 'No requests sent yet.')}</span>
        <Link to="/app/hr/requests" className="btn-cta"><Icon name="plus" size={16} />{L('নতুন রিকুয়েস্ট', 'New request')}</Link></div>
    </section>
  }
  return <section className="panel hrq-panel">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('এইচআর রিকুয়েস্ট ও আমার দেওয়া লোক', 'HR requests & my referrals')}</h2>
      <Link to="/app/hr/requests?tab=report" className="small">{L('রিপোর্ট', 'Report')} →</Link></div>
    <div className="net-kpis">
      <Link to="/app/hr/requests?tab=list" className="nk"><span className="nk-i b"><Icon name="form" size={20} /></span><b>{n(mine)}</b><small>{L('আমি পাঠিয়েছি', 'I sent')}</small></Link>
      <Link to="/app/hr/requests?tab=list" className="nk"><span className="nk-i g"><Icon name="check" size={20} /></span><b>{n(sum(d.mine, k => k.endsWith(':done')))}</b><small>{L('সম্পন্ন', 'Done')}</small></Link>
      <Link to="/app/hr/requests?tab=list" className="nk"><span className="nk-i r"><Icon name="users" size={20} /></span><b>{n(d.as_ref)}</b><small>{L('আমি রেফারেন্স', 'I referred')}</small></Link>
      {approve && <Link to="/app/hr/requests?tab=list" className={`nk${d.open ? ' warn' : ''}`}><span className="nk-i o"><Icon name="clock" size={20} /></span><b>{n(d.open)}</b><small>{L('অপেক্ষমাণ', 'Waiting')}</small></Link>}
      {approve && <Link to="/app/hr/requests?tab=report" className="nk"><span className="nk-i p"><Icon name="shield" size={20} /></span><b>{n(decided)}</b><small>{L('আমার সিদ্ধান্ত', 'My decisions')}</small></Link>}
    </div>
    <div className="hrq-kinds">{kinds.map(k => <span key={k} className={`rq-kind-tag t-${KINDS[k].tone}`}>{KINDS[k].bn} <b>{n(sum(d.mine, x => x.startsWith(k + ':')))}</b></span>)}</div>
    {d.recent.length > 0 && <div className="hrq-recent">{d.recent.map(r => <Link key={r.id} to={`/app/hr/requests?tab=list&id=${r.id}`} className="hrq-row">
      <span className={`hrq-ic t-${KINDS[r.kind]?.tone ?? 'o'}`}><Icon name={KINDS[r.kind]?.icon ?? 'form'} size={16} /></span>
      <span className="hrq-main"><b>{r.person || r.format}</b><small>{r.format} · {r.request_no}{r.hub ? ` · ${r.hub}` : ''}{r.asref ? L(' · আমি রেফারেন্স', ' · I referred') : ''}</small></span>
      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].bn}</Badge></Link>)}</div>}
  </section>
}
