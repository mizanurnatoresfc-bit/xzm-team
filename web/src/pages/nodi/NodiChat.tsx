import { scrollBehavior } from '../../lib/a11y'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { NodiAvatar } from '../../components/NodiAvatar'
import { nodi, type ChatMsg, type NodiAction } from '../../lib/nodi'
import { useNodiFeatures } from '../../lib/useNodiFeatures'
import { panelLevel } from '../../lib/menu'
import { usePrefs } from '../../lib/prefs'
import { useAuth } from '../../auth/AuthProvider'

type Turn = ChatMsg & { actions?: NodiAction[]; error?: boolean }
type SR = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null }
const Recog = (typeof window !== 'undefined' ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) : null) as (new () => SR) | null
const TOOL_BN: Record<string, string> = { create_issue: 'ইস্যু তৈরি', issue_action: 'ইস্যুতে কাজ', post_to_hub: 'গ্রুপে বার্তা', my_issues: 'আমার ইস্যু দেখা', list_hubs: 'হাব তালিকা' }
const HINTS = ['আমার কাজগুলো কী কী?', 'পার্সেল SF-90001-এর ইস্যু নাতোর হাবে খোলো', 'IS-00003 অনুমোদন করো আর IS-00004 শুরু করো', 'নাতোর হাবের গ্রুপে লিখো: আজ সবাই সময়মতো আসবেন']

