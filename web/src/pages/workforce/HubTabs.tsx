import { useMemo, useState } from 'react'
import { Contact } from '../../components/Contact'
import { Icon } from '../../components/Icon'
import { todayDhaka } from '../../lib/dailyAccounts'
import { usePrefs } from '../../lib/prefs'
import { APP_META, LIVE, useLiveLoad, wf, wfFriendly,
  type AbsenceApp, type AppStatus, type Can, type OpsReport, type OpsTotals } from '../../lib/workforce'
import { Badge, Field, Modal, Stat, useLoad, useToast } from '../accounts/ui'
import { Empty, Loading, NoteDialog, Notice, RangeBar, Section, Who, WmTable, exportRows, fmtDay, fmtStamp, fmtWeekday, lastMonths, monthName, useRange,
  type WCol } from './shared'

/**
 * The two hub tabs the final register does not cover, used by the one attendance page (AttendancePage):
 *   AppsTab  — absence applications staff sent from the book (a staff member who did not apply on the website). They are decided here.
 *   OpsTab   — the daily pickup / return / delivery numbers staff give.
 * Every rule stays in the database (wf_* functions).
 */
// ====================================================================================== আবেদন
export function AppsTab({ hubId, can, onChanged }: { hubId: string; can: Can; onChanged: () => void }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const today = todayDhaka()
  const [month, setMonth] = useState('')
  const [pick, setPick] = useState<AppStatus | 'all' | null>(null)
  const q = useLiveLoad<AbsenceApp[]>(() => wf.applications({ hub: hubId }, null, month || null), [hubId, month], LIVE.manage)
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const [rej, setRej] = useState<AbsenceApp | null>(null)
  const all = q.data ?? []
  const cnt = (s: AppStatus) => all.filter(a => a.status === s).length
  const eff: AppStatus | 'all' = pick ?? (cnt('pending') ? 'pending' : 'all')
  const list = useMemo(() => all.filter(a => eff === 'all' || a.status === eff).sort((a, b) => {
    const pa = a.status === 'pending' ? 0 : 1, pb = b.status === 'pending' ? 0 : 1
    return pa - pb || (pa === 0 ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at))
  }), [all, eff])
  const months = useMemo(() => lastMonths(today, 12), [today])

  async function approve(a: AbsenceApp) {
    setBusy(a.id); setErr('')
    try { const k = await wf.decideApplication(a.id, true); toast(L(`${a.application_no} অনুমোদিত — ${n(k)}টি তারিখ খাতায় উঠেছে`, `${a.application_no} approved — ${k} dates on the register`)); void q.reload(); onChanged() }
    catch (e) { setErr(wfFriendly(e)) } finally { setBusy('') }
  }
  const chip = (s: AppStatus | 'all', bn: string, en: string, c: number) => <button key={s} type="button" className={`wm-chip${eff === s ? ' on' : ''}`} aria-pressed={eff === s} onClick={() => setPick(s)}>
    {L(bn, en)}<b className="plain">{n(c)}</b></button>

  return <>
    {node}
    <Section title={L('অনুপস্থিতির আবেদন', 'Absence applications')} hint={L('কর্মী ওয়েবসাইটে আবেদন না করে থাকলে এখান থেকে আবেদন পাঠান। এখানেই সিদ্ধান্ত ও অবস্থা দেখা যায় (ট্র্যাকিং)।', 'Staff who did not apply on the website apply here. Decisions and status are tracked here.')}
      tools={<Field label={L('মাস', 'Month')}><select value={month} onChange={e => { setMonth(e.target.value); setPick(null) }}>
        <option value="">{L('সব মাস', 'All months')}</option>{months.map(m => <option key={m} value={m}>{monthName(m, lang)}</option>)}</select></Field>}>
      <div className="wm-chips no-print" role="group" aria-label={L('অবস্থা', 'Status')}>
        {chip('pending', 'অপেক্ষায়', 'Pending', cnt('pending'))}{chip('approved', 'অনুমোদিত', 'Approved', cnt('approved'))}{chip('rejected', 'বাতিল', 'Rejected', cnt('rejected'))}
        {chip('cancelled', 'তুলে নেওয়া', 'Withdrawn', cnt('cancelled'))}{chip('all', 'সব', 'All', all.length)}</div>
      {!can.decide && <Notice>{L('আপনি দেখতে পারেন, কিন্তু সিদ্ধান্ত দেওয়ার অনুমতি আপনার নেই।', 'You can see these, but you may not decide.')}</Notice>}
      {err ? <p className="da-error" role="alert">{err}</p> : null}
      {q.error && !q.data ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
      {!q.data && !q.error ? <Loading /> : null}
      {q.data && <div className={q.loading ? 'wm-stale' : ''}>
        {!list.length ? <Empty>{L('এই অবস্থায় কোনো আবেদন নেই।', 'No application in this state.')}</Empty> :
          <ul className="wm-apps">{list.map(a => <li key={a.id} className={`wm-app s-${a.status}`}>
            <div className="wm-app-h"><b className="wm-no">{a.application_no}</b><Badge tone={APP_META[a.status].tone}>{lang === 'bn' ? APP_META[a.status].bn : APP_META[a.status].en}</Badge>
              <span className="muted small">{fmtStamp(a.created_at, lang)}</span></div>
            <Who name={a.employee_name} code={a.employee_code} />
            <div className="wm-dchips">{a.dates.map(d => <span key={d} className="wm-dpill">{fmtDay(d, lang)}<small>{fmtWeekday(d, lang)}</small></span>)}</div>
            <p className="wm-reason">{a.reason}</p>
            {a.status !== 'pending' && <p className="wm-decided small muted">
              {a.status === 'cancelled' ? <>{L('কর্মী নিজে তুলে নিয়েছেন', 'Withdrawn by the person')} · {fmtStamp(a.cancelled_at, lang)}</>
                : <>{a.status === 'approved' ? L('অনুমোদন', 'Approved') : L('বাতিল', 'Rejected')}: <b>{a.decided_by_name ?? '—'}</b> · {fmtStamp(a.decided_at, lang)}{a.decision_note ? ` — ${a.decision_note}` : ''}</>}</p>}
            {a.status === 'pending' && can.decide && <div className="wm-acts">
              <button type="button" disabled={busy === a.id} onClick={() => void approve(a)}><Icon name="check" size={16} />{L('অনুমোদন', 'Approve')}</button>
              <button type="button" className="danger" disabled={busy === a.id} onClick={() => setRej(a)}>{L('বাতিল করুন…', 'Reject…')}</button></div>}
          </li>)}</ul>}
        {list.length > 0 && <div className="wm-after no-print"><button type="button" className="secondary sm" onClick={() => exportRows(L('অনুপস্থিতির আবেদন', 'Absence applications'), list[0]?.hub_name ?? '',
          [L('নম্বর', 'No'), L('আইডি', 'ID'), L('নাম', 'Name'), L('তারিখ', 'Dates'), L('কারণ', 'Reason'), L('অবস্থা', 'Status'), L('জমা', 'Sent'), L('সিদ্ধান্ত দিয়েছেন', 'Decided by'), L('সিদ্ধান্তের সময়', 'Decided at'), L('সিদ্ধান্তের কথা', 'Decision note')],
          list.map(a => [a.application_no, a.employee_code, a.employee_name, a.dates.join(', '), a.reason, APP_META[a.status].en, a.created_at.slice(0, 16).replace('T', ' '), a.decided_by_name, a.decided_at?.slice(0, 16).replace('T', ' ') ?? null, a.decision_note]),
          `applications-${month || 'all'}`)}><Icon name="xls" size={15} />{L('এক্সেল', 'Excel')}</button></div>}
      </div>}
    </Section>
    {rej && <NoteDialog title={`${rej.application_no} — ${L('আবেদন বাতিল', 'Reject application')}`} label={L('কেন বাতিল করছেন?', 'Why is it rejected?')} confirm={L('বাতিল করুন', 'Reject')} danger
      hint={`${rej.employee_name} · ${rej.dates.map(d => fmtDay(d, lang)).join(', ')}`} onClose={() => setRej(null)}
      onConfirm={async note => { await wf.decideApplication(rej.id, false, note); toast(L(`${rej.application_no} বাতিল করা হয়েছে`, `${rej.application_no} rejected`)); setRej(null); void q.reload(); onChanged() }} />}
  </>
}

