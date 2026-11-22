// Home dashboard panel "অফিসের জিনিসপত্র": how many items are good, broken or needed, across the offices the person may see.
// The buttons follow the person's permissions (Super Admin has them all):
//   আপডেট -> office.asset.edit · নষ্ট / লাগবে জানান -> office.notice.create · প্রিন্ট -> office.report.print · PDF -> office.report.export
//   ভিউ সেটিং (which roles see this panel) -> Super Admin only.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ASSET_KIND, CONDITION, type Asset } from '../lib/office'
import { usePrefs } from '../lib/prefs'
import { supabase } from '../lib/supabase'
import { useLoad } from '../pages/accounts/ui'
import { useOfficeOutput } from '../pages/office/useOutput'
import { Icon } from './Icon'

const OPEN = ['open', 'seen']
async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

export function OfficeItemsPanel() {
  const { L, n } = usePrefs()
  const { can, isSuperAdmin, viewAs } = useAuth()
  const out = useOfficeOutput('dashboard-office-items')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const d = useLoad(async () => {
    const assets = () => supabase.from('office_assets').select('id', { count: 'exact', head: true }).is('archived_at', null)
    const [good, bad, need] = await Promise.all([
      count(assets().eq('condition', 'good')),
      count(assets().neq('condition', 'good')),
      count(supabase.from('office_notices').select('id', { count: 'exact', head: true }).eq('kind', 'need').in('status', OPEN)),
    ])
    return { good, bad, need }
  }, [])
  const v = d.data

  /** The list that needs someone's attention: every item that is not good, then every open "needed" request. */
  async function print(pdf: boolean) {
    setErr(''); setBusy(true)
    try {
      const [a, q, p] = await Promise.all([
        supabase.from('office_assets').select('property_id, kind, name, quantity, condition').is('archived_at', null).neq('condition', 'good').order('property_id').limit(1000),
        supabase.from('office_notices').select('property_id, item_kind, title, quantity, priority, created_at').eq('kind', 'need').in('status', OPEN).order('created_at').limit(1000),
        supabase.from('office_properties').select('id, name'),
      ])
      const bad = a.error || q.error || p.error
      if (bad) throw new Error(bad.message)
      type Line = { property_id: string; kind: string | null; name: string; quantity: number; state: string }
      const place = Object.fromEntries(((p.data ?? []) as Array<{ id: string; name: string }>).map(x => [x.id, x.name]))
      const lines: Line[] = [
        ...((a.data ?? []) as Array<Pick<Asset, 'property_id' | 'kind' | 'name' | 'quantity' | 'condition'>>).map(x => ({ property_id: x.property_id, kind: x.kind, name: x.name, quantity: x.quantity,
          state: L(CONDITION[x.condition]?.[0] ?? x.condition, CONDITION[x.condition]?.[1] ?? x.condition) })),
        ...((q.data ?? []) as Array<{ property_id: string; item_kind: string | null; title: string; quantity: number; priority: string }>).map(x => ({ property_id: x.property_id, kind: x.item_kind, name: x.title, quantity: x.quantity,
          state: L('লাগবে', 'Needed') + (x.priority === 'urgent' ? L(' (জরুরি)', ' (urgent)') : '') })),
      ]
      if (!(await out.beforeOutput(pdf ? 'pdf' : 'print', lines.length))) return
      const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
      const title = L('অফিসের জিনিসপত্র — নষ্ট ও লাগবে', 'Office items — broken and needed')
      const heads = ['S/L', L('অফিস', 'Office'), L('ধরন', 'Kind'), L('নাম', 'Name'), L('সংখ্যা', 'Qty'), L('অবস্থা', 'Status')]
      const box = document.createElement('div'); box.id = 'print-box'
      box.innerHTML = `<h2 style="margin:0">XZM-TEAM — ${esc(title)}</h2>
        <p style="margin:2px 0 4px">${esc(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }))}${pdf ? ' · ' + esc(L('প্রিন্ট উইন্ডোতে “Save as PDF” বেছে নিন', 'choose “Save as PDF” in the print window')) : ''}</p>
        <p style="margin:0 0 10px"><b>${esc(L('ভালো', 'Good'))}: ${esc(n(v?.good ?? 0))} · ${esc(L('নষ্ট', 'Broken'))}: ${esc(n(v?.bad ?? 0))} · ${esc(L('লাগবে', 'Needed'))}: ${esc(n(v?.need ?? 0))}</b></p>
        ${lines.length ? `<table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${lines.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(place[r.property_id] ?? '—')}</td>
          <td>${esc(r.kind ? L(ASSET_KIND[r.kind]?.[0] ?? r.kind, ASSET_KIND[r.kind]?.[1] ?? r.kind) : '—')}</td><td>${esc(r.name)}</td><td>${esc(n(r.quantity))}</td><td>${esc(r.state)}</td></tr>`).join('')}</tbody></table>`
          : `<p>${esc(L('নষ্ট বা লাগবে — কিছুই নেই।', 'Nothing is broken or needed.'))}</p>`}`
      const host = document.querySelector('.app-main') ?? document.body; host.appendChild(box); document.body.classList.add('print-list')
      const old = document.title; document.title = `XZM-TEAM-${title}`
      const done = () => { box.remove(); document.body.classList.remove('print-list'); document.title = old; window.removeEventListener('afterprint', done) }
      window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const acts = [
    can('office.asset.edit') && <Link key="u" to="/app/office/assets" className="oi-act"><Icon name="edit" size={16} />{L('আপডেট', 'Update')}</Link>,
    can('office.notice.create') && <Link key="r" to="/app/office/assets" className="oi-act"><Icon name="bell" size={16} />{L('নষ্ট / লাগবে জানান', 'Report broken / needed')}</Link>,
    out.canPrint && <button key="p" type="button" className="oi-act" disabled={busy || !v} onClick={() => void print(false)}><Icon name="print" size={16} />{L('প্রিন্ট', 'Print')}</button>,
    out.canExport && <button key="f" type="button" className="oi-act" disabled={busy || !v} onClick={() => void print(true)}><Icon name="pdf" size={16} />PDF</button>,
    isSuperAdmin && !viewAs && <Link key="s" to="/app/role-dashboards" className="oi-act"><Icon name="gear" size={16} />{L('ভিউ সেটিং', 'View settings')}</Link>,
  ].filter(Boolean)

  return <section className="panel office-items">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('অফিসের জিনিসপত্র', 'Office items')}</h2><Link to="/app/office/assets" className="small">{L('বিস্তারিত', 'Open')} →</Link></div>
    {d.error ? <p className="da-error">{d.error instanceof Error ? d.error.message : String(d.error)}</p> : null}
    {!v ? (d.loading ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : null) : <div className="oi-tri">
      <Link to="/app/office/assets" className="k-ok"><Icon name="check" size={20} /><b>{n(v.good)}</b><span>{L('ভালো', 'Good')}</span></Link>
      <Link to="/app/office/assets" className="k-bad"><Icon name="alert" size={20} /><b>{n(v.bad)}</b><span>{L('নষ্ট', 'Broken')}</span></Link>
      <Link to="/app/office/notices" className="k-need"><Icon name="box" size={20} /><b>{n(v.need)}</b><span>{L('লাগবে', 'Needed')}</span></Link>
    </div>}
    {err && <p className="da-error">{err}</p>}
    {acts.length > 0 && <div className="oi-acts">{acts}</div>}
  </section>
}
