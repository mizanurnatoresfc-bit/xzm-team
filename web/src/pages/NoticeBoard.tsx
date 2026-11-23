// নোটিশ বোর্ড · রিমাইন্ডার · আমার রিপোর্টিং লাইন.
// Every rule (who may publish where, who sees what, reminders only for oneself) is in the database; this page only calls the functions.
import { askConfirm } from '../components/ask'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { usePrefs } from '../lib/prefs'
import { supabase } from '../lib/supabase'
import { Badge, ErrorNote, Field, Modal, useLoad, useToast } from './accounts/ui'

type Prio = 'low' | 'normal' | 'high' | 'urgent'
type Notice = { id: string; notice_no: string; title: string; body: string; audience: 'all' | 'zone' | 'hub'; zone_name: string | null; hub_name: string | null
  priority: Prio; pinned: boolean; requires_read: boolean; expires_at: string | null; author_name: string; created_at: string; seen: boolean; readers: number | null; can_manage: boolean }
type Reminder = { id: string; title: string; note: string | null; remind_at: string; repeat: 'none' | 'daily' | 'weekly' | 'monthly'; priority: Prio; link: string | null; done_at: string | null }
type Boss = { level: number; employee_id: string; name: string; post: string | null; hub_name: string | null; mobile: string | null }
type Tab = 'board' | 'reminders' | 'line'

const PRIO: Record<Prio, [string, string, 'neutral' | 'info' | 'warn' | 'bad']> = {
  low: ['কম জরুরি', 'Low', 'neutral'], normal: ['সাধারণ', 'Normal', 'info'], high: ['জরুরি', 'High', 'warn'], urgent: ['অতি জরুরি', 'Urgent', 'bad'] }
const rpc = async <T,>(fn: string, args?: Record<string, unknown>) => { const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return data as T }
const dt = (t: string, lang: string) => new Date(t).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
/** "2026-11-20T10:30" typed in Dhaka time → an ISO instant. */
const fromLocal = (v: string) => v ? new Date(v + ':00+06:00').toISOString() : null

