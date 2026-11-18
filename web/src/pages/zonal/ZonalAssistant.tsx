import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { Combo } from '../../components/inputs'
import { GAP_STATUS, KIND_BN, LEAVE_BN, dayBn, gaps, type GapRow } from '../../lib/gaps'
import { hrFriendly } from '../../lib/hr'
import { usePrefs } from '../../lib/prefs'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { useOrg } from '../hr/common'

const dhaka = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })

/** The Zonal Assistant's panel: the system finds the days without attendance and asks; here the answers are checked and people are reminded. */
export function ZonalAssistant() {
  const { can } = useAuth()
  const { n } = usePrefs()
  const o = useOrg()
  const { toast, node } = useToast()
  const [from, setFrom] = useState(dhaka().slice(0, 8) + '01')
  const [to, setTo] = useState(dhaka())
  const [hub, setHub] = useState('')
  const rep = useLoad(() => gaps.report(from, to, hub || null), [from, to, hub])
  const [back, setBack] = useState<{ rows: GapRow[]; clear: () => void } | null>(null)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const rows = rep.data ?? []
  const key = (r: GapRow) => `${r.employee_id}-${r.work_date}`
  const count = (s: string) => rows.filter(r => r.status === s).length
  const mayCheck = can('hr.attendance_gap.approve')
  const byHub = useMemo(() => {
    const m = new Map<string, { hub: string; people: Set<string>; days: number; waiting: number; answered: number }>()
    for (const r of rows) {
      const k = r.hub_id ?? ''; const x = m.get(k) ?? { hub: r.hub_name ?? '—', people: new Set<string>(), days: 0, waiting: 0, answered: 0 }
      x.people.add(r.employee_id); x.days++; if (r.status === 'waiting' || r.status === 'returned') x.waiting++; if (r.status === 'answered') x.answered++
      m.set(k, x)
    }
    return [...m.entries()].map(([id, x]) => ({ id, ...x })).sort((a, b) => b.days - a.days)
  }, [rows])

  async function check(list: GapRow[], ok: boolean, note: string, clear: () => void) {
    const ids = list.filter(r => r.answer_id && r.status === 'answered').map(r => r.answer_id!) 
    if (!ids.length) return setErr('টিক দেওয়া সারির মধ্যে যাচাইয়ের মতো কোনো উত্তর নেই')
    setBusy(true); setErr('')
    try { const k = await gaps.check(ids, ok, note); clear(); setBack(null); setWhy(''); toast(ok ? `${n(k)}টি উত্তর যাচাই হয়েছে` : `${n(k)}টি উত্তর ফেরত গেছে`); await rep.reload() }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }
  async function remind() {
    setBusy(true); setErr('')
    try { const k = await gaps.remind(from, to, hub || null); toast(k ? `${n(k)} জনকে তাগাদা পাঠানো হয়েছে` : 'তাগাদা দেওয়ার মতো কেউ নেই (লগইন আছে এমন কারো উত্তর বাকি নেই)') }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy(false) }
  }

  return <AppShell title="জোনাল অ্যাসিস্ট্যান্ট — হাজিরার ফাঁকা দিন" subtitle="সিস্টেম প্রতিদিন দেখে কার কোন তারিখের হাজিরা নেই, আর তাঁকে কারণ জিজ্ঞেস করে। এখানে উত্তরগুলো যাচাই করুন, বাকিদের তাগাদা দিন।"
    actions={mayCheck ? <button disabled={busy} onClick={() => void remind()}>তাগাদা পাঠান</button> : null}>
    {node}
    <section className="panel za-intro"><Icon name="cal" size={32} /><p>যেদিনের কোনো হাজিরাই ওঠেনি সেটাই “ফাঁকা দিন” (অনুপস্থিত, ছুটি বা সাপ্তাহিক বন্ধ দেওয়া থাকলে ফাঁকা নয়)। কর্মী নিজের ড্যাশবোর্ডে প্রশ্ন পান: ছুটিতে ছিলেন, কাজে ছিলেন, নাকি অন্য কারণ।
      ছুটি বললে সেখান থেকেই আবেদন জমা হয়; হাব ম্যানেজার অনুমোদন দিলে দিনটা নিজে থেকেই তালিকা ছেড়ে যায়।</p></section>
    <section className="da-filters panel no-print">
      <Field label="থেকে"><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label="পর্যন্ত"><input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></Field>
      <Field label="হাব"><Combo value={hub} onChange={setHub} placeholder="সব হাব" options={(o.data?.hubs ?? []).map(h => ({ value: h.id, label: h.name }))} /></Field>
    </section>
    <div className="da-stats">
      <Stat icon="cal" label="মোট ফাঁকা দিন" value={n(rows.length)} sub={`${n(new Set(rows.map(r => r.employee_id)).size)} জন কর্মীর`} />
      <Stat icon="clock" tone={count('waiting') ? 'warn' : 'ok'} label="উত্তর বাকি" value={n(count('waiting'))} />
      <Stat icon="check" tone={count('answered') ? 'warn' : 'ok'} label="যাচাই বাকি" value={n(count('answered'))} />
      <Stat icon="x" tone={count('returned') ? 'bad' : undefined} label="ফেরত পাঠানো" value={n(count('returned'))} />
      <Stat icon="shield" tone="ok" label="যাচাই হয়েছে" value={n(count('verified'))} />
    </div>
    {rep.error ? <p className="da-error">{hrFriendly(rep.error)}</p> : null}
    {err && <p className="da-error" role="alert">{err}</p>}
    {byHub.length > 1 && <section className="panel"><h2>হাব অনুযায়ী</h2>
      <div className="za-hubs">{byHub.map(h => <button key={h.id} type="button" className={`za-hub${hub === h.id ? ' on' : ''}`} onClick={() => setHub(hub === h.id ? '' : h.id)}>
        <b>{h.hub}</b><span>{n(h.people.size)} জন · {n(h.days)} দিন ফাঁকা</span><span className="muted small">উত্তর বাকি {n(h.waiting)} · যাচাই বাকি {n(h.answered)}</span></button>)}</div></section>}
    <section className="panel">
      <DataTable<GapRow> title="হাজিরার ফাঁকা দিন" file={`attendance-gaps-${from}-${to}`} prefKey="attendance-gaps" rows={rep.data} rowKey={key} phoneView="list"
        empty={<p className="muted">{rep.loading ? 'লোড হচ্ছে…' : 'এই সময়ে কারো হাজিরা ফাঁকা নেই।'}</p>}
        bulk={mayCheck ? (marked, clear) => <>
          <button type="button" className="sm" disabled={busy} onClick={() => void check(marked, true, '', clear)}>উত্তর ঠিক আছে</button>
          <button type="button" className="sm danger" disabled={busy} onClick={() => { setErr(''); setBack({ rows: marked, clear }) }}>ফেরত পাঠান</button>
          <button type="button" className="secondary sm" onClick={clear}>বাছাই তুলুন</button></> : undefined}
        cols={[
          { key: 'name', label: 'নাম', primary: true, value: r => r.full_name, render: r => <span><b>{r.full_name}</b><span className="sec">আইডি {r.employee_code ?? '—'}{r.position_name ? ` · ${r.position_name}` : ''}</span></span> },
          { key: 'code', label: 'আইডি', hidden: true, value: r => r.employee_code ?? '' },
          { key: 'hub', label: 'হাব', value: r => r.hub_name ?? '' },
          { key: 'date', label: 'তারিখ', value: r => r.work_date, render: r => dayBn(r.work_date) },
          { key: 'status', label: 'অবস্থা', value: r => GAP_STATUS[r.status][0], render: r => <Badge tone={GAP_STATUS[r.status][1]}>{GAP_STATUS[r.status][0]}</Badge> },
          { key: 'kind', label: 'কর্মীর উত্তর', value: r => r.kind ? KIND_BN[r.kind] : '', render: r => r.kind ? <>{KIND_BN[r.kind]}{r.leave_status && <span className="sec">{LEAVE_BN[r.leave_status] ?? r.leave_status}</span>}</> : <span className="muted">—</span> },
          { key: 'note', label: 'কারণ', value: r => r.note ?? '' },
          { key: 'check', label: 'যাচাইয়ের নোট', value: r => r.check_note ?? '' },
          { key: 'login', label: 'লগইন', value: r => r.has_login ? 'আছে' : 'নেই', render: r => r.has_login ? <span className="muted">আছে</span> : <Badge tone="bad">লগইন নেই</Badge> },
        ]} />
      <p className="muted small">যাঁর লগইন নেই তিনি প্রশ্নই পাবেন না — আগে লগইন দিন। “কাজে ছিলাম” উত্তর ঠিক হলে হাব ম্যানেজার হাজিরা খাতায় দিনটা বসিয়ে দেবেন।</p>
    </section>
    {back && <Modal title="উত্তর ফেরত পাঠান" onClose={() => setBack(null)} actions={<><button type="button" className="secondary" onClick={() => setBack(null)}>বাতিল</button>
      <button type="button" className="danger" disabled={busy} onClick={() => { if (!why.trim()) return setErr('ফেরত পাঠানোর কারণ লিখুন'); void check(back.rows, false, why.trim(), back.clear) }}>ফেরত পাঠান</button></>}>
      <p className="muted small">কর্মী নোটিফিকেশন পাবেন আর আবার উত্তর দিতে পারবেন।</p>
      <Field label="কেন ফেরত" required><input value={why} onChange={e => setWhy(e.target.value)} placeholder="যেমন: ম্যানেজার বলছেন সেদিন আসেননি" /></Field>
      {err && <p className="da-error" role="alert">{err}</p>}
    </Modal>}
  </AppShell>
}
