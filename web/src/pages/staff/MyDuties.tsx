import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { usePrefs } from '../../lib/prefs'
import { referrals } from '../../lib/extra'
import { hr } from '../../lib/hr'
import { dutiesApi, FREQ } from '../../lib/hub'
import { supabase } from '../../lib/supabase'
import { Badge, Field, useLoad, useToast } from '../accounts/ui'

/**
 * XZM-013 Phase 2B — কর্মীর দায়িত্ব প্যানেল।
 * Four tabs: today's duties (daily/weekly/monthly today-slot), submitted (tasks completed by this user today/this period),
 * pending (assigned tasks still open), and overdue (past due_date and not completed).
 * Reads go through my_duties RPC (post-level + personal) and the tasks table filtered by assignee = me. No backend change.
 */
type Tab = 'today' | 'submitted' | 'pending' | 'overdue'
type MyDuty = { id: string; title: string; details: string | null; frequency: string; source: 'person' | 'post' }
type TaskRow = {
  id: string; task_no: string | null; title: string; description: string | null; hub_id: string | null; assigned_to: string
  due_date: string; priority: string; status: string; progress_note: string | null; created_at: string
  completed_at?: string | null; submitted_at?: string | null
}
const todayDhaka = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const QUICK_LINKS: Array<[RegExp, string, string, string]> = [
  [/হাজির|attendance|check\s*in/i, '/app/staff/entry', 'হাজিরা দিন', 'Check in'],
  [/পিকআপ|pickup/i, '/app/hub/pickups', 'পিকআপ জমা', 'Submit pickup'],
  [/সর্টিং|sort/i, '/app/sorting', 'সর্টিং', 'Sorting'],
  [/রুট|route/i, '/app/routes', 'রুট প্ল্যান', 'Route plan'],
  [/হিসাব|accounts|cash|টাকা/i, '/app/accounts/mine', 'আমার হিসাব', 'My accounts'],
  [/সমস্যা|issue/i, '/app/issues', 'সমস্যা জানান', 'Report issue'],
]