// ====================================================================================== দৈনিক রিপোর্ট
const NUM_CHIPS = ['pickup', 'pickup_return', 'delivery', 'delivery_return'] as const
export function OpsTab({ hubId }: { hubId: string }) {
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const r = useRange('today')
  const q = useLiveLoad<OpsReport>(() => wf.opsReport({ hub: hubId }, r.from, r.to), [hubId, r.from, r.to], LIVE.manage)
  const d = q.data
  const [edit, setEdit] = useState<OpsReport['rows'][number] | null>(null)
  const [hist, setHist] = useState<OpsReport['rows'][number] | null>(null)
  const label = (k: typeof NUM_CHIPS[number]) => k === 'pickup' ? L('পিকআপ', 'Pickup') : k === 'pickup_return' ? L('পিকআপ রিটার্ন', 'Pickup return') : k === 'delivery' ? L('ডেলিভারি', 'Delivery') : L('ডেলিভারি রিটার্ন', 'Delivery return')
  const nums = <T extends OpsTotals>(foot?: OpsTotals | null): Array<WCol<T>> =>
    NUM_CHIPS.map(k => ({ key: k, label: label(k), num: true, sort: true, text: (x: T) => x[k], cell: (x: T) => n(x[k]), foot: foot ? <b>{n(foot[k])}</b> : undefined }))
  const sub = `${fmtDay(r.from, lang)}${r.from !== r.to ? ` – ${fmtDay(r.to, lang)}` : ''}`

  return <>
    {node}
    <Section title={L('দৈনিক অপারেশন রিপোর্ট', 'Daily operations report')} hint={L('কর্মীরা নিজের আজকের পিকআপ, রিটার্ন ও ডেলিভারির সংখ্যা দেন — হাব ও জোনসহ এখানে জমা হয়।', 'Staff give their own pickup, return and delivery numbers; they collect here by hub and zone.')}>
      <RangeBar r={r} presets={['today', 'yesterday', '7d', 'month', 'custom']} />
      {q.error && !d ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : null}
      {!d && !q.error ? <Loading /> : null}
      {d && <div className={q.loading ? 'wm-stale' : ''}>
        <div className="da-stats">
          {NUM_CHIPS.map((k, i) => <Stat key={k} icon={i % 2 ? 'swap' : i ? 'truck' : 'box'} label={label(k)} value={n(d.totals[k])} />)}
          <Stat icon="users" label={L('কতজন দিয়েছেন', 'People gave')} value={n(d.totals.people)} sub={L(`${n(d.totals.entries)}টি এন্ট্রি`, `${d.totals.entries} entries`)} />
          <Stat icon="alert" tone={d.missing_today.length ? 'warn' : 'ok'} label={L('আজ এখনো দেননি', 'Not given today')} value={n(d.missing_today.length)} />
        </div>
      </div>}
    </Section>

    {d && <div className={q.loading ? 'wm-stale' : ''}>
      {d.missing_today.length > 0 && <Section title={L(`আজ এখনো দেননি (${n(d.missing_today.length)})`, `Not given today (${d.missing_today.length})`)} hint={L('এক ট্যাপে ফোন, এসএমএস বা হোয়াটসঅ্যাপ করুন।', 'One tap to call, text or WhatsApp.')}>
        <ul className="wm-people">{d.missing_today.map(p => <li key={p.employee_id} className="wm-prow"><Who name={p.name} code={p.code} position={p.position} /><span className="wm-pst" /><Contact phone={p.mobile} showNumber={false} text={L('আজকের পিকআপ-ডেলিভারির সংখ্যা দিন', 'Please give today’s numbers')} /></li>)}</ul>
      </Section>}

      {!d.rows.length ? <Section title={L('এই সময়ের রিপোর্ট', 'Report for this period')}><Empty>{L('এই সময়ে কেউ পিকআপ-ডেলিভারির সংখ্যা দেননি।', 'No one gave pickup / delivery numbers in this period.')}</Empty></Section> : <>
      <Section title={L('কর্মী অনুযায়ী', 'By person')}>
        <WmTable<OpsReport['by_person'][number]> cols={[
          { key: 'who', label: L('কর্মী', 'Person'), primary: true, sort: true, text: p => p.name, cell: p => <Who name={p.name} code={p.code} position={p.position} /> },
          { key: 'days', label: L('দিন', 'Days'), num: true, sort: true, text: p => p.days, cell: p => n(p.days), foot: undefined },
          ...nums<OpsReport['by_person'][number]>(d.totals)]} rows={d.by_person} rowKey={p => p.employee_id} grid
          title={L('কর্মী অনুযায়ী পিকআপ-ডেলিভারি', 'Operations by person')} file={`ops-by-person-${r.from}`} sub={sub}
          empty={<Empty>{L('এই সময়ে কেউ কিছু দেননি।', 'No one gave numbers in this period.')}</Empty>} />
      </Section>

      <Section title={L('দিন অনুযায়ী', 'By day')}>
        <WmTable<OpsReport['by_day'][number]> cols={[
          { key: 'date', label: L('তারিখ', 'Date'), primary: true, sort: true, text: x => x.date, cell: x => <span className="wm-dt"><b>{fmtDay(x.date, lang)}</b><small>{fmtWeekday(x.date, lang)}</small></span> },
          { key: 'people', label: L('কতজন', 'People'), num: true, sort: true, text: x => x.people, cell: x => n(x.people) },
          ...nums<OpsReport['by_day'][number]>(d.totals)]} rows={d.by_day} rowKey={x => x.date} grid defaultSort={{ key: 'date', dir: -1 }}
          title={L('দিন অনুযায়ী পিকআপ-ডেলিভারি', 'Operations by day')} file={`ops-by-day-${r.from}`} sub={sub} />
      </Section>

      <Section title={L('সব এন্ট্রি', 'All entries')} hint={d.can_edit ? L('ভুল হলে “সংশোধন” চাপুন — কারণ লিখতে হবে, ইতিহাসে থাকবে।', 'Use “Correct” for a wrong number — a reason is needed and it stays in the history.') : undefined}>
        <WmTable<OpsReport['rows'][number]> cols={[
          { key: 'who', label: L('কর্মী', 'Person'), primary: true, sort: true, text: x => x.employee_name, cell: x => <Who name={x.employee_name} code={x.employee_code} position={x.position} /> },
          { key: 'date', label: L('তারিখ', 'Date'), sort: true, text: x => x.work_date, cell: x => <span className="wm-dt"><b>{fmtDay(x.work_date, lang)}</b><small>{fmtWeekday(x.work_date, lang)}</small></span> },
          ...nums<OpsReport['rows'][number]>(),
          { key: 'rev', label: L('সংশোধন', 'Edits'), num: true, text: x => x.revision - 1, cell: x => x.revision > 1 ? <Badge tone="info">{n(x.revision - 1)}</Badge> : <span className="muted">—</span> },
          { key: 'note', label: L('কথা', 'Note'), text: x => x.note ?? '', cell: x => x.note ? <span className="wm-wrap">{x.note}</span> : <span className="muted">—</span> },
          { key: 'act', label: '', cls: 'act', cell: x => <span className="wm-acts">
            <button type="button" className="secondary sm" onClick={() => setHist(x)}>{L('ইতিহাস', 'History')}</button>
            {d.can_edit && <button type="button" className="secondary sm" onClick={() => setEdit(x)}><Icon name="edit" size={14} />{L('সংশোধন', 'Correct')}</button>}</span> },
        ]} rows={d.rows} rowKey={x => x.id} grid title={L('দৈনিক এন্ট্রি', 'Daily entries')} file={`ops-entries-${r.from}`} sub={sub}
          empty={<Empty>{L('এই সময়ে কোনো এন্ট্রি নেই।', 'No entries in this period.')}</Empty>} />
      </Section></>}
    </div>}

    {edit && <OpsEdit row={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void q.reload(); toast(L('সংশোধন হয়েছে', 'Corrected')) }} />}
    {hist && <OpsHistoryModal row={hist} onClose={() => setHist(null)} />}
  </>
}

