import { useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Combo } from '../../components/inputs'
import { usePrefs } from '../../lib/prefs'
import { refs, type HubPerson } from '../../lib/refs'
import { extraFriendly, referrals } from '../../lib/extra'
import type { EmpRow } from '../../lib/hrreq'
import { Badge, useLoad, useToast } from '../accounts/ui'
import { useOrg } from '../hr/common'

/**
 * "আমার লোক দেওয়া" — everything on one page, no trip to the profile:
 *   হাব বাছুন → পদবী বাছুন → নামে চাপুন → আপডেট করুন
 * Below it, every name stays listed: already counted for me, and waiting for HR.
 * Uses the same database calls as the profile's referral part (hr_reference_many), so HR approval works the same.
 */
export function BroughtPicker({ me }: { me: EmpRow }) {
  const { L, n } = usePrefs()
  const o = useOrg()
  const { toast, node } = useToast()
  const [open, setOpen] = useState(false)
  const [hub, setHub] = useState(me.hub_id ?? '')
  const [post, setPost] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const brought = useLoad(() => referrals.brought(me.id), [me.id])
  const pend = useLoad(() => referrals.broughtPending(me.id).catch(() => []), [me.id])
  const people = useLoad(() => open && hub ? refs.hubPeople(hub) : Promise.resolve([] as HubPerson[]), [open, hub])

  const mine = useMemo(() => new Set((brought.data ?? []).map(r => r.id)), [brought.data])
  const waiting = useMemo(() => new Set((pend.data ?? []).filter(r => r.action === 'set').map(r => r.employee.id)), [pend.data])
  const pool = (people.data ?? []).filter(p => p.id !== me.id)
  const posts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pool) m.set(p.post ?? '—', (m.get(p.post ?? '—') ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [pool])
  const s = q.trim().toLowerCase()
  const list = pool.filter(p => (!post || (p.post ?? '—') === post)
    && (!s || `${p.full_name} ${p.employee_code ?? ''} ${p.mobile ?? ''}`.toLowerCase().includes(s)))
  const count = Object.keys(sel).length

  function toggle(p: HubPerson) {
    if (mine.has(p.id) || waiting.has(p.id)) return
    setSel(x => { const y = { ...x }; if (y[p.id]) delete y[p.id]; else y[p.id] = `${p.full_name}${p.employee_code ? ' #' + p.employee_code : ''}`; return y })
  }
  async function save() {
    const ids = Object.keys(sel); if (!ids.length) return
    setErr(''); setBusy(true)
    try {
      const r = await referrals.referenceMany(ids, 'set', me.id)
      setSel({}); void brought.reload(); void pend.reload()
      toast([r.applied && L(`${n(r.applied)} জন যোগ হয়েছে`, `${r.applied} added`),
        r.waiting && L(`${n(r.waiting)} জন এইচআর অনুমোদনের অপেক্ষায়`, `${r.waiting} waiting for HR`)].filter(Boolean).join(' · ') || L('আপডেট হয়েছে', 'Updated'))
    } catch (e) { setErr(e instanceof Error && /[ঀ-৿]/.test(e.message) ? e.message : extraFriendly(e)) } finally { setBusy(false) }
  }
  async function remove(id: string, name: string) {
    const why = (window.prompt(L(`${name} — আপনার নাম থেকে সরাবেন? কারণ লিখুন`, `Remove ${name}? Reason`)) ?? '').trim(); if (!why) return
    try {
      const r = await referrals.referenceMany([id], 'remove', me.id, why)
      void brought.reload(); void pend.reload()
      toast(r.waiting ? L('সরানোর অনুরোধ এইচআর-এ গেছে', 'Sent to HR') : L('সরানো হয়েছে', 'Removed'))
    } catch (e) { toast(e instanceof Error && /[ঀ-৿]/.test(e.message) ? e.message : extraFriendly(e)) }
  }

  const st = (x: string): [string, 'ok' | 'info' | 'neutral'] => x === 'active' ? [L('কাজে আছেন', 'Working'), 'ok'] : x === 'applicant' ? [L('আবেদন চলছে', 'Applying'), 'info'] : [L('এখন নেই', 'Left'), 'neutral']
  const total = (brought.data?.length ?? 0) + (pend.data?.filter(r => r.action === 'set').length ?? 0)

  return <div className="bp">
    <button type="button" className={`wf-note${open ? ' on' : ''}`} aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span className="wf-note-i"><Icon name="userplus" size={20} /></span>
      <span className="tx"><b>{L('নাম যোগ বা বদল করুন', 'Add or change names')}</b>
        <span>{L('হাব → পদবী বেছে নামে চাপুন, তারপর আপডেট করুন। এইচআর অনুমোদন দিলে নিচের তালিকায় বসবে।', 'Pick hub → post, tap names, then update. They count once HR approves.')}</span></span>
      <Icon name={open ? 'x' : 'chev'} size={18} /></button>

    {open && <section className="panel bp-pick">
      <div className="bp-step"><span className="bp-n">১</span><b>{L('হাব', 'Hub')}</b></div>
      <Combo value={hub} label={L('হাব', 'Hub')} onChange={v => { setHub(v); setPost(''); setQ('') }}
        options={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name }))} placeholder={L('হাব বেছে নিন…', 'Choose a hub…')} />

      {hub && <>
        <div className="bp-step"><span className="bp-n">২</span><b>{L('পদবী', 'Post')}</b></div>
        {people.loading ? <p className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</p> : !pool.length ? <p className="muted small">{L('এই হাবে কাউকে পাওয়া যায়নি', 'Nobody in this hub')}</p>
          : <div className="nv-chips bp-posts">
            <button type="button" className={`nv-chip${!post ? ' on' : ''}`} onClick={() => setPost('')}>{L('সব', 'All')} <b>{n(pool.length)}</b></button>
            {posts.map(([p, c]) => <button key={p} type="button" className={`nv-chip${post === p ? ' on' : ''}`} onClick={() => setPost(p)}>{p} <b>{n(c)}</b></button>)}</div>}

        {pool.length > 0 && <>
          <div className="bp-step"><span className="bp-n">৩</span><b>{L('নামে চাপুন', 'Tap names')}</b></div>
          <input className="bp-q" value={q} onChange={e => setQ(e.target.value)} placeholder={L('নাম, আইডি বা মোবাইল দিয়ে খুঁজুন', 'Search name, ID or mobile')} />
          <div className="bp-list">{!list.length ? <p className="muted small">{L('কাউকে পাওয়া যায়নি', 'Nobody found')}</p>
            : list.map(p => { const done = mine.has(p.id); const wait = waiting.has(p.id); const on = !!sel[p.id]
              return <button key={p.id} type="button" className={`bp-row${on ? ' on' : ''}${done || wait ? ' dis' : ''}`} aria-pressed={on} disabled={done || wait} onClick={() => toggle(p)}>
                <span className="nv-av">{on ? <Icon name="check" size={16} /> : p.full_name.slice(0, 1).toUpperCase()}</span>
                <span className="tx"><b>{p.full_name}</b><span>{[p.employee_code && `#${p.employee_code}`, p.post, p.mobile].filter(Boolean).join(' · ')}</span></span>
                {done ? <Badge tone="ok">{L('আপনার', 'Yours')}</Badge> : wait ? <Badge tone="warn">{L('অপেক্ষায়', 'Waiting')}</Badge> : null}
              </button> })}</div>
        </>}
      </>}

      {count > 0 && <div className="br-chips">{Object.entries(sel).map(([id, label]) => <span key={id} className="br-chip">{label}
        <button type="button" aria-label={L('সরান', 'Remove')} onClick={() => setSel(x => { const y = { ...x }; delete y[id]; return y })}><Icon name="x" size={12} /></button></span>)}</div>}
      {err && <p className="da-error" role="alert">{err}</p>}
      <div className="bp-go">
        <button type="button" disabled={busy || !count} onClick={() => void save()}>{busy ? '…' : L(`আপডেট করুন (${n(count)})`, `Update (${count})`)}</button>
        <small className="muted"><Icon name="clock" size={12} /> {L('এইচআর অনুমোদন দিলে তালিকায় গোনা হবে', 'Counts once HR approves')}</small></div>
    </section>}

    <div className="bp-h"><h3>{L('আমি যাদের নিয়ে এসেছি', 'People I brought')} <span className="muted small">({n(total)})</span></h3>
      <span className="muted small">{L('আপনার রেফারেন্সে যারা যোগ দিয়েছেন', 'Joined through your reference')}</span></div>
    {brought.error ? <p className="da-error">{extraFriendly(brought.error)}</p> : !brought.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : !total ? <div className="nv-empty panel"><Icon name="users" size={30} /><p>{L('আপনার নামে এখনো কেউ যোগ দেননি।', 'Nobody has joined under your name yet.')}</p>
          <p className="small">{L('উপরে "নাম যোগ বা বদল করুন" চেপে হাব ও পদবী বেছে নাম যোগ করুন।', 'Tap "Add or change names" above to add them.')}</p></div>
      : <div className="nv-rows">
        {(pend.data ?? []).map(r => <div key={'p' + r.id} className="nv-row">
          <span className="nv-av">{r.employee.name.slice(0, 1).toUpperCase()}</span>
          <span className="tx"><b>{r.employee.name}</b><span>{[r.employee.code && `আইডি ${r.employee.code}`, r.employee.position, r.employee.hub].filter(Boolean).join(' · ')}</span></span>
          <span className="end"><Badge tone={r.action === 'remove' ? 'bad' : 'warn'}>{r.action === 'remove' ? L('সরানো — অপেক্ষায়', 'Removal waiting') : L('অপেক্ষায়', 'Waiting')}</Badge></span></div>)}
        {brought.data.map(r => <div key={r.id} className="nv-row">
          <span className="nv-av">{r.full_name.slice(0, 1).toUpperCase()}</span>
          <span className="tx"><b>{r.full_name}</b><span>{[r.employee_code && `আইডি ${r.employee_code}`, r.position_name, r.hub_name].filter(Boolean).join(' · ')}</span></span>
          <span className="end"><Badge tone={st(r.status)[1]}>{st(r.status)[0]}</Badge>
            <button type="button" className="icon-btn" aria-label={L('সরান', 'Remove')} title={L('সরান', 'Remove')} onClick={() => void remove(r.id, r.full_name)}><Icon name="x" size={16} /></button></span></div>)}
      </div>}
    {node}
  </div>
}