export function MyDuties() {
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const [tab, setTab] = useState<Tab>('today')
  const [reason, setReason] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const meQ = useLoad(async () => { const id = await referrals.myEmployeeId(); return id ? await hr.employee(id) : null }, [])
  const me = meQ.data
  const duties = useLoad(() => me ? dutiesApi.mine(me.id).catch(() => [] as MyDuty[]) : Promise.resolve([] as MyDuty[]), [me?.id])
  const tasks = useLoad(async () => {
    if (!me) return [] as TaskRow[]
    const { data, error } = await supabase.from('tasks').select('id, task_no, title, description, hub_id, assigned_to, due_date, priority, status, progress_note, created_at, completed_at, submitted_at')
      .eq('assigned_to', me.id).order('due_date', { ascending: true }).limit(500)
    if (error) throw error
    return (data ?? []) as TaskRow[]
  }, [me?.id])

  const today = todayDhaka()
  const { pending, overdue, submitted } = useMemo(() => {
    const t = tasks.data ?? []
    return {
      pending: t.filter(r => r.status !== 'completed' && r.status !== 'cancelled' && r.due_date >= today),
      overdue: t.filter(r => (r.status === 'assigned' || r.status === 'in_progress') && r.due_date < today),
      submitted: t.filter(r => r.status === 'submitted' || r.status === 'completed'),
    }
  }, [tasks.data, today])

  const byFreq = (list: MyDuty[], freq: string) => list.filter(d => d.frequency === freq)
  const quickFor = (title: string) => QUICK_LINKS.find(([re]) => re.test(title))

  async function submitIncompleteReason(taskId: string) {
    const note = (reason[taskId] ?? '').trim()
    if (note.length < 3) return toast(L('কারণ লিখুন (৩+ অক্ষর)', 'Write a reason (3+ chars)'))
    setBusy(taskId)
    try {
      const { error } = await supabase.rpc('task_update_progress', { p_task: taskId, p_status: 'in_progress', p_note: note })
      if (error) throw error
      toast(L('কারণ জমা হয়েছে', 'Reason submitted'))
      setReason(r => ({ ...r, [taskId]: '' }))
      await tasks.reload()
    } catch (e) { toast((e as Error).message) } finally { setBusy(null) }
  }

  const tabs: Array<[Tab, string, string, string, number]> = [
    ['today', 'আজকের দায়িত্ব', "Today's duty", 'tasks', (duties.data?.length ?? 0)],
    ['submitted', 'সম্পন্ন', 'Submitted', 'check', submitted.length],
    ['pending', 'অসম্পূর্ণ', 'Pending', 'warn', pending.length],
    ['overdue', 'সময় অতিক্রম', 'Overdue', 'x', overdue.length],
  ]

  return <AppShell title={L('আমার দায়িত্ব', 'My duties')}
    subtitle={L('আজ কী করতে হবে, কী সম্পন্ন করেছি, কী বাকি আর কোনটার সময় চলে গেছে — সব এক জায়গায়।',
      "What I have to do today, what I've done, what is pending, and what has gone overdue — all in one place.")}>
    {node}
    <nav className="emp-tabs no-print" role="tablist">
      {tabs.map(([k, b, e, ic, ct]) =>
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
          <Icon name={ic} size={16} />{L(b, e)}{ct > 0 ? <span className="count-pill">{n(ct)}</span> : null}
        </button>)}
    </nav>

    {!me && meQ.loading && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
    {!me && !meQ.loading && <p className="da-error">{L('আপনার এমপ্লয়ি রেকর্ড পাওয়া যায়নি।', 'Your employee record was not found.')}</p>}

    {me && tab === 'today' && <section className="panel">
      {duties.loading && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
      {duties.data && !duties.data.length && <p className="muted">{L('আপনার জন্য কোনো দায়িত্ব এখনো লেখা হয়নি।', 'No duty has been written for you yet.')}</p>}
      {duties.data && duties.data.length > 0 && Object.keys(FREQ).map(freq => {
        const rows = byFreq(duties.data as MyDuty[], freq)
        if (!rows.length) return null
        return <div key={freq} className="duty-block">
          <h3>{L(FREQ[freq][0], FREQ[freq][1])} <span className="count-pill">{n(rows.length)}</span></h3>
          <ul className="duty-list">
            {rows.map(d => {
              const q = quickFor(d.title)
              return <li key={d.id} className="duty">
                <span className="duty-ic"><Icon name="tasks" size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{d.title}</b> {d.source === 'person'
                    ? <Badge tone="info">{L('আমার জন্য', 'For me')}</Badge>
                    : <Badge tone="neutral">{L('পদের দায়িত্ব', 'Of the post')}</Badge>}
                  {d.details && <div className="muted small pre-wrap">{d.details}</div>}
                </div>
                {q && <Link className="secondary sm btn-ghost" to={q[1]}><Icon name="arrow-right" size={14} />{L(q[2], q[3])}</Link>}
              </li>
            })}
          </ul>
        </div>
      })}
    </section>}

    {me && tab === 'submitted' && <section className="panel">
      {!submitted.length ? <p className="muted">{L('এই সময়ে সম্পন্ন কোনো দায়িত্ব নেই।', 'No completed duty in this period.')}</p>
        : <ul className="duty-list">{submitted.map(t => <li key={t.id} className="duty">
            <span className="duty-ic"><Icon name="check" size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{t.title}</b> <Badge tone={t.status === 'completed' ? 'ok' : 'info'}>{t.status === 'completed' ? L('সম্পন্ন', 'Done') : L('জমা', 'Submitted')}</Badge>
              <div className="muted small">{L('শেষ তারিখ', 'Due')}: {t.due_date}{t.progress_note ? ` · ${t.progress_note}` : ''}</div>
            </div>
          </li>)}</ul>}
    </section>}

    {me && tab === 'pending' && <section className="panel">
      {!pending.length ? <p className="muted">{L('কোনো অসম্পূর্ণ দায়িত্ব নেই।', 'No pending duty.')}</p>
        : <ul className="duty-list">{pending.map(t => <li key={t.id} className="duty">
            <span className="duty-ic"><Icon name="warn" size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{t.title}</b> <Badge tone="warn">{L('অপেক্ষায়', 'Pending')}</Badge>
              <div className="muted small">{L('শেষ তারিখ', 'Due')}: {t.due_date}</div>
            </div>
          </li>)}</ul>}
    </section>}

    {me && tab === 'overdue' && <section className="panel">
      {!overdue.length ? <p className="muted">{L('সময় অতিক্রম করা কোনো দায়িত্ব নেই।', 'No overdue duty.')}</p>
        : <ul className="duty-list">{overdue.map(t => <li key={t.id} className="duty" style={{ flexWrap: 'wrap' }}>
            <span className="duty-ic"><Icon name="x" size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{t.title}</b> <Badge tone="bad">{L('সময় শেষ', 'Overdue')}</Badge>
              <div className="muted small">{L('শেষ তারিখ ছিল', 'Was due')}: {t.due_date}</div>
            </div>
            <div style={{ width: '100%', display: 'flex', gap: 6, marginTop: 6 }}>
              <Field label={L('অসম্পূর্ণ হওয়ার কারণ', 'Reason for not completing')}>
                <input value={reason[t.id] ?? ''} onChange={e => setReason(r => ({ ...r, [t.id]: e.target.value }))}
                  placeholder={L('সংক্ষেপে কারণ লিখুন', 'Briefly, why')} />
              </Field>
              <button disabled={busy === t.id} onClick={() => void submitIncompleteReason(t.id)}>
                <Icon name="send" size={14} />{L('জমা', 'Submit')}
              </button>
            </div>
          </li>)}</ul>}
    </section>}
  </AppShell>
}
