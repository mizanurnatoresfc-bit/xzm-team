// বাংলা শেখার কেন্দ্র — every accounts lesson in one place, with practice and the AI teacher.
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { LessonView, OfficialBox, Teacher } from '../../components/Learn'
import { LESSONS, OFFICIAL_NOTE, lessonOf } from '../../lib/accountsGuide'
import { AccountsShell } from './ui'

export function LearnCenter() {
  const [sp, setSp] = useSearchParams()
  const lesson = lessonOf(sp.get('m'))
  const part = sp.get('p') === 'practice' ? 'practice' : sp.get('p') === 'ask' ? 'ask' : undefined
  const open = (k: string | null, p?: string) => { const n = new URLSearchParams(); if (k) n.set('m', k); if (p) n.set('p', p); setSp(n); window.scrollTo({ top: 0 }) }

  return <AccountsShell title={lesson ? lesson.title : part === 'practice' ? 'অনুশীলন (নমুনা হিসাব)' : part === 'ask' ? 'নদী AI হিসাব শিক্ষক' : 'হিসাব শেখার কেন্দ্র'}
    subtitle={lesson ? 'বাংলা নির্দেশনা · নমুনা · অনুশীলন · AI শিক্ষক' : 'SteadFast হাবের হিসাব — ধাপে ধাপে বাংলায় শিখুন'}
    actions={<Link className="btn-ghost" to="/app/accounts/center">হিসাব কেন্দ্র →</Link>}>
    <div className="lr">
      {lesson ? <>
        <button type="button" className="secondary sm lr-back" onClick={() => open(null)}><Icon name="back" size={15} />সব বিষয়</button>
        <section className="panel"><LessonView lesson={lesson} start={part} /></section>
        <nav className="lr-next">{(() => { const i = LESSONS.findIndex(l => l.key === lesson.key); const prev = LESSONS[i - 1], next = LESSONS[i + 1]
          return <>{prev ? <button type="button" className="secondary" onClick={() => open(prev.key)}>← {prev.title}</button> : <span />}
            {next && <button type="button" className="secondary" onClick={() => open(next.key)}>{next.title} →</button>}</> })()}</nav>
      </> : part === 'practice' ? <>
        <p className="notice lr-note">অনুশীলন মোড — নমুনা তথ্য দিয়ে শিখুন, আসল হিসাবে কিছু সেভ হয় না। একটা বিষয় বাছুন।</p>
        <div className="lr-grid">{LESSONS.filter(l => l.practice).map(l => <button key={l.key} type="button" className="lr-card" data-module={l.key} onClick={() => open(l.key, 'practice')}>
          <span className="lr-ic"><Icon name={l.icon} size={22} /></span><span className="tx"><b>{l.title}</b><span>{l.what}</span></span><span className="lr-tag">অনুশীলন</span></button>)}</div>
      </> : part === 'ask' ? <>
        <p className="notice lr-note">{OFFICIAL_NOTE}</p>
        <section className="panel"><Teacher lesson={null} /></section>
      </> : <>
        <p className="notice lr-note">{OFFICIAL_NOTE}</p>
        <section className="panel"><OfficialBox module="general" /></section>
        <h2 className="sd-h">বিষয় বাছুন</h2>
        <div className="lr-grid">{LESSONS.map((l, i) => <button key={l.key} type="button" className="lr-card" data-module={l.key} onClick={() => open(l.key)}>
          <span className="lr-ic"><Icon name={l.icon} size={22} /></span>
          <span className="tx"><small>{(i + 1).toLocaleString('bn-BD')}</small><b>{l.title}</b><span>{l.what}</span></span>
          {l.practice && <span className="lr-tag">অনুশীলন আছে</span>}
        </button>)}</div>
        <h2 className="sd-h">AI-কে প্রশ্ন করুন</h2>
        <section className="panel"><Teacher lesson={null} /></section>
      </>}
    </div>
  </AccountsShell>
}