function OpsEdit({ row, onClose, onDone }: { row: OpsReport['rows'][number]; onClose: () => void; onDone: () => void }) {
  const { L, lang } = usePrefs()
  const [v, setV] = useState<Record<typeof NUM_CHIPS[number], string>>({ pickup: String(row.pickup), pickup_return: String(row.pickup_return), delivery: String(row.delivery), delivery_return: String(row.delivery_return) })
  const names: Record<typeof NUM_CHIPS[number], string> = { pickup: L('পিকআপ', 'Pickup'), pickup_return: L('পিকআপ রিটার্ন', 'Pickup return'), delivery: L('ডেলিভারি', 'Delivery'), delivery_return: L('ডেলিভারি রিটার্ন', 'Delivery return') }
  const nums = NUM_CHIPS.map(k => Number(v[k]))
  const valid = nums.every(x => Number.isInteger(x) && x >= 0 && x <= 100000)
  return <NoteDialog title={`${row.employee_name} · ${fmtDay(row.work_date, lang)}`} label={L('সংশোধনের কারণ', 'Reason for the correction')} confirm={L('সংশোধন সেভ করুন', 'Save correction')} onClose={onClose}
    hint={L('কর্মীর দেওয়া সংখ্যা বদলে যাবে; আগের সংখ্যা ইতিহাসে থাকবে।', 'The number changes; the old one stays in the history.')}
    onConfirm={async note => { if (!valid) throw new Error('numbers must be non-negative'); await wf.correctOps(row.id, { pickup: nums[0], pickup_return: nums[1], delivery: nums[2], delivery_return: nums[3] }, note); onDone() }}>
    <div className="wm-numgrid">{NUM_CHIPS.map(k => <Field key={k} label={names[k]}><input type="number" inputMode="numeric" min={0} max={100000} step={1} value={v[k]} onChange={e => setV(s => ({ ...s, [k]: e.target.value }))} /></Field>)}</div>
    {!valid && <p className="da-error" role="alert">{L('সংখ্যা ০ থেকে ১,০০,০০০-এর মধ্যে পূর্ণ সংখ্যা হতে হবে।', 'Whole numbers from 0 to 100000.')}</p>}
  </NoteDialog>
}

