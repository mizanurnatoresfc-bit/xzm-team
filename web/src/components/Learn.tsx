// হিসাব শেখা — one lesson on screen (six parts + practice + ask the AI), the instruction button every accounts
// section carries, the official-rules box, and the "নদী AI হিসাব শিক্ষক" chat.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { LESSONS, OFFICIAL_NOTE, allLessonsText, lessonOf, lessonText, type Lesson, type ModuleKey } from '../lib/accountsGuide'
import { da } from '../lib/dailyAccounts'
import { nodi, type ChatMsg } from '../lib/nodi'
import { useNodiFeatures } from '../lib/useNodiFeatures'
import { ErrorNote, Modal, useLoad } from '../pages/accounts/ui'
import { Icon } from './Icon'
import { PracticeBox } from './Practice'

type Part = 'how' | 'steps' | 'sample' | 'docs' | 'mistakes' | 'practice' | 'ask'
const PARTS: Array<[Part, string]> = [['how', 'কীভাবে কাজ করবেন?'], ['steps', 'ধাপে ধাপে নির্দেশনা'], ['sample', 'নমুনা হিসাব'],
  ['docs', 'প্রয়োজনীয় কাগজপত্র'], ['mistakes', 'সাধারণ ভুল'], ['practice', 'অনুশীলন'], ['ask', 'AI-কে প্রশ্ন করুন']]

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
      <textarea rows={5} value={edit} onChange={e => setEdit(e.target.value)} placeholder="SteadFast-এর অফিশিয়াল নিয়ম যেভাবে আছে হুবহু লিখুন — নদী AI এটাকেই অফিশিয়াল ধরবে।" />
      <ErrorNote error={err} />
      <div className="row"><button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'হচ্ছে…' : 'সংরক্ষণ'}</button><button type="button" className="secondary" onClick={() => setEdit(null)}>বাতিল</button></div>
    </> : text ? <p className="lr-pre">{text}</p>
      : <p className="muted small">হেড অফিস এখনো এই অংশের অফিশিয়াল নিয়ম লিখে দেয়নি। নিচের সব নির্দেশনা এই সিস্টেমের নিজস্ব — অফিশিয়াল নিয়ম হেড অফিসের কাছ থেকে নিশ্চিত হোন।</p>}
  </div>
}

/** One lesson: the six parts, practice and the AI teacher. */
export function LessonView({ lesson, start }: { lesson: Lesson; start?: Part }) {
  const parts = PARTS.filter(([p]) => p !== 'practice' || lesson.practice)
  const [part, setPart] = useState<Part>(start ?? 'how')
  useEffect(() => { setPart(start ?? 'how') }, [lesson.key, start])
  return <div className="lr-lesson" data-lesson={lesson.key}>
    <p className="lr-what">{lesson.what}{lesson.where && <> · <Link to={lesson.where.to}>{lesson.where.label} →</Link></>}</p>
    <OfficialBox module={lesson.key} />
    <div className="lr-src internal"><Icon name="book" size={16} /><b>নদী AI-র অভ্যন্তরীণ নির্দেশনা</b><span className="muted small">— এই সিস্টেম কীভাবে কাজ করে</span></div>
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
    {part === 'ask' && <div className="lr-body"><Teacher lesson={lesson} /></div>}
  </div>
}

/** নদী AI হিসাব শিক্ষক — answers from the official rules and this guide only. */
export function Teacher({ lesson }: { lesson: Lesson | null }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [msgs, busy])
  const feats = useNodiFeatures()
  if (feats && !feats.teach) return <p className="notice small" role="status">নদী AI হিসাব শিক্ষক এখন বন্ধ আছে — পাঠগুলো পড়ে নিন, বা অ্যাডমিনকে চালু করতে বলুন।</p>
  async function ask(text: string) {
    const t = text.trim(); if (!t || busy) return
    const next = [...msgs, { role: 'user' as const, content: t }]
    setMsgs(next); setQ(''); setBusy(true); setErr(null)
    try {
      const r = await nodi.teach(next, lesson?.key ?? 'general', lesson?.title ?? 'সাধারণ প্রশ্ন', lesson ? lessonText(lesson) : allLessonsText())
      setMsgs([...next, { role: 'assistant', content: r.text || 'উত্তর পাওয়া যায়নি।' }])
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setMsgs(msgs) ; setQ(t) } finally { setBusy(false) }
  }
  return <div className="lr-teacher">
    <div className="lr-t-head"><span className="lr-t-av"><Icon name="book" size={18} /></span><div><b>নদী AI হিসাব শিক্ষক</b>
      <small>বাংলায় প্রশ্ন করুন। উত্তর আসে শুধু হেড অফিসের অফিশিয়াল নিয়ম আর এই সিস্টেমের নির্দেশনা থেকে — না জানলে বলে দেবে, বানাবে না।</small></div></div>
    <div className="lr-t-msgs" aria-live="polite">
      {!msgs.length && <div className="lr-t-sugg">{(lesson?.ask ?? ['দৈনিক হিসাব কোন ক্রমে করব?', 'বিল না থাকলে খরচ কীভাবে লিখব?', 'ব্যাংক স্লিপ NOT MATCH হলে কী করব?']).map(s =>
        <button key={s} type="button" className="secondary sm" onClick={() => void ask(s)}>{s}</button>)}</div>}
      {msgs.map((m, i) => <div key={i} className={`lr-t-msg ${m.role}`}>{m.content}</div>)}
      {busy && <div className="lr-t-msg assistant muted">লিখছে…</div>}
      <div ref={end} />
    </div>
    {err && <p className="da-error">{err}</p>}
    <form className="lr-t-ask" onSubmit={e => { e.preventDefault(); void ask(q) }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={lesson ? `${lesson.title} নিয়ে প্রশ্ন লিখুন…` : 'হিসাব নিয়ে প্রশ্ন লিখুন…'} aria-label="প্রশ্ন" />
      <button type="submit" disabled={busy || !q.trim()}><Icon name="play" size={16} />পাঠান</button>
    </form>
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
