import { scrollBehavior } from '../lib/a11y'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { NodiAvatar } from '../components/NodiAvatar'
import { GROUPS, GUIDES, askGuides, type Guide, type GuideGroup } from '../lib/guides'

const KEY = 'xzm_training_done'
const readDone = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }

/** Training Centre: a short lesson for every job in the system, only the ones this person's role can do, with Nodi to ask. */
export function Training() {
  const { can } = useAuth()
  const mine = useMemo(() => GUIDES.filter(g => !g.perms || g.perms.some(p => can(p))), [can])
  const [done, setDone] = useState<string[]>(readDone)
  const [open, setOpen] = useState<string | null>(null)
  const [group, setGroup] = useState<GuideGroup | ''>('')
  const [q, setQ] = useState('')
  const answers = useMemo(() => askGuides(q, mine), [q, mine])
  const shown = mine.filter(g => !group || g.group === group)
  const groups = (Object.keys(GROUPS) as GuideGroup[]).filter(k => mine.some(g => g.group === k))
  const learned = mine.filter(g => done.includes(g.id)).length
  const mark = (id: string, on: boolean) => setDone(d => { const n = on ? [...new Set([...d, id])] : d.filter(x => x !== id); try { localStorage.setItem(KEY, JSON.stringify(n)) } catch { /* private mode */ } return n })
  const lesson = (g: Guide) => <article key={g.id} id={`g-${g.id}`} className={`tr-card${open === g.id ? ' open' : ''}${done.includes(g.id) ? ' done' : ''}`}>
    <button type="button" className="tr-head" aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
      <span className="tr-tick" aria-hidden="true">{done.includes(g.id) ? '✓' : ''}</span>
      <span className="tr-title"><b>{g.title}</b><small>{g.summary}</small></span><Icon name="chev" size={16} /></button>
    {open === g.id && <div className="tr-body">
      <ol>{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {g.tips && <ul className="tr-tips">{g.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>}
      <div className="row-acts"><Link to={g.to} className="btn-ghost sm">পাতাটা খুলুন →</Link>
        <button type="button" className={done.includes(g.id) ? 'secondary sm' : 'sm'} onClick={() => mark(g.id, !done.includes(g.id))}>{done.includes(g.id) ? 'আবার শিখব' : 'শিখেছি ✓'}</button></div>
    </div>}
  </article>

  return <AppShell title="ট্রেনিং সেন্টার" subtitle="প্রতিটা কাজ ধাপে ধাপে। আপনার রোলে যে কাজগুলো আছে শুধু সেগুলোই এখানে দেখাচ্ছে।">
    <section className="panel tr-ask">
      <div className="tr-ask-head"><NodiAvatar size={44} /><div><b>নদীকে জিজ্ঞেস করুন</b><div className="muted small">কী করতে চান লিখুন — নদী ঠিক পাঠটা বের করে দেবে</div></div></div>
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="যেমন: ছুটির আবেদন কীভাবে দেব? / পাসওয়ার্ড ভুলে গেছি" aria-label="নদীকে জিজ্ঞেস করুন" />
      {q.trim().length >= 2 && (answers.length ? <div className="tr-answers" role="status">{answers.map(g => <button key={g.id} type="button" className="tr-answer" onClick={() => { setGroup(''); setOpen(g.id); setQ(''); window.setTimeout(() => document.getElementById(`g-${g.id}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }), 50) }}>
          <b>{g.title}</b><span>{g.steps[0]}</span></button>)}</div>
        : <p className="muted small" role="status">এই নিয়ে কোনো পাঠ পাইনি। অন্য শব্দে লিখে দেখুন, অথবা আপনার ম্যানেজারকে জিজ্ঞেস করুন।</p>)}
    </section>
    <section className="panel">
      <div className="tr-progress"><span><b>{learned.toLocaleString('bn-BD')} / {mine.length.toLocaleString('bn-BD')}</b> পাঠ শিখেছেন</span>
        <span className="bl-bar" role="progressbar" aria-label="শেখার অগ্রগতি" aria-valuemin={0} aria-valuemax={mine.length} aria-valuenow={learned}><span style={{ width: `${mine.length ? (learned / mine.length) * 100 : 0}%` }} /></span></div>
      <div className="tr-groups" role="group" aria-label="ভাগ">
        <button type="button" className={`chip-toggle${group === '' ? ' on' : ''}`} aria-pressed={group === ''} onClick={() => setGroup('')}>সব <b>{mine.length.toLocaleString('bn-BD')}</b></button>
        {groups.map(k => <button key={k} type="button" className={`chip-toggle${group === k ? ' on' : ''}`} aria-pressed={group === k} onClick={() => setGroup(k)}>{GROUPS[k]} <b>{mine.filter(g => g.group === k).length.toLocaleString('bn-BD')}</b></button>)}
      </div>
      <div className="tr-list">{shown.map(lesson)}</div>
      <p className="muted small">“শিখেছি” চিহ্ন শুধু এই ডিভাইসে মনে থাকে।</p>
    </section>
  </AppShell>
}
