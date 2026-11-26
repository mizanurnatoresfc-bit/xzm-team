// ডেইলি রিপোর্ট ইম্পোর্ট — কুরিয়ার প্যানেলের "Update Report" পাতার পুরো লেখা পেস্ট করলে রাইডার অনুযায়ী দিনের খাতায় ওঠে।
// লেখা পড়ে reportParser.ts; তিনটা চেক পাশ না করলে সেভ বোতামই চালু হয় না, আর ডাটাবেস নিজেও আবার মিলিয়ে নেয়।
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { Combo } from '../../components/inputs'
import { dateBn, num, taka, timeBn, todayDhaka } from '../../lib/dailyAccounts'
import { parseReport, type CheckKey } from '../../lib/reportParser'
import { reportImport, reportTime, type ImportList, type ImportReport, type Khata } from '../../lib/reportImport'
import { AccountsShell, Badge, ErrorNote, Field, Modal, Stat, useLoad, useToast } from './ui'

const CHECK_LABEL: Record<CheckKey, string> = {
  amount: 'লিস্টের যোগফল + ডেলিভারি চার্জ = Collected', parcels: 'পার্সেলের যোগফল = ঘোষিত পার্সেল', lists: 'লিস্ট সংখ্যা = ঘোষিত লিস্ট',
}
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function ReportImport() {
  const [sp, setSp] = useSearchParams()
  const today = todayDhaka()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') ?? '') ? sp.get('date')! : today
  const hubParam = sp.get('hub') ?? ''
  const { toast, node } = useToast()
  const status = useLoad(() => reportImport.status(date), [date])
  const hubs = status.data ?? []
  const hub = hubParam || (hubs.length === 1 ? hubs[0].hub_id : '')
  const scopedHubAvailable = !hubParam || (!status.loading && !status.error && hubs.some(h => h.hub_id === hubParam))
  const day = useLoad(() => scopedHubAvailable ? reportImport.day(date, hub || null) : Promise.resolve([]), [date, hub, scopedHubAvailable])
  const set = (k: 'hub' | 'date', v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }) }

  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [showLists, setShowLists] = useState(false)
  const hubNames = useMemo(() => hubs.map(h => h.hub_name), [hubs])
  const parsed = useMemo(() => (text.trim() ? parseReport(text, { hubNames }) : null), [text, hubNames])
  const rep = parsed?.report ?? null
  // The hub written in the report picks the hub, when it is one the person may upload for.
  useEffect(() => {
    if (!rep?.hub_text) return
    const hit = hubs.find(h => same(h.hub_name, rep.hub_text))
    if (hit && hit.hub_id !== hub) set('hub', hit.hub_id)
  }, [rep?.hub_text, hubs.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const target = hubs.find(h => h.hub_id === hub)
  const hubDiffers = !!rep?.hub_text && !!target && !same(target.hub_name, rep.hub_text)
  const dateDiffers = !!rep?.report_date && rep.report_date !== date
  const known = rep ? (day.data ?? []).flatMap(k => k.reports).some(r => String(r.report_no) === rep.report_no) : false
  const canSave = !!parsed?.ok && !!target?.can_upload && !busy

  async function paste() {
    try { setText(await navigator.clipboard.readText()); setSaved(null); setErr(null) } catch { toast('ক্লিপবোর্ড পড়া গেল না — ঘরে চাপ দিয়ে ধরে "Paste" করুন') }
  }
  async function save() {
    if (!rep || !target) return
    setBusy(true); setErr(null)
    try {
      const r = await reportImport.save(target.hub_id, date, text, rep)
      setSaved(`রিপোর্ট #${r.report_no} ${r.created ? 'সেভ হয়েছে' : 'আগে থেকেই ছিল — আপডেট হয়েছে'} (${num(r.lists)}টি লিস্ট)${r.in_other_reports ? `। ${num(r.in_other_reports)}টি লিস্ট অন্য রিপোর্টেও আছে — একবারই গোনা হবে।` : ''}`)
      setText(''); setShowLists(false)
      await Promise.all([day.reload(), status.reload()])
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  const khatas = day.data ?? []
  const totals = hubs.filter(h => !hub || h.hub_id === hub)
  const reports = totals.reduce((a, h) => a + h.reports, 0)
  const uploadHubs = hubs.filter(h => h.can_upload)

  return <AccountsShell title="ডেইলি রিপোর্ট ইম্পোর্ট" subtitle={`${target ? `${target.hub_name} · ` : ''}${dateBn(date)} — কুরিয়ার প্যানেলের Update Report পেস্ট করুন`}>
    {node}
    <div className="ri">
      <section className="da-filters panel no-print">
        <Field label="খাতার তারিখ" hint={date === today ? 'আজ' : undefined}><input type="date" value={date} max={today} onChange={e => e.target.value && set('date', e.target.value)} /></Field>
        {hubs.length > 1 && <Field label="হাব"><Combo value={hub} onChange={v => set('hub', v)} placeholder="সব হাব" label="হাব"
          options={hubs.map(h => ({ value: h.hub_id, label: h.hub_name, sub: `${h.zone_name}${h.reports ? ` · ${num(h.reports)}টি রিপোর্ট` : ''}` }))} /></Field>}
      </section>
      <ErrorNote error={status.error} />
      {hubParam && !status.loading && !status.error && !scopedHubAvailable && <div className="notice">
        লিংকের হাবটির রিপোর্ট দেখার অনুমতি নেই বা হাবটি পাওয়া যায়নি।{' '}
        <button type="button" className="link" onClick={() => set('hub', '')}>অনুমোদিত হাব দেখুন</button>
      </div>}
      {!hubParam && !status.loading && !hubs.length && <div className="nv-empty"><Icon name="upload" size={34} /><p>আপনাকে কোনো হাবের রিপোর্ট দেখার বা তোলার অনুমতি দেওয়া হয়নি।</p></div>}

      {scopedHubAvailable && uploadHubs.length > 0 && <section className="panel ri-paste no-print">
        <div className="da-bar"><h2><Icon name="upload" size={18} /> রিপোর্ট পেস্ট করুন</h2>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="secondary" onClick={() => void paste()}><Icon name="doc" size={16} /> পেস্ট</button>
            {text && <button type="button" className="secondary" onClick={() => { setText(''); setErr(null) }}><Icon name="x" size={16} /> মুছুন</button>}</div></div>
        <textarea className="ri-text" rows={text ? 6 : 4} value={text} spellCheck={false} aria-label="রিপোর্টের লেখা"
          placeholder={'কুরিয়ার প্যানেলের "Update Report" পাতার পুরো লেখা কপি করে এখানে পেস্ট করুন।\nUpdate Report #…  থেকে  Total …  পর্যন্ত।'}
          onChange={e => { setText(e.target.value); setSaved(null); setErr(null) }} />
        {saved && <p className="da-ok" role="status">{saved}</p>}

        {parsed && <>
          {parsed.errors.map((e, i) => <p key={i} className="da-error" role="alert">{e}</p>)}
          {rep && <>
            <div className="ri-head">
              <div><span className="lbl">রিপোর্ট আইডি</span><b>#{rep.report_no}</b>{known && <Badge tone="info">আগে তোলা আছে — আপডেট হবে</Badge>}</div>
              <div><span className="lbl">ম্যানেজার</span><b>{rep.manager_name || '—'}</b><span className="sec">আইডি #{rep.manager_code}</span></div>
              <div><span className="lbl">হাব (রিপোর্টে)</span><b>{rep.hub_text || '—'}</b></div>
              <div><span className="lbl">রিপোর্টের সময়</span><b>{rep.report_date ? dateBn(rep.report_date) : '—'}</b><span className="sec">{reportTime(rep.reported_at)}</span></div>
              <div><span className="lbl">Collected</span><b>{taka(rep.collected)}</b></div>
              <div><span className="lbl">ডেলিভারি চার্জ</span><b>{taka(rep.delivery_charge)}</b></div>
              <div><span className="lbl">ঘোষিত</span><b>{num(rep.declared_lists)} লিস্ট · {num(rep.declared_parcels)} পার্সেল</b></div>
            </div>
            <ul className="ri-checks" aria-label="তিনটি চেক">{parsed.checks.map(c => <li key={c.key} className={c.ok ? 'ok' : 'bad'}>
              <span className="tick" aria-hidden="true"><Icon name={c.ok ? 'check' : 'x'} size={16} /></span>
              <span><b>{CHECK_LABEL[c.key]}</b>
                <span className="sec">{c.key === 'amount'
                  ? `${taka(parsed.sums.amount)} + ${taka(rep.delivery_charge)} = ${taka(c.got)} · Collected ${taka(c.expected)}${c.ok ? '' : ` · পার্থক্য ${taka(Math.round((c.got - c.expected) * 100) / 100)}`}`
                  : `পাওয়া গেছে ${num(c.got)} · ঘোষিত ${num(c.expected)}`}</span></span>
              <Badge tone={c.ok ? 'ok' : 'bad'}>{c.ok ? 'মিলেছে' : 'মেলেনি'}</Badge></li>)}</ul>
            {!parsed.ok && <p className="da-error" role="alert">তিনটা চেক পাশ না করলে কিছুই সেভ হবে না। পুরো পাতাটা আবার কপি করে পেস্ট করুন।</p>}
            <button type="button" className="link small" onClick={() => setShowLists(v => !v)}>{showLists ? 'লিস্ট লুকান' : `পড়া ${num(rep.lists.length)}টি লিস্ট দেখুন`}</button>
            {showLists && <div className="ri-wrap"><table className="ri-table">
              <thead><tr><th>লিস্ট আইডি</th><th>রাইডার</th><th className="r">পার্সেল</th><th className="r">টাকা</th></tr></thead>
              <tbody>{rep.lists.map(l => <tr key={l.list_no}><td>#{l.list_no}</td>
                <td>{l.point ? <Badge>Point delivery</Badge> : <>{l.rider_name}<span className="sec">আইডি #{l.rider_code}</span></>}</td>
                <td className="r">{num(l.parcels)}</td><td className="r">{taka(l.amount)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={2}>মোট</td><td className="r">{num(parsed.sums.parcels)}</td><td className="r">{taka(parsed.sums.amount)}</td></tr></tfoot>
            </table></div>}

            {uploadHubs.length > 1 && <Field label="কোন হাবের রিপোর্ট" required><Combo value={target?.can_upload ? hub : ''} onChange={v => set('hub', v)} clearable={false} label="কোন হাবের রিপোর্ট"
              options={uploadHubs.map(h => ({ value: h.hub_id, label: h.hub_name, sub: h.zone_name }))} /></Field>}
            {hubDiffers && <p className="notice">রিপোর্টে হাব লেখা “{rep.hub_text}”, কিন্তু আপনি বেছেছেন “{target!.hub_name}”। ঠিক হাব বেছে নিয়ে সেভ করুন।</p>}
            {dateDiffers && <p className="notice">রিপোর্টের তারিখ {dateBn(rep.report_date)}, কিন্তু খাতার তারিখ বাছা আছে {dateBn(date)}।{' '}
              {rep.report_date <= today && <button type="button" className="link" onClick={() => set('date', rep.report_date)}>রিপোর্টের তারিখ নিন</button>}</p>}
            {target && !target.can_upload && <p className="notice">এই হাবের রিপোর্ট তোলার অনুমতি আপনার নেই।</p>}
            <ErrorNote error={err} />
            <div className="ri-save">
              <button type="button" disabled={!canSave} onClick={() => void save()}><Icon name="save" size={17} />
                {busy ? 'সেভ হচ্ছে…' : !target ? 'আগে হাব বেছে নিন' : `${dateBn(date)}-এর খাতায় ${known ? 'আপডেট' : 'সেভ'} করুন`}</button>
              {target && <span className="muted small">{target.hub_name} · ম্যানেজার #{rep.manager_code}-এর খাতা</span>}
            </div>
          </>}
        </>}
      </section>}

      {scopedHubAvailable && hubs.length > 0 && <>
        <div className="da-stats">
          <Stat icon="upload" label={date === today ? 'আজ কয়টি রিপোর্ট' : 'রিপোর্ট'} value={num(reports)} />
          <Stat icon="ledger" label="খাতা (ম্যানেজার)" value={num(khatas.length)} />
          <Stat icon="box" label="পার্সেল" value={num(totals.reduce((a, h) => a + h.parcels, 0))} />
          <Stat icon="cash" label="মোট টাকা (চার্জ সহ)" value={taka(totals.reduce((a, h) => a + Number(h.amount) + Number(h.delivery_charge), 0))} />
        </div>
        <ErrorNote error={day.error} />
        {day.loading && !day.data ? <p className="muted">লোড হচ্ছে…</p>
          : !khatas.length ? <div className="nv-empty"><Icon name="ledger" size={34} /><p><b>{dateBn(date)} তারিখে {target ? 'এই হাবে' : ''} কোনো রিপোর্ট ওঠেনি</b></p>
              <p>উপরে রিপোর্ট পেস্ট করে সেভ করলে ম্যানেজার অনুযায়ী খাতা এখানে দেখাবে।</p></div>
          : khatas.map(k => <KhataCard key={`${k.hub_id}-${k.manager_code}`} k={k} showHub={!hub} canMap={!!hubs.find(h => h.hub_id === k.hub_id)?.can_upload}
              onChanged={async msg => { await Promise.all([day.reload(), status.reload()]); toast(msg) }} />)}
      </>}
    </div>
  </AccountsShell>
}

/** One manager's khata for the day: each rider once with the day's sum; tap a row for its lists. */
function KhataCard({ k, showHub, canMap, onChanged }: { k: Khata; showHub: boolean; canMap: boolean; onChanged: (msg: string) => Promise<void> }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [map, setMap] = useState<{ code: string; name: string | null } | null>(null)
  const [raw, setRaw] = useState<ImportReport | null>(null)
  const toggle = (key: string) => setOpen(o => ({ ...o, [key]: !o[key] }))
  const unknown = k.riders.filter(r => !r.known).length
  const listRows = (key: string, lists: ImportList[]) => open[key] ? lists.map(l => <tr key={`${key}-${l.list_no}`} className="ri-sub">
    <td>লিস্ট #{l.list_no}<span className="sec">রিপোর্ট #{l.report_no}</span></td><td className="r">{num(l.parcels)}</td><td className="r">{taka(l.amount)}</td></tr>) : null
  return <section className="panel ri-khata">
    <div className="da-bar">
      <div style={{ minWidth: 0 }}><h2>{k.manager_name || 'ম্যানেজার'} <span className="muted small">#{k.manager_code}</span></h2>
        <span className="sec">{showHub ? `${k.hub_name} · ` : ''}{num(k.reports.length)}টি রিপোর্ট · {num(k.lists)} লিস্ট · {num(k.parcels)} পার্সেল
          {!k.manager_known && <> · <Badge tone="warn">ম্যানেজার আইডি অচেনা</Badge>{canMap && <button type="button" className="link small" onClick={() => setMap({ code: k.manager_code, name: k.manager_name })}> ম্যাপ করুন</button>}</>}</span></div>
      <div className="ri-total"><span className="lbl">মোট Collected</span><b>{taka(k.total)}</b></div>
    </div>
    {unknown > 0 && <p className="notice">{num(unknown)}টি রাইডার আইডি সিস্টেমে নেই। “ম্যাপ করুন” চেপে কর্মী বেছে দিন।</p>}
    <div className="ri-wrap"><table className="ri-table">
      <thead><tr><th>রাইডার</th><th className="r">পার্সেল</th><th className="r">টাকা</th></tr></thead>
      <tbody>
        {k.riders.map(r => <Fragment key={r.rider_code}>
          <tr className="click" onClick={() => toggle(r.rider_code)} aria-expanded={!!open[r.rider_code]}>
            <td><span className={`ri-chev${open[r.rider_code] ? ' on' : ''}`} aria-hidden="true"><Icon name="chev" size={14} /></span>
              <strong>{r.name || r.report_name || '—'}</strong>
              {!r.known && <> <Badge tone="bad">অচেনা</Badge>{canMap && <button type="button" className="secondary sm ri-map" onClick={e => { e.stopPropagation(); setMap({ code: r.rider_code, name: r.report_name }) }}>ম্যাপ করুন</button>}</>}
              <span className="sec">আইডি #{r.rider_code} · {num(r.lists.length)} লিস্ট</span></td>
            <td className="r">{num(r.parcels)}</td><td className="r">{taka(r.amount)}</td></tr>
          {listRows(r.rider_code, r.lists)}
        </Fragment>)}
        {k.point && <>
          <tr className="click ri-special" onClick={() => toggle('point')} aria-expanded={!!open.point}>
            <td><span className={`ri-chev${open.point ? ' on' : ''}`} aria-hidden="true"><Icon name="chev" size={14} /></span><strong>Point delivery</strong>
              <span className="sec">রাইডার ছাড়া · {num(k.point.lists.length)} লিস্ট</span></td>
            <td className="r">{num(k.point.parcels)}</td><td className="r">{taka(k.point.amount)}</td></tr>
          {listRows('point', k.point.lists)}</>}
        <tr className="ri-special"><td><strong>ডেলিভারি চার্জ</strong><span className="sec">রিপোর্টে “Delivery charges paid”</span></td><td className="r">—</td><td className="r">{taka(k.delivery_charge)}</td></tr>
      </tbody>
      <tfoot><tr><td>মোট</td><td className="r">{num(k.parcels)}</td><td className="r">{taka(k.total)}</td></tr></tfoot>
    </table></div>
    <div className="ri-reports">{k.reports.map(r => <button key={r.id} type="button" className="ri-rep" onClick={() => setRaw(r)} title="আসল লেখা দেখুন">
      <Icon name="doc" size={14} /> #{r.report_no} · {reportTime(r.reported_at)} · {taka(r.collected)}
      {r.counted_lists < r.declared_lists && <span className="sec">{num(r.declared_lists - r.counted_lists)}টি লিস্ট পরের রিপোর্টে গোনা</span>}</button>)}</div>
    {map && <MapRider code={map.code} name={map.name} hub={k.hub_id} onClose={() => setMap(null)}
      onDone={async who => { setMap(null); await onChanged(`আইডি #${map.code} → ${who}`) }} />}
    {raw && <RawText report={raw} onClose={() => setRaw(null)} />}
  </section>
}

/** An ID the system does not know: pick the staff member with one tap. */
function MapRider({ code, name, hub, onClose, onDone }: { code: string; name: string | null; hub: string; onClose: () => void; onDone: (who: string) => Promise<void> }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const people = useLoad(() => reportImport.people(hub, q), [hub, q])
  async function pick(id: string, who: string) {
    setBusy(true); setErr(null)
    try { await reportImport.mapRider(code, id); await onDone(who) } catch (e) { setErr(e); setBusy(false) }
  }
  return <Modal title={`আইডি #${code} কোন কর্মী?`} onClose={onClose} actions={<button className="secondary" onClick={onClose}>বন্ধ</button>}>
    <p className="muted small">রিপোর্টে নাম: <b>{name || '—'}</b>। নিচের তালিকা থেকে কর্মীর নামে চাপ দিলেই ম্যাপ হয়ে যাবে; এরপর এই আইডি সব দিনে ওই কর্মীর নামে দেখাবে।</p>
    <Field label="নাম বা এমপ্লয়ি আইডি দিয়ে খুঁজুন"><input value={q} onChange={e => setQ(e.target.value)} placeholder="খালি রাখলে এই হাবের কর্মী" autoFocus /></Field>
    <ErrorNote error={err || people.error} />
    <div className="ri-people">{(people.data ?? []).map(p => <button key={p.id} type="button" className="secondary" disabled={busy} onClick={() => void pick(p.id, p.full_name)}>
      <span><b>{p.full_name}</b><span className="sec">আইডি {p.employee_code ?? '—'}</span></span><Icon name="check" size={16} /></button>)}
      {!people.loading && !(people.data ?? []).length && <p className="muted">কাউকে পাওয়া যায়নি।</p>}</div>
  </Modal>
}

function RawText({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  const raw = useLoad(() => reportImport.rawText(report.id), [report.id])
  return <Modal wide title={`রিপোর্ট #${report.report_no} — পেস্ট করা আসল লেখা`} onClose={onClose} actions={<button className="secondary" onClick={onClose}>বন্ধ</button>}>
    <p className="muted small">আপলোড: {report.uploaded_by_name ?? '—'} · {timeBn(report.uploaded_at)}{report.upload_count > 1 ? ` · ${num(report.upload_count)} বার তোলা হয়েছে (শেষবারের লেখা)` : ''}</p>
    <ErrorNote error={raw.error} />
    <pre className="ri-raw">{raw.loading ? 'লোড হচ্ছে…' : raw.data}</pre>
  </Modal>
}
