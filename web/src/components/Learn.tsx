// হিসাব শেখা — one lesson on screen (six parts + practice), the instruction button every accounts
// section carries, and the official-rules box.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { LESSONS, OFFICIAL_NOTE, lessonOf, type Lesson, type ModuleKey } from '../lib/accountsGuide'
import { da } from '../lib/dailyAccounts'
import { ErrorNote, Modal, useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'
import { PracticeBox } from './Practice'

type Part = 'how' | 'steps' | 'sample' | 'docs' | 'mistakes' | 'practice'
const PARTS: Array<[Part, string]> = [['how', 'কীভাবে কাজ করবেন?'], ['steps', 'ধাপে ধাপে নির্দেশনা'], ['sample', 'নমুনা হিসাব'],
  ['docs', 'প্রয়োজনীয় কাগজপত্র'], ['mistakes', 'সাধারণ ভুল'], ['practice', 'অনুশীলন']]

/** Head office's official SteadFast rule for this module (and the general one), kept apart from the internal guide. */
export function OfficialBox({ module }: { module: string }) {
  const { can } = useAuth()
  const st = useLoad(() => da.settings().catch(() => null), [])
  const all: Record<string, string> = st.data?.['da.learn_official'] ?? {}
  const text = [all.general, module !== 'general' ? all[module] : ''].filter(x => x && x.trim()).join('\n\n')
  const [edit, setEdit] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const canWrite = can('da.settings.configure')
  async function save() {
    if (edit === null) return
    setBusy(true); setErr(null)
    try { await da.configure('da.learn_official', { ...all, [module]: edit.trim() }); setEdit(null); await st.reload() } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <div className={`lr-official${text ? '' : ' empty'}`}>
    <div className="lr-src"><Icon name="shield" size={16} /><b>SteadFast অফিশিয়াল (হেড অফিস)</b>
      {canWrite && edit === null && <button type="button" className="link small" onClick={() => setEdit(all[module] ?? '')}>{text ? 'বদলান' : 'লিখে দিন'}</button>}</div>
    {edit !== null ? <>
      <textarea rows={5} value={edit} onChange={e => setEdit(e.target.value)} placeholder="SteadFast-এর অফিশিয়াল নিয়ম যেভাবে আছে হুবহু লিখুন — এটাকেই অফিশিয়াল ধরা হবে।" />
      <ErrorNote error={err} />
      <div className="row"><button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'হচ্ছে…' : 'সংরক্ষণ'}</button><button type="button" className="secondary" onClick={() => setEdit(null)}>বাতিল</button></div>
    </> : text ? <p className="lr-pre">{text}</p>
      : <p className="muted small">হেড অফিস এখনো এই অংশের অফিশিয়াল নিয়ম লিখে দেয়নি। নিচের সব নির্দেশনা এই সিস্টেমের নিজস্ব — অফিশিয়াল নিয়ম হেড অফিসের কাছ থেকে নিশ্চিত হোন।</p>}
  </div>
}

/** One lesson: the six parts and practice. */
export function LessonView({ lesson, start }: { lesson: Lesson; start?: Part }) {
  const parts = PARTS.filter(([p]) => p !== 'practice' || lesson.practice)
  const [part, setPart] = useState<Part>(start ?? 'how')
  useEffect(() => { setPart(start ?? 'how') }, [lesson.key, start])
  return <div className="lr-lesson" data-lesson={lesson.key}>
    <p className="lr-what">{lesson.what}{lesson.where && <> · <Link to={lesson.where.to}>{lesson.where.label} →</Link></>}</p>
    <OfficialBox module={lesson.key} />
    <div className="lr-src internal"><Icon name="book" size={16} /><b>সিস্টেমের অভ্যন্তরীণ নির্দেশনা</b><span className="muted small">— এই সিস্টেম কীভাবে কাজ করে</span></div>
    <nav className="lr-parts" aria-label="শেখার অংশ">{parts.map(([p, l]) =>
      <button key={p} type="button" className={part === p ? 'on' : ''} aria-pressed={part === p} onClick={() => setPart(p)}>{l}</button>)}</nav>

    {part === 'how' && <div className="lr-body"><ul className="lr-list">{lesson.how.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
    {part === 'steps' && <div className="lr-body">
      <ol className="lr-steps">{lesson.steps.map((x, i) => <li key={i}><i>{(i + 1).toLocaleString('bn-BD')}</i><span>{x}</span></li>)}</ol>
      {lesson.fields.length > 0 && <><h3>প্রতিটি ঘরের মানে</h3>
        <div className="lr-fields">{lesson.fields.map(([f, d, e]) => <div key={f} className="lr-field"><b>{f}</b><span>{d}</span><small>সঠিক উদাহরণ: <code>{e}</code></small></div>)}</div></>}
    </div>}
    {part === 'sample' && <div className="lr-body">
      <div className="da-table-wrap"><table className="da-table lr-sample"><thead><tr>{lesson.sample.cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{lesson.sample.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-l={lesson.sample.cols[j]}>{c}</td>)}</tr>)}</tbody></table></div>
      {lesson.sample.note && <p className="muted small">{lesson.sample.note}</p>}
      <p className="muted small">নমুনার নাম ও টাকা বানানো — শুধু শেখার জন্য।</p>
    </div>}
    {part === 'docs' && <div className="lr-body">{lesson.docs.length ? <ul className="lr-list docs">{lesson.docs.map(d => <li key={d}><Icon name="doc" size={16} />{d}</li>)}</ul>
      : <p className="muted">এই অংশে আলাদা কাগজ লাগে না।</p>}</div>}
    {part === 'mistakes' && <div className="lr-body"><div className="lr-mist">{lesson.mistakes.map(([m, f]) =>
      <div key={m}><p className="bad"><Icon name="x" size={15} />{m}</p><p className="good"><Icon name="check" size={15} />{f}</p></div>)}</div></div>}
    {part === 'practice' && lesson.practice && <div className="lr-body"><PracticeBox kind={lesson.practice} /></div>}
  </div>
}

/** The "নির্দেশনা" button on every accounts section: the lesson in a dialog, without leaving the page. */
export function LearnButton({ module, label = 'নির্দেশনা' }: { module: ModuleKey; label?: string }) {
  const [open, setOpen] = useState(false)
  const lesson = lessonOf(module)
  if (!lesson) return null
  return <>
    <button type="button" className="lr-btn no-print" onClick={() => setOpen(true)} aria-label={`${lesson.title} — বাংলা নির্দেশনা`}><Icon name="book" size={15} />{label}</button>
    {open && <Modal wide title={`${lesson.title} — বাংলা নির্দেশনা`} onClose={() => setOpen(false)}
      actions={<><Link className="btn-ghost" to={`/app/accounts/learn?m=${lesson.key}`} onClick={() => setOpen(false)}>শেখার কেন্দ্রে খুলুন</Link>
        <button type="button" onClick={() => setOpen(false)}>বন্ধ করুন</button></>}>
      <LessonView lesson={lesson} />
    </Modal>}
  </>
}

export const lessonsForGrid = LESSONS
export { OFFICIAL_NOTE }