function OpsHistoryModal({ row, onClose }: { row: OpsReport['rows'][number]; onClose: () => void }) {
  const { L, n, lang } = usePrefs()
  const q = useLoad(() => wf.opsHistory(row.id), [row.id])
  const t = (x: { pickup: number; pickup_return: number; delivery: number; delivery_return: number } | null) => x ? `${n(x.pickup)} · ${n(x.pickup_return)} · ${n(x.delivery)} · ${n(x.delivery_return)}` : '—'
  return <Modal title={`${row.employee_name} · ${fmtDay(row.work_date, lang)}`} onClose={onClose} actions={<button type="button" className="secondary" onClick={onClose}>{L('বন্ধ করুন', 'Close')}</button>}>
    <p className="muted small">{L('ক্রম: পিকআপ · পিকআপ রিটার্ন · ডেলিভারি · ডেলিভারি রিটার্ন', 'Order: pickup · pickup return · delivery · delivery return')}</p>
    {q.loading ? <Loading /> : q.error ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p> : !q.data?.length ? <Empty>{L('কোনো ইতিহাস নেই।', 'No history.')}</Empty> :
      <ol className="wm-hlist">{q.data.map(h => <li key={h.id}><b>{L('সংস্করণ', 'Version')} {n(h.revision)}</b> · {fmtStamp(h.at, lang)}{h.by_name ? ` · ${h.by_name}` : ''}
        <span>{h.from ? <>{t(h.from)} → </> : null}<b>{t(h.to)}</b></span>{h.note ? <span className="muted">{h.note}</span> : null}</li>)}</ol>}
  </Modal>
}