export function NoticeBoard() {
  const { L, lang } = usePrefs()
  const { can } = useAuth()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'board'
  const setTab = (t: Tab) => setSp(t === 'board' ? {} : { tab: t }, { replace: true })
  const { toast, node } = useToast()
  const canPublish = can('notice.board.create')
  const [err, setErr] = useState<unknown>(null)

  const notices = useLoad(() => rpc<Notice[]>('notice_list', { p_limit: 100 }), [])
  const reminders = useLoad(() => rpc<Reminder[]>('reminder_list', { p_include_done: true }), [])
  const line = useLoad(() => rpc<Boss[]>('my_report_line'), [])
  const [pub, setPub] = useState(false)
  const [rem, setRem] = useState(false)
  const act = async (f: () => Promise<unknown>, ok: string, reload: Array<{ reload: () => void }>) => {
    setErr(null); try { await f(); toast(ok); reload.forEach(r => r.reload()) } catch (e) { setErr(e) }
  }
  const unread = (notices.data ?? []).filter(x => x.requires_read && !x.seen).length

  return <AppShell title={L('নোটিশ বোর্ড ও রিমাইন্ডার', 'Notice board & reminders')} subtitle={L('অফিশিয়াল নোটিশ, নিজের রিমাইন্ডার, আর কে কাকে রিপোর্ট করে', 'Official notices, your own reminders, and who reports to whom')}>
    {node}
    <div className="nv-chips" role="tablist">
      {([['board', 'নোটিশ বোর্ড', 'Notice board', 'bell'], ['reminders', 'আমার রিমাইন্ডার', 'My reminders', 'clock'], ['line', 'আমার রিপোর্টিং লাইন', 'My reporting line', 'users']] as const).map(([k, bn, en, ic]) =>
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={`nv-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
          <Icon name={ic} size={15} />{L(bn, en)}{k === 'board' && unread > 0 && <b>{unread}</b>}</button>)}
    </div>
    <ErrorNote error={err} />

    {tab === 'board' && <section className="panel">
      {canPublish && <p><button type="button" onClick={() => setPub(true)}><Icon name="plus" size={16} />{L('নতুন নোটিশ দিন', 'Publish a notice')}</button></p>}
      <ErrorNote error={notices.error} />
      {notices.loading && !notices.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : null}
      {notices.data && !notices.data.length && <p className="muted">{L('এখন কোনো নোটিশ নেই।', 'No notices right now.')}</p>}
      {(notices.data ?? []).map(n => <article key={n.id} className="panel" style={{ margin: '10px 0', borderLeft: n.priority === 'urgent' ? '4px solid var(--bad, #c0392b)' : n.priority === 'high' ? '4px solid var(--warn, #d68910)' : undefined }}>
        <h3 style={{ margin: 0 }}>{n.pinned ? '📌 ' : ''}{n.title}</h3>
        <p className="muted small" style={{ margin: '4px 0' }}>
          <Badge tone={PRIO[n.priority][2]}>{L(PRIO[n.priority][0], PRIO[n.priority][1])}</Badge>{' '}
          {n.audience === 'all' ? L('সবার জন্য', 'Everyone') : n.audience === 'zone' ? `${L('জোন', 'Zone')}: ${n.zone_name}` : `${L('হাব', 'Hub')}: ${n.hub_name}`}
          {' · '}{n.author_name} · {dt(n.created_at, lang)}{n.expires_at ? ` · ${L('মেয়াদ', 'until')} ${dt(n.expires_at, lang)}` : ''}</p>
        <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{n.body}</p>
        <div className="row-acts">
          {n.requires_read && (n.seen ? <Badge tone="ok">{L('পড়েছি ✓', 'Read ✓')}</Badge>
            : <button type="button" onClick={() => void act(() => rpc('notice_mark_read', { p_notice: n.id }), L('ধন্যবাদ', 'Thanks'), [notices])}>{L('পড়েছি', 'I have read this')}</button>)}
          {n.readers !== null && <span className="muted small">{L(`${n.readers} জন পড়েছেন`, `${n.readers} have read it`)}</span>}
          {n.can_manage && <button type="button" className="secondary sm" onClick={async () => { if (await askConfirm(L('নোটিশটি নামিয়ে নেবেন?', 'Take this notice down?'), { ok: L('নামান', 'Take down'), danger: true })) void act(() => rpc('notice_archive', { p_notice: n.id }), L('নামানো হয়েছে', 'Taken down'), [notices]) }}>{L('নামান', 'Take down')}</button>}
        </div>
      </article>)}
    </section>}

    {tab === 'reminders' && <section className="panel">
      <p><button type="button" onClick={() => setRem(true)}><Icon name="plus" size={16} />{L('নতুন রিমাইন্ডার', 'New reminder')}</button></p>
      <ErrorNote error={reminders.error} />
      {reminders.data && !reminders.data.length && <p className="muted">{L('কোনো রিমাইন্ডার নেই। সময় হলে ঘণ্টায় (আর ফোনে) জানানো হবে।', 'No reminders. You will be told in the bell (and on your phone) when it is time.')}</p>}
      {(reminders.data ?? []).map(r => <div key={r.id} className="panel" style={{ margin: '8px 0', opacity: r.done_at ? 0.6 : 1 }}>
        <b>⏰ {r.title}</b> <Badge tone={PRIO[r.priority][2]}>{L(PRIO[r.priority][0], PRIO[r.priority][1])}</Badge>
        <p className="muted small" style={{ margin: '4px 0' }}>{dt(r.remind_at, lang)}{r.repeat !== 'none' ? ` · ${{ daily: L('প্রতিদিন', 'daily'), weekly: L('প্রতি সপ্তাহে', 'weekly'), monthly: L('প্রতি মাসে', 'monthly') }[r.repeat]}` : ''}{r.done_at ? ` · ${L('শেষ', 'done')}` : ''}</p>
        {r.note && <p style={{ margin: '4px 0' }}>{r.note}</p>}
        <div className="row-acts">
          {!r.done_at && <button type="button" className="secondary sm" onClick={() => void act(() => rpc('reminder_done', { p_id: r.id }), L('শেষ করা হয়েছে', 'Marked done'), [reminders])}>{L('হয়ে গেছে', 'Done')}</button>}
          <button type="button" className="secondary sm" onClick={() => void act(() => rpc('reminder_remove', { p_id: r.id }), L('সরানো হয়েছে', 'Removed'), [reminders])}>{L('সরান', 'Remove')}</button>
        </div>
      </div>)}
    </section>}

    {tab === 'line' && <section className="panel">
      <p className="muted">{L('আপনার কাজ, ছুটি আর দেরি হলে এই লাইনের ওপরের জনকে জানানো হয়। বদলাতে চাইলে এইচআর-কে বলুন।', 'When work or leave is late, the people above you in this line are told. Ask HR to change it.')}</p>
      <ErrorNote error={line.error} />
      {line.data && !line.data.length && <p className="muted">{L('আপনার রিপোর্টিং ম্যানেজার এখনো ঠিক করা হয়নি।', 'No reporting manager has been set for you yet.')}</p>}
      {(line.data ?? []).map(b => <div key={b.employee_id} className="panel" style={{ margin: '8px 0' }}>
        <b>{b.level}. {b.name}</b><span className="muted small"> · {[b.post, b.hub_name].filter(Boolean).join(' · ')}</span>
        {b.mobile && <p style={{ margin: '4px 0' }}><a href={`tel:${b.mobile}`}>{b.mobile}</a></p>}
      </div>)}
    </section>}

    {pub && <PublishModal onClose={() => setPub(false)} onDone={() => { setPub(false); toast(L('নোটিশ দেওয়া হয়েছে', 'Notice published')); notices.reload() }} />}
    {rem && <ReminderModal onClose={() => setRem(false)} onDone={() => { setRem(false); toast(L('রিমাইন্ডার রাখা হয়েছে', 'Reminder saved')); reminders.reload() }} />}
  </AppShell>
}

function PublishModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { L } = usePrefs()
  const orgq = useLoad(async () => {
    const [z, h] = await Promise.all([supabase.from('zones').select('id,name').is('archived_at', null).order('name'), supabase.from('hubs').select('id,name,zone_id').is('archived_at', null).order('name')])
    return { zones: (z.data ?? []) as Array<{ id: string; name: string }>, hubs: (h.data ?? []) as Array<{ id: string; name: string; zone_id: string }> }
  }, [])
  const [f, setF] = useState({ title: '', body: '', audience: 'all', zone: '', hub: '', priority: 'normal', pinned: false, requires_read: false, expires: '' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null)
  const set = (k: string, v: unknown) => setF(x => ({ ...x, [k]: v }))
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      await rpc('notice_publish', { p_title: f.title, p_body: f.body, p_audience: f.audience, p_zone: f.audience === 'zone' ? f.zone || null : null, p_hub: f.audience === 'hub' ? f.hub || null : null,
        p_priority: f.priority, p_pinned: f.pinned, p_requires_read: f.requires_read, p_expires_at: fromLocal(f.expires) })
      onDone()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <Modal title={L('নতুন নোটিশ', 'New notice')} onClose={onClose} wide actions={<><button type="button" className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
    <button type="button" disabled={busy || f.title.trim().length < 2 || f.body.trim().length < 2} onClick={() => void save()}>{L('প্রকাশ করুন', 'Publish')}</button></>}>
    <ErrorNote error={err} />
    <Field label={L('শিরোনাম', 'Title')} required><input value={f.title} maxLength={160} onChange={e => set('title', e.target.value)} /></Field>
    <Field label={L('নোটিশ', 'Notice')} required><textarea rows={5} value={f.body} maxLength={4000} onChange={e => set('body', e.target.value)} /></Field>
    <Field label={L('কার জন্য', 'For')}><select value={f.audience} onChange={e => set('audience', e.target.value)}>
      <option value="all">{L('সবার জন্য', 'Everyone')}</option><option value="zone">{L('একটি জোন', 'One zone')}</option><option value="hub">{L('একটি হাব', 'One hub')}</option></select></Field>
    {f.audience === 'zone' && <Field label={L('জোন', 'Zone')} required><select value={f.zone} onChange={e => set('zone', e.target.value)}><option value="">—</option>{orgq.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
    {f.audience === 'hub' && <Field label={L('হাব', 'Hub')} required><select value={f.hub} onChange={e => set('hub', e.target.value)}><option value="">—</option>{orgq.data?.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>}
    <Field label={L('গুরুত্ব', 'Priority')}><select value={f.priority} onChange={e => set('priority', e.target.value)}>{(Object.keys(PRIO) as Prio[]).map(p => <option key={p} value={p}>{L(PRIO[p][0], PRIO[p][1])}</option>)}</select></Field>
    <Field label={L('মেয়াদ শেষ (ঢাকার সময়, ঐচ্ছিক)', 'Expires (Dhaka time, optional)')}><input type="datetime-local" value={f.expires} onChange={e => set('expires', e.target.value)} /></Field>
    <label className="chk"><input type="checkbox" checked={f.pinned} onChange={e => set('pinned', e.target.checked)} /> {L('ওপরে পিন করুন', 'Pin to the top')}</label>
    <label className="chk"><input type="checkbox" checked={f.requires_read} onChange={e => set('requires_read', e.target.checked)} /> {L('"পড়েছি" চাপা বাধ্যতামূলক (না চাপলে পরের দিন মনে করানো হবে)', 'Everyone must tap "I have read this" (reminded after a day)')}</label>
  </Modal>
}

function ReminderModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { L } = usePrefs()
  const [f, setF] = useState({ title: '', note: '', at: '', repeat: 'none', priority: 'normal' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null)
  const set = (k: string, v: string) => setF(x => ({ ...x, [k]: v }))
  const save = async () => {
    setBusy(true); setErr(null)
    try { await rpc('reminder_add', { p_title: f.title, p_remind_at: fromLocal(f.at), p_repeat: f.repeat, p_note: f.note || null, p_priority: f.priority }); onDone() }
    catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return <Modal title={L('নতুন রিমাইন্ডার', 'New reminder')} onClose={onClose} actions={<><button type="button" className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
    <button type="button" disabled={busy || f.title.trim().length < 2 || !f.at} onClick={() => void save()}>{L('রাখুন', 'Save')}</button></>}>
    <ErrorNote error={err} />
    <Field label={L('কী মনে করাবে', 'What to remember')} required><input value={f.title} maxLength={160} onChange={e => set('title', e.target.value)} /></Field>
    <Field label={L('কখন (ঢাকার সময়)', 'When (Dhaka time)')} required><input type="datetime-local" value={f.at} onChange={e => set('at', e.target.value)} /></Field>
    <Field label={L('পুনরাবৃত্তি', 'Repeat')}><select value={f.repeat} onChange={e => set('repeat', e.target.value)}>
      <option value="none">{L('একবার', 'Once')}</option><option value="daily">{L('প্রতিদিন', 'Daily')}</option><option value="weekly">{L('প্রতি সপ্তাহে', 'Weekly')}</option><option value="monthly">{L('প্রতি মাসে', 'Monthly')}</option></select></Field>
    <Field label={L('গুরুত্ব', 'Priority')}><select value={f.priority} onChange={e => set('priority', e.target.value)}>{(Object.keys(PRIO) as Prio[]).map(p => <option key={p} value={p}>{L(PRIO[p][0], PRIO[p][1])}</option>)}</select></Field>
    <Field label={L('নোট (ঐচ্ছিক)', 'Note (optional)')}><textarea rows={3} value={f.note} maxLength={1000} onChange={e => set('note', e.target.value)} /></Field>
  </Modal>
}
