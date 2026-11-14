import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Badge, Field, Stat, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { readSheet, excelDate } from '../../lib/sheetRead'
import { DATE_TARGETS, guessTarget, importer, importFriendly, rowError, TARGETS, type Batch, type ImportRow, type Missing } from '../../lib/importer'
import { download, xlsxBlob } from '../../lib/xlsx'
import { useOrg } from './common'

type Sheet = { name: string; rows: string[][] }
const MAP_KEY = 'xzm_import_mapping'
const STATUS: Record<Batch['status'], [string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = {
  uploaded: ['আপলোড হয়েছে', 'neutral'], validated: ['যাচাইয়ের অপেক্ষায়', 'warn'], verified: ['সেভের জন্য প্রস্তুত', 'info'],
  committed: ['সেভ হয়েছে', 'ok'], cancelled: ['বাতিল', 'neutral'],
}

export function ImportEmployees() {
  const { can } = useAuth()
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const batches = useLoad(() => importer.batches(), [])
  const fields = useLoad(() => importer.customFields(), [])
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [headerRow, setHeaderRow] = useState(1)
  const [mapping, setMapping] = useState<Record<number, string>>({})
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const [batchId, setBatchId] = useState<string | null>(null)

  const headers = useMemo(() => (sheet?.rows[headerRow - 1] ?? []).map((h, i) => h || `${L('কলাম', 'Column')} ${i + 1}`), [sheet, headerRow, L])
  const dataRows = useMemo(() => (sheet?.rows.slice(headerRow) ?? []).map((r, i) => ({ i, r })).filter(x => x.r.some(c => (c ?? '').trim() !== '')), [sheet, headerRow])
  const targets: Array<[string, string]> = useMemo(() => [
    ...TARGETS.map(([v, bn, en]) => [v, L(bn, en)] as [string, string]),
    ...(fields.data ?? []).map(f => [`cf:${f.code}`, `${L('প্রোফাইলের ঘর', 'Profile field')}: ${L(f.label_bn || f.label, f.label)}`] as [string, string]),
  ], [fields.data, L])

  function autoMap(hs: string[]) {
    let saved: Record<string, string> = {}
    try { saved = JSON.parse(localStorage.getItem(MAP_KEY) || '{}') } catch { /* ignore */ }
    const used = new Set<string>(); const m: Record<number, string> = {}
    hs.forEach((h, i) => {
      const t = saved[h.trim().toLowerCase()] && !used.has(saved[h.trim().toLowerCase()]) ? saved[h.trim().toLowerCase()] : guessTarget(h, used)
      if (t) { m[i] = t; used.add(t) }
    })
    setMapping(m)
  }

  async function onFile(f: File | undefined) {
    if (!f) return
    setErr(''); setBatchId(null); setBusy(L('ফাইল পড়া হচ্ছে…', 'Reading file…'))
    try {
      const rows = await readSheet(f)
      const hr = Math.max(1, rows.findIndex(r => r.filter(c => (c ?? '').trim()).length >= 2) + 1)
      setSheet({ name: f.name, rows }); setHeaderRow(hr); setSkip(new Set()); autoMap((rows[hr - 1] ?? []).map(String))
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  async function uploadAndCheck() {
    if (!sheet) return
    setErr('')
    // unique key per column (two columns may share a header text)
    const seen = new Map<string, number>()
    const keys = headers.map(h => { const k = h.trim(); const c = seen.get(k) ?? 0; seen.set(k, c + 1); return c ? `${k} (${c + 1})` : k })
    const map: Record<string, string> = {}
    Object.entries(mapping).forEach(([i, t]) => { if (t) map[keys[Number(i)]] = t })
    if (!Object.values(map).includes('full_name')) return setErr(L('নামের কলাম বেছে দিন', 'Choose the name column'))
    if (!Object.values(map).some(t => t === 'hub_name' || t === 'hub_code')) return setErr(L('হাবের কলাম বেছে দিন', 'Choose the hub column'))
    // remember the choices for next time
    try { const s = JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); Object.entries(mapping).forEach(([i, t]) => { if (t) s[headers[Number(i)].trim().toLowerCase()] = t }); localStorage.setItem(MAP_KEY, JSON.stringify(s)) } catch { /* ignore */ }
    const cols = Object.entries(mapping).filter(([, t]) => t).map(([i, t]) => ({ i: Number(i), key: keys[Number(i)], date: DATE_TARGETS.includes(t) || (fields.data ?? []).some(f => `cf:${f.code}` === t && f.field_type === 'date') }))
    const raws = dataRows.filter(x => !skip.has(x.i)).map(({ r }) => {
      const o: Record<string, string> = {}
      cols.forEach(c => { const v = String(r[c.i] ?? '').trim(); o[c.key] = c.date ? excelDate(v) : v })
      return o
    })
    try {
      setBusy(L('আপলোড হচ্ছে…', 'Uploading…'))
      const id = await importer.upload(sheet.name, raws, d => setBusy(`${L('আপলোড হচ্ছে…', 'Uploading…')} ${n(d)}/${n(raws.length)}`))
      setBusy(L('তথ্য যাচাই হচ্ছে…', 'Checking…'))
      await importer.validate(id, map)
      setBatchId(id); setSheet(null); void batches.reload()
    } catch (e) { setErr(importFriendly(e)) } finally { setBusy('') }
  }

  function template() {
    download(xlsxBlob(L('কর্মী ইমপোর্ট টেমপ্লেট', 'Employee import template'), '', ['ID', 'Name', 'Position', 'Hub', 'Mobile', 'Basic', 'Transport', 'Commission', 'Joining Date', 'Reference ID'],
      [['101', 'Abdul Karim', 'Rider', 'Natore Sadar Hub', '01711000000', 12000, 1500, 500, '01/01/2024', '']]), 'employee-import-template.xlsx')
  }

  return <AppShell title={L('কর্মী ইমপোর্ট (Excel)', 'Import employees (Excel)')}
    subtitle={L('পুরনো কর্মীদের তালিকা Excel থেকে তুলুন। যেকোনো কলাম যেকোনো ঘরে বসানো যায় — কোম্পানির নিজের ফরম্যাট চলবে।', 'Bring existing staff in from Excel. Any column can go to any field — your own sheet format works.')}
    actions={<button className="secondary" onClick={template}>{L('নমুনা ফাইল', 'Sample file')}</button>}>
    {node}
    {err && <p className="da-error">{err}</p>}
    {busy && <p className="notice">{busy}</p>}

    {batchId ? <BatchView id={batchId} onClose={() => { setBatchId(null); void batches.reload() }} toast={toast} /> : <>
      <section className="panel">
        <h2>{L('১. ফাইল বেছে নিন', '1. Choose the file')}</h2>
        <input type="file" accept=".xlsx,.csv" onChange={e => void onFile(e.target.files?.[0])} />
        <p className="muted small">{L('.xlsx বা .csv। প্রথম শিট পড়া হবে। শিরোনামের সারি নিজে খুঁজে নেয় — দরকার হলে বদলান।', '.xlsx or .csv. The first sheet is read. The header row is detected — change it if needed.')}</p>
      </section>

      {sheet && <>
        <section className="panel">
          <div className="da-bar"><h2 style={{ margin: 0 }}>{L('২. কোন কলাম কোন ঘরে যাবে', '2. Which column goes where')}</h2>
            <Field label={L('শিরোনামের সারি নম্বর', 'Header row')}><input type="number" min={1} max={20} value={headerRow} style={{ width: 90 }}
              onChange={e => { const v = Math.max(1, Number(e.target.value) || 1); setHeaderRow(v); autoMap((sheet.rows[v - 1] ?? []).map(String)) }} /></Field></div>
          <p className="muted small">{L('নিজে থেকে মিলিয়ে দেওয়া হয়েছে — মিলিয়ে দেখুন। যে কলাম লাগবে না সেটায় "— বাদ —" রাখুন। দরকারি: নাম আর হাব। আইডি থাকলে কর্মী সরাসরি সক্রিয় হবেন, না থাকলে আইডি আবেদনে যাবেন।',
            'Matched automatically — please check. Leave “— skip —” for columns you do not need. Required: name and hub. Rows with an ID become active staff; rows without one go to ID applications.')}</p>
          <div className="da-table-wrap"><table className="da-table">
            <thead><tr><th>{L('Excel কলাম', 'Excel column')}</th><th>{L('নমুনা', 'Sample')}</th><th>{L('কোন ঘরে যাবে', 'Goes to')}</th></tr></thead>
            <tbody>{headers.map((h, i) => <tr key={i}><td><strong>{h}</strong></td>
              <td className="muted small">{dataRows.slice(0, 2).map(x => x.r[i]).filter(Boolean).join(' · ')}</td>
              <td><select value={mapping[i] ?? ''} aria-label={`${h} →`} onChange={e => setMapping({ ...mapping, [i]: e.target.value })}>
                <option value="">{L('— বাদ —', '— skip —')}</option>
                {targets.map(([v, lbl]) => <option key={v} value={v} disabled={Object.entries(mapping).some(([k, t]) => t === v && Number(k) !== i)}>{lbl}</option>)}
              </select></td></tr>)}</tbody></table></div>
        </section>

        <section className="panel">
          <div className="da-bar"><h2 style={{ margin: 0 }}>{L('৩. সারি', '3. Rows')} <span className="muted small">{n(dataRows.length - skip.size)}/{n(dataRows.length)} {L('টি নেওয়া হবে', 'will be taken')}</span></h2>
            <button disabled={!!busy} onClick={() => void uploadAndCheck()}>{L('আপলোড করে যাচাই করুন', 'Upload and check')}</button></div>
          <p className="muted small">{L('যে সারি নিতে চান না তার টিক তুলে দিন।', 'Untick rows you do not want.')}</p>
          <div className="da-table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table className="da-table">
            <thead><tr><th /><th>#</th>{headers.map((h, i) => mapping[i] ? <th key={i}>{h}</th> : null)}</tr></thead>
            <tbody>{dataRows.slice(0, 300).map(({ i, r }) => <tr key={i} style={skip.has(i) ? { opacity: .45 } : undefined}>
              <td><input type="checkbox" style={{ width: 'auto' }} aria-label={`row ${i + headerRow + 1}`} checked={!skip.has(i)} onChange={e => { const s = new Set(skip); if (e.target.checked) s.delete(i); else s.add(i); setSkip(s) }} /></td>
              <td className="muted small">{n(i + headerRow + 1)}</td>
              {headers.map((_, k) => mapping[k] ? <td key={k}>{r[k]}</td> : null)}</tr>)}</tbody></table></div>
          {dataRows.length > 300 && <p className="muted small">{L(`প্রথম ৩০০ সারি দেখানো হলো; সব ${n(dataRows.length)} সারি আপলোড হবে।`, `Showing the first 300; all ${dataRows.length} rows will be uploaded.`)}</p>}
        </section>
      </>}

      <section className="panel">
        <h2>{L('আগের ইমপোর্ট', 'Earlier imports')}</h2>
        {!batches.data?.length ? <p className="muted">{L('এখনো কোনো ইমপোর্ট নেই।', 'No imports yet.')}</p> :
          <div className="da-table-wrap"><table className="da-table"><thead><tr><th>{L('ফাইল', 'File')}</th><th>{L('অবস্থা', 'Status')}</th><th>{L('সারি', 'Rows')}</th><th>{L('ঠিক', 'Valid')}</th><th>{L('ভুল', 'Errors')}</th><th /></tr></thead>
            <tbody>{batches.data.map(b => <tr key={b.id}><td>{b.file_name}<span className="sec">{new Date(b.created_at).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' })}</span></td>
              <td><Badge tone={STATUS[b.status][1]}>{STATUS[b.status][0]}</Badge></td><td>{n(b.total_rows)}</td><td>{n(b.valid_rows)}</td><td>{n(b.error_rows)}</td>
              <td style={{ textAlign: 'right' }}><button className="secondary sm" onClick={() => setBatchId(b.id)}>{L('খুলুন', 'Open')}</button></td></tr>)}</tbody></table></div>}
        {!can('hr.import.approve') && <p className="muted small">{L('ইমপোর্ট সেভ করার আগে অনুমতিপ্রাপ্ত আরেকজন যাচাই করবেন।', 'Another authorised person verifies before the import is saved.')}</p>}
      </section>
    </>}
  </AppShell>
}

function BatchView({ id, onClose, toast }: { id: string; onClose: () => void; toast: (m: string) => void }) {
  const { can, session } = useAuth()
  const { L, n } = usePrefs()
  const o = useOrg()
  const data = useLoad(async () => {
    const b = await importer.batch(id)
    const [rows, missing] = await Promise.all([importer.rows(id), b && (b.status === 'uploaded' || b.status === 'validated') ? importer.missing(id).catch(() => [] as Missing[]) : Promise.resolve([] as Missing[])])
    return { b, rows, missing }
  }, [id])
  const [show, setShow] = useState<'error' | 'valid' | 'all'>('error')
  const [zone, setZone] = useState(''); const [dept, setDept] = useState('')
  const [skipBad, setSkipBad] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const b = data.data?.b
  const rows = (data.data?.rows ?? []).filter(r => show === 'all' || (show === 'error' ? r.status === 'error' || r.status === 'skipped' : r.status === 'valid' || r.status === 'imported'))
  const missing = data.data?.missing ?? []
  const mapped = b ? Object.entries(b.column_mapping) : []

  async function act(f: () => Promise<unknown>, ok: string) {
    setErr(''); setBusy(true)
    try { await f(); toast(ok); await data.reload() } catch (e) { setErr(importFriendly(e)) } finally { setBusy(false) }
  }
  const revalidate = () => importer.validate(id, b!.column_mapping)

  if (!b) return <section className="panel"><p className="muted">{data.loading ? L('লোড হচ্ছে…', 'Loading…') : L('ইমপোর্ট পাওয়া যায়নি', 'Import not found')}</p><button className="secondary" onClick={onClose}>←</button></section>
  const mine = b.created_by === session?.user.id
  return <>
    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{b.file_name} <Badge tone={STATUS[b.status][1]}>{STATUS[b.status][0]}</Badge></h2>
        <button className="secondary" onClick={onClose}>← {L('নতুন ইমপোর্ট / তালিকা', 'New import / list')}</button></div>
      <div className="da-stats" style={{ marginTop: 10 }}>
        <Stat icon="table" label={L('মোট সারি', 'Rows')} value={n(b.total_rows)} />
        <Stat icon="check" tone="ok" label={L('ঠিক আছে', 'Valid')} value={n(b.valid_rows)} />
        <Stat icon="alert" tone={b.error_rows ? 'bad' : undefined} label={L('ভুল আছে', 'With errors')} value={n(b.error_rows)} />
      </div>
      {err && <p className="da-error">{err}</p>}

      {missing.length > 0 && (b.status === 'validated' || b.status === 'uploaded') && <div className="notice" style={{ marginTop: 10 }}>
        <strong>{L('এগুলো সিস্টেমে নেই:', 'Not in the system yet:')}</strong>
        <ul style={{ margin: '6px 0' }}>{missing.map(m => <li key={m.kind + m.name}>{m.kind === 'hub' ? L('হাব', 'Hub') : m.kind === 'position' ? L('পদবি', 'Position') : L('বিভাগ', 'Department')}: <strong>{m.name}</strong> <span className="muted small">({n(m.row_count)} {L('সারি', 'rows')})</span></li>)}</ul>
        <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {missing.some(m => m.kind === 'hub') && <Field label={L('নতুন হাবগুলো কোন জোনে', 'Zone for new hubs')}><select value={zone} onChange={e => setZone(e.target.value)}>
            <option value="">{L('বেছে নিন…', 'Choose…')}</option>{o.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
          {missing.some(m => m.kind === 'position') && <Field label={L('নতুন পদবিগুলো কোন বিভাগে (ঐচ্ছিক)', 'Department for new positions (optional)')}><select value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">—</option>{o.data?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
        </div>
        <button disabled={busy} onClick={() => void act(async () => { await importer.createMissing(id, zone || null, dept || null); await revalidate() }, L('নতুন হাব/পদবি তৈরি হয়ে আবার যাচাই হয়েছে', 'Created and checked again'))}>
          {L('এগুলো তৈরি করে আবার যাচাই করুন', 'Create these and check again')}</button>
        {o.data && !o.data.zones.length && missing.some(m => m.kind === 'hub') && <p className="small" style={{ marginBottom: 0 }}>{L('আগে “জোন, হাব ও পদ” পাতায় অন্তত একটি জোন বানান।', 'First create at least one zone on “Zones, hubs & posts”.')}</p>}
      </div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {(b.status === 'validated' || b.status === 'uploaded') && <button className="secondary" disabled={busy} onClick={() => void act(revalidate, L('আবার যাচাই হয়েছে', 'Checked again'))}>{L('আবার যাচাই', 'Check again')}</button>}
        {b.status === 'validated' && can('hr.import.approve') && <button disabled={busy || b.valid_rows === 0} onClick={() => void act(() => importer.verify(id), L('যাচাই নিশ্চিত হয়েছে', 'Verified'))}>
          {mine ? L('যাচাই নিশ্চিত করুন', 'Confirm check') : L('যাচাই নিশ্চিত করুন (দ্বিতীয় জন)', 'Verify (second person)')}</button>}
        {b.status === 'verified' && can('hr.import.approve') && <>
          {b.error_rows > 0 && <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={skipBad} onChange={e => setSkipBad(e.target.checked)} />{L(`ভুল ${n(b.error_rows)}টি সারি বাদ দিয়ে সেভ করুন`, `Skip the ${b.error_rows} rows with errors`)}</label>}
          <button disabled={busy || (b.error_rows > 0 && !skipBad)} onClick={() => void act(async () => { const r = await importer.commit(id, skipBad); toast(L(`সেভ হয়েছে: ${n(r.activated)} জন সক্রিয়, ${n(r.awaiting_employee_id)} জন আইডির অপেক্ষায়`, `Saved: ${r.activated} active, ${r.awaiting_employee_id} awaiting ID`)) }, L('কর্মীরা সিস্টেমে উঠেছে', 'Employees saved'))}>
            {L('কর্মীদের সেভ করুন', 'Save employees')}</button></>}
        {b.status !== 'committed' && b.status !== 'cancelled' && <button className="secondary" disabled={busy} onClick={() => void act(() => importer.cancel(id), L('ইমপোর্ট বাতিল হয়েছে', 'Import cancelled'))}>{L('বাতিল', 'Cancel import')}</button>}
      </div>
    </section>

    <section className="panel">
      <div className="da-bar"><h2 style={{ margin: 0 }}>{L('সারিগুলো', 'Rows')}</h2>
        <select value={show} onChange={e => setShow(e.target.value as 'error' | 'valid' | 'all')} style={{ maxWidth: 200 }}>
          <option value="error">{L('শুধু ভুলগুলো', 'Errors only')}</option><option value="valid">{L('শুধু ঠিকগুলো', 'Valid only')}</option><option value="all">{L('সব', 'All')}</option></select></div>
      {!rows.length ? <p className="muted">{show === 'error' ? L('কোনো ভুল নেই 🎉', 'No errors') : L('কিছু নেই', 'Nothing')}</p> :
        <div className="da-table-wrap" style={{ maxHeight: 480, overflow: 'auto' }}><table className="da-table">
          <thead><tr><th>#</th>{mapped.map(([h]) => <th key={h}>{h}</th>)}<th>{L('ফল', 'Result')}</th></tr></thead>
          <tbody>{rows.slice(0, 500).map((r: ImportRow) => <tr key={r.id}><td className="muted small">{n(r.row_number)}</td>
            {mapped.map(([h]) => <td key={h}>{r.raw[h]}</td>)}
            <td>{r.errors.length ? <span className="bad small">{r.errors.map(rowError).join(' · ')}</span>
              : <Badge tone={r.status === 'imported' ? 'ok' : 'info'}>{r.status === 'imported' ? L('সেভ হয়েছে', 'Saved') : L('ঠিক আছে', 'OK')}</Badge>}</td></tr>)}</tbody></table></div>}
    </section>
  </>
}