export function NodiChat() {
  const { can } = useAuth()
  const { nodiFab, setNodiFab } = usePrefs()
  const hasFab = panelLevel(can) === 2 // the floating button is shown at this level only (AppShell)
  const [turns, setTurns] = useState<Turn[]>([{ role: 'assistant', content: 'আমি নদী। কাজ, ইস্যু বা হাবের বিষয়ে বলুন — লিখে বা মাইকে বলে। একসাথে কয়েকটা কাজও দিতে পারেন।' }])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [speak, setSpeak] = useState(() => { try { return localStorage.getItem('nodi_speak') === '1' } catch { return false } })
  const [talking, setTalking] = useState(false)
  const rec = useRef<SR | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: scrollBehavior() }) }, [turns, busy])
  useEffect(() => () => { rec.current?.stop(); window.speechSynthesis?.cancel() }, [])
  const feats = useNodiFeatures()

  function say(t: string) {
    if (!speak || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(t); u.lang = 'bn-BD'
    u.onstart = () => setTalking(true); u.onend = () => setTalking(false); u.onerror = () => setTalking(false)
    window.speechSynthesis.speak(u)
  }
  function mic() {
    if (!Recog) return
    if (listening) { rec.current?.stop(); return }
    window.speechSynthesis?.cancel()
    const r = new Recog(); r.lang = 'bn-BD'; r.interimResults = true; r.continuous = false
    r.onresult = e => { setText(Array.from(e.results).map(x => x[0].transcript).join(' ')) }
    r.onend = () => setListening(false); r.onerror = () => setListening(false)
    rec.current = r; setListening(true); r.start()
  }
  async function send(t = text) {
    const q = t.trim(); if (!q || busy) return
    const next: Turn[] = [...turns, { role: 'user', content: q }]
    setTurns(next); setText(''); setBusy(true)
    try {
      const r = await nodi.chat(next.filter((x, i) => !(i === 0 && x.role === 'assistant') && !x.error).map(x => ({ role: x.role, content: x.content })))
      setTurns(ts => [...ts, { role: 'assistant', content: r.text || 'হয়েছে।', actions: r.actions }]); say(r.text)
    } catch (e) { setTurns(ts => [...ts, { role: 'assistant', content: e instanceof Error ? e.message : 'কিছু একটা গোলমাল হয়েছে', error: true }]) }
    finally { setBusy(false) }
  }
  const toggleSpeak = () => { const v = !speak; setSpeak(v); try { localStorage.setItem('nodi_speak', v ? '1' : '0') } catch { /* ignore */ } if (!v) window.speechSynthesis?.cancel() }

  if (feats && !feats.chat) return <AppShell title="নদী AI" subtitle="জোনাল অ্যাসিস্ট্যান্ট">
    <section className="panel"><p className="notice" role="status">নদী AI চ্যাট এখন বন্ধ আছে। অ্যাডমিন “নদী AI সেটিংস” থেকে চালু করতে পারেন।</p>
      <p><Link className="btn" to="/app">হোমে যান</Link></p></section></AppShell>
  return <AppShell title="নদী AI" subtitle="জোনাল অ্যাসিস্ট্যান্ট — বলুন বা লিখুন">
    <div className="nodi-chat">
      <div className="nodi-top"><NodiAvatar size={56} talking={talking || busy} listening={listening} />
        <div><strong>নদী</strong><div className="muted" style={{ fontSize: 12 }}>{listening ? 'শুনছি…' : busy ? 'ভাবছি…' : 'প্রস্তুত'}</div></div>
        <div className="nodi-top-btns">
          {hasFab && <button type="button" className="secondary" aria-pressed={nodiFab} onClick={() => setNodiFab(!nodiFab)}
            title="অন্য পাতার কোণায় ভাসমান নদী বোতাম দেখানো বা লুকানো (এই ডিভাইসে)">{nodiFab ? '🟢 স্ক্রিনে বোতাম চালু' : '⚪ স্ক্রিনে বোতাম বন্ধ'}</button>}
          <button type="button" className="secondary" onClick={toggleSpeak} title="উত্তর জোরে পড়ে শোনানো">{speak ? '🔊 কণ্ঠ চালু' : '🔇 কণ্ঠ বন্ধ'}</button></div></div>
      <div className="nodi-log">{turns.map((t, i) => <div key={i} className={`nodi-msg ${t.role}${t.error ? ' err' : ''}`}>
        {t.role === 'assistant' && <NodiAvatar size={28} />}
        <div className="bub">{t.content}
          {t.actions && t.actions.length > 0 && <div className="acts">{t.actions.map((a, k) => {
            const bad = typeof a.result === 'object' && a.result !== null && 'error' in (a.result as object)
            return <span key={k} className={`chip${bad ? ' bad' : ''}`}>{bad ? '✕' : '✓'} {TOOL_BN[a.tool] ?? a.tool}</span> })}
            {t.actions.some(a => a.tool === 'create_issue' || a.tool === 'issue_action') && <Link to="/app/issues" className="chip">ইস্যু পেজ →</Link>}</div>}
        </div></div>)}
        {busy && <div className="nodi-msg assistant"><NodiAvatar size={28} talking /><div className="bub">…</div></div>}
        <div ref={end} /></div>
      {turns.length < 2 && <div className="nodi-hints">{HINTS.map(h => <button key={h} type="button" className="secondary" onClick={() => setText(h)}>{h}</button>)}</div>}
      <div className="nodi-in">
        <textarea rows={2} placeholder={listening ? 'বলুন…' : 'নদীকে লিখুন বা মাইকে বলুন…'} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} />
        <div className="row">
          {Recog ? <button type="button" className={listening ? '' : 'secondary'} onClick={mic} aria-label="মাইক">{listening ? '⏹ থামুন' : '🎤 বলুন'}</button> : <span className="muted" style={{ fontSize: 12 }}>এই ব্রাউজারে কণ্ঠ-ইনপুট নেই</span>}
          <button type="button" disabled={busy || !text.trim()} onClick={() => void send()} style={{ marginLeft: 'auto' }}><Icon name="check" size={16} /> পাঠান</button></div>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>কণ্ঠে বললে পাঠানোর আগে লেখাটা দেখে নিন। নদী শুধু তাই করতে পারে যা আপনি নিজে অ্যাপে পারতেন।</p>
      </div></div>
  </AppShell>
}
