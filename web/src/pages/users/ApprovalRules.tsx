import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { hrFriendly } from '../../lib/hr'
import { KIND_TEXT, MODES, approval, modeName, type Mode, type Rule } from '../../lib/approval'
import { Badge, useLoad, useToast } from '../accounts/ui'
import { useOrg } from '../hr/common'

const PERM = 'system.approval_rule.configure'
const when = (s: string) => new Date(s).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const errText = (e: unknown) => (e instanceof Error && /[ঀ-৿]/.test(e.message) ? e.message : hrFriendly(e))

/**
 * কোন কাজে কার অনুমোদন: work goes up (staff -> manager -> zonal manager); for each kind of input the Zonal Manager
 * (own zone) or the Super Admin (all zones, or any zone) picks what happens when it is submitted.
 */
export function ApprovalRules() {
  const { grants } = useAuth()
  const o = useOrg()
  const { toast, node } = useToast()
  const mine = grants.filter(g => g.is_super || g.permission_code === PERM || g.permission_code === '*')
  const everywhere = mine.some(g => g.scope_type === 'global')
  const zones = useMemo(() => (o.data?.zones ?? []).filter(z => everywhere || mine.some(g => g.zone_id === z.id)), [o.data, everywhere, mine])
  const [zone, setZone] = useState<string | null | undefined>(undefined)   // null = all zones
  useEffect(() => { if (zone === undefined && (everywhere || zones.length)) setZone(everywhere ? null : zones[0].id) }, [zone, everywhere, zones])
  const list = useLoad(() => (zone === undefined ? Promise.resolve([] as Rule[]) : approval.list(zone)), [zone])
  const [busy, setBusy] = useState('')
  const zoneName = zone ? zones.find(z => z.id === zone)?.name ?? '' : 'সব জোন'

  async function pick(r: Rule, m: Mode | null) {
    if (zone === undefined) return
    setBusy(r.kind)
    try {
      await approval.save(r.kind, zone, m)
      toast(m ? `${KIND_TEXT[r.kind]?.[0] ?? r.kind}: ${zoneName} — ${modeName(m)}` : 'সব জোনের নিয়ম মেনে চলবে')
      await list.reload()
    } catch (e) { toast(errText(e)) } finally { setBusy('') }
  }

  return <AppShell title="কোন কাজে কার অনুমোদন" subtitle="স্টাফের ইনপুট → ম্যানেজার → জোনাল ম্যানেজার। কোন ইনপুটে অনুমোদন লাগবে আর কোনটা নিজে নিজে গৃহীত হবে — এখানে ঠিক করুন।">
    {node}
    {(everywhere || zones.length > 1) && <div className="nv-chips" role="group" aria-label="জোন">
      {everywhere && <button type="button" className={`nv-chip${zone === null ? ' on' : ''}`} onClick={() => setZone(null)}>সব জোন</button>}
      {zones.map(z => <button key={z.id} type="button" className={`nv-chip${zone === z.id ? ' on' : ''}`} onClick={() => setZone(z.id)}>{z.name}</button>)}</div>}
    {zone !== null && zone !== undefined && <p className="muted small ar-note">এখানে বদলালে শুধু <b>{zoneName}</b>-এ খাটবে। না বদলালে সব জোনের নিয়ম চলবে।</p>}
    {list.error ? <p className="da-error">{errText(list.error)}</p> : null}

    <div className="ar-list">{(list.data ?? []).map(r => { const [name, note, icon] = KIND_TEXT[r.kind] ?? [r.kind, '', 'form']
      const cur: Mode = zone ? r.zone_mode ?? r.all_mode : r.all_mode
      return <section key={r.kind} className={`panel ar-row${r.wired ? '' : ' off'}`} data-kind={r.kind}>
        <div className="ar-head"><span className="nv-av"><Icon name={icon} size={20} /></span>
          <div className="tx"><b>{name}</b><span className="muted small">{note}</span></div>
          {!r.wired ? <Badge tone="neutral">শীঘ্রই</Badge> : zone && !r.zone_mode ? <Badge tone="info">সব জোনের নিয়ম</Badge> : null}</div>
        <div className="ar-modes" role="radiogroup" aria-label={name}>{MODES.map(([m, bn, hint, tone]) =>
          <button key={m} type="button" role="radio" aria-checked={cur === m} disabled={!r.wired || busy === r.kind} className={`ar-mode t-${tone}${cur === m ? ' on' : ''}`}
            onClick={() => { if (cur !== m || (zone && !r.zone_mode)) void pick(r, m) }}><b>{bn}</b><small>{hint}</small></button>)}</div>
        {r.wired && <p className="muted small ar-foot">
          {r.set_at ? <>শেষ বদল: {r.set_by_name ?? '—'} · {when(r.set_at)}</> : 'এখনো কেউ বদলায়নি — অনুমোদন লাগবে।'}
          {zone && r.zone_mode && <> · <button type="button" className="link small" disabled={busy === r.kind} onClick={() => void pick(r, null)}>সব জোনের নিয়মে ফিরুন ({modeName(r.all_mode)})</button></>}</p>}
        {!r.wired && <p className="muted small ar-foot">এই কাজে আপাতত আগের মতোই অনুমোদন লাগে। নিয়ম বাছার ব্যবস্থা পরের ধাপে চালু হবে।</p>}
      </section> })}</div>
    {list.loading && <p className="muted">লোড হচ্ছে…</p>}
  </AppShell>
}
