import { useState } from 'react'
import { Field, Modal, useLoad } from '../pages/accounts/ui'
import { usePrefs } from '../lib/prefs'
import { download, xlsxBlob } from '../lib/xlsx'
import { colLabel, customFields, exportValue, formatFriendly, staffAdmin, type Format } from '../lib/staffAdmin'
import { Icon } from './Icon'

/** "Export by format" — the company's own column layout, filled from the database. */
export function ExportByFormat({ zone, hub, status, q, title }: {
  zone?: string | null; hub?: string | null; status?: string | null; q?: string | null; title: string
}) {
  const { L, n, lang } = usePrefs()
  const [open, setOpen] = useState(false)
  return <>
    <button className="secondary" onClick={() => setOpen(true)}><Icon name="xls" size={16} />{L('ফরম্যাটে এক্সপোর্ট', 'Export by format')}</button>
    {open && <ExportModal zone={zone} hub={hub} status={status} q={q} title={title} onClose={() => setOpen(false)} L={L} n={n} lang={lang} />}
  </>
}

/** The same dialog, opened from somewhere else (e.g. a "more" menu) instead of its own button. */
export function ExportByFormatDialog({ zone, hub, status, q, title, onClose }: {
  zone?: string | null; hub?: string | null; status?: string | null; q?: string | null; title: string; onClose: () => void
}) {
  const { L, n, lang } = usePrefs()
  return <ExportModal zone={zone} hub={hub} status={status} q={q} title={title} onClose={onClose} L={L} n={n} lang={lang} />
}

function ExportModal({ zone, hub, status, q, title, onClose, L, n, lang }: {
  zone?: string | null; hub?: string | null; status?: string | null; q?: string | null; title: string; onClose: () => void
  L: (bn: string, en: string) => string; n: (v: number | string) => string; lang: string
}) {
  const data = useLoad(async () => {
    const [fmts, custom] = await Promise.all([staffAdmin.formats(), customFields()])
    return { fmts: fmts.filter(f => f.purpose !== 'import'), custom }
  }, [])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState('')
  const list = data.data?.fmts ?? []
  const chosen: Format | undefined = list.find(f => f.id === pick) ?? list.find(f => f.is_default) ?? list[0]

  async function go() {
    if (!chosen) return
    setErr(''); setBusy(true); setDone('')
    try {
      const rows = await staffAdmin.exportRows(chosen.columns.map(c => c.field), { zone, hub, status, q })
      if (!rows.length) { setErr(L('এই বাছাইয়ে কোনো কর্মী নেই।', 'No staff match this selection.')); return }
      const heads = chosen.columns.map(c => colLabel(c, lang))
      const body = rows.map((r, i) => [i + 1, ...chosen.columns.map(c => exportValue(c.field, r[c.field], lang, data.data!.custom))])
      const when = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })
      download(xlsxBlob(`XZM-TEAM — ${title}`, `${colLabel({ field: '', label: chosen.name, label_bn: chosen.name_bn ?? undefined }, lang)} · ${n(rows.length)} · ${when}`,
        ['S/L', ...heads], body), `XZM-TEAM-${title.replace(/[^\wঀ-৿-]+/g, '-')}.xlsx`)
      setDone(L(`${n(rows.length)} জন কর্মীর ফাইল নামানো হয়েছে।`, `${rows.length} staff downloaded.`))
    } catch (e) { setErr(formatFriendly(e)) } finally { setBusy(false) }
  }

  return <Modal title={L('ফরম্যাটে এক্সপোর্ট', 'Export by format')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বন্ধ', 'Close')}</button>
      <button disabled={busy || !chosen} onClick={() => void go()}>{busy ? L('তৈরি হচ্ছে…', 'Preparing…') : L('এক্সেল নামান', 'Download Excel')}</button></>}>
    {!list.length ? <p className="muted">{L('কোনো ফরম্যাট নেই। “প্রোফাইলের ঘর ও কলাম” পাতায় একটা বানিয়ে নিন।', 'No formats yet. Create one on “Profile fields & columns”.')}</p> : <>
      <Field label={L('ফরম্যাট', 'Format')} hint={L('কোন কলামগুলো, কোন ক্রমে আর কী নামে যাবে — ফরম্যাটেই ঠিক করা থাকে।', 'A format decides which columns go out, in which order and under which heading.')}>
        <select value={chosen?.id ?? ''} onChange={e => setPick(e.target.value)}>
          {list.map(f => <option key={f.id} value={f.id}>{lang === 'bn' && f.name_bn ? f.name_bn : f.name}{f.is_default ? L(' (ডিফল্ট)', ' (default)') : ''}{f.zone_id ? L(' · জোন', ' · zone') : ''}</option>)}
        </select></Field>
      {chosen && <p className="muted small">{L('কলাম:', 'Columns:')} {chosen.columns.map(c => colLabel(c, lang)).join(' · ')}</p>}
      <p className="muted small">{L('যে কর্মীদের আপনি দেখতে পান শুধু তাঁরাই যাবেন। এনআইডি বা বেতনের কলাম থাকলেও অনুমতি না থাকলে ঘর খালি আসবে, আর এনআইডি এক্সপোর্ট করলে সেটা লগে থেকে যায়।',
        'Only staff you may see are included. NID or salary columns come out blank without the right permission, and exporting NIDs is recorded in the log.')}</p>
    </>}
    {err && <p className="da-error">{err}</p>}
    {done && <p className="da-ok">{done}</p>}
  </Modal>
}
