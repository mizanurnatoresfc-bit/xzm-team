// সব নোটিফিকেশন: everything that reached the person, newest first, grouped by day; unread / kind filters,
// mark all read, tap to open. New ones appear by themselves (the shared live store).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { usePrefs } from '../lib/prefs'
import { kindOf, markAllRead, markRead, NOTICE_KIND, noticePage, useNotices, type Notice } from '../lib/notices'

const PAGE = 40
const dayKey = (t: string) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })

export function Notifications() {
  const { L, n, lang } = usePrefs()
  const nav = useNavigate()
  const nt = useNotices()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [kind, setKind] = useState<string | null>(null)
  const [rows, setRows] = useState<Notice[]>([])
  const [more, setMore] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function load(reset: boolean) {
    setBusy(true); setErr('')
    try {
      const got = await noticePage(reset ? 0 : rows.length, PAGE, unreadOnly, kind)
      setRows(r => reset ? got : [...r, ...got.filter(x => !r.some(y => y.id === x.id))]); setMore(got.length === PAGE)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  // reload when the filters change, or when something new arrives / is read elsewhere
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(true) }, [unreadOnly, kind, nt.list[0]?.id, nt.unread])

  const today = dayKey(new Date().toISOString())
  const yesterday = dayKey(new Date(Date.now() - 864e5).toISOString())
  const dayLabel = (k: string) => k === today ? L('আজ', 'Today') : k === yesterday ? L('গতকাল', 'Yesterday')
    : new Date(k + 'T00:00:00').toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const groups: Array<[string, Notice[]]> = []
  for (const x of rows) { const k = dayKey(x.created_at); const g = groups.find(y => y[0] === k); if (g) g[1].push(x); else groups.push([k, [x]]) }
  const time = (t: string) => new Date(t).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })
  const kinds = Object.keys(NOTICE_KIND)

  function open(x: Notice) {
    void markRead([x.id]); setRows(r => r.map(y => y.id === x.id ? { ...y, read_at: y.read_at ?? new Date().toISOString() } : y))
    if (x.link) nav(x.link)
  }

  return <AppShell title={L('নোটিফিকেশন', 'Notifications')} subtitle={nt.unread ? L(`${n(nt.unread)}টা এখনো পড়া হয়নি`, `${nt.unread} unread`) : L('সব পড়া হয়েছে', 'All read')}>
    <section className="panel nf-bar">
      <div className="rp-seg"><button type="button" className={!unreadOnly ? 'on' : ''} onClick={() => setUnreadOnly(false)}>{L('সব', 'All')}</button>
        <button type="button" className={unreadOnly ? 'on' : ''} onClick={() => setUnreadOnly(true)}>{L('না-পড়া', 'Unread')}{nt.unread > 0 && <b className="nf-n">{n(nt.unread)}</b>}</button></div>
      {nt.live && <span className="nf-live on">{L('লাইভ', 'Live')}</span>}
      <span className="spacer" />
      {nt.unread > 0 && <button type="button" className="secondary sm" onClick={() => { void markAllRead(); setRows(r => r.map(y => ({ ...y, read_at: y.read_at ?? new Date().toISOString() }))) }}>
        <Icon name="checkall" size={15} />{L('সব পড়া হয়েছে', 'Mark all read')}</button>}
      <div className="nf-kinds">
        <button type="button" className={`nv-chip${!kind ? ' on' : ''}`} onClick={() => setKind(null)}>{L('সব ধরন', 'All kinds')}</button>
        {kinds.map(k => <button key={k} type="button" className={`nv-chip${kind === k ? ' on' : ''}`} onClick={() => setKind(kind === k ? null : k)}>
          <Icon name={NOTICE_KIND[k][2]} size={14} />{L(NOTICE_KIND[k][0], NOTICE_KIND[k][1])}</button>)}
      </div>
    </section>
    {err && <p className="da-error">{err}</p>}
    {!rows.length && !busy ? <section className="panel nf-empty"><span className="nf-big"><Icon name="bell" size={30} /></span>
      <b>{unreadOnly ? L('না-পড়া কিছু নেই', 'Nothing unread') : L('কোনো নোটিফিকেশন নেই', 'No notifications')}</b>
      <span className="muted small">{L('নতুন কিছু এলে এখানে আর উপরের ঘণ্টায় সাথে সাথে দেখাবে।', 'New ones appear here and on the bell at once.')}</span></section>
      : groups.map(([k, list]) => <section key={k} className="nf-day">
        <h3>{dayLabel(k)}</h3>
        <div className="nf-list">{list.map(x => { const kk = kindOf(x.kind)
          return <button key={x.id} type="button" className={`nf-item${x.read_at ? '' : ' new'}`} onClick={() => open(x)}>
            <span className={`nf-ic k-${x.kind ?? 'other'}`}><Icon name={kk[2]} size={18} /></span>
            <span className="nf-t"><b>{x.title}</b>{x.body && <span className="nf-b">{x.body}</span>}
              <span className="nf-m">{L(kk[0], kk[1])} · {time(x.created_at)}</span></span>
            {!x.read_at && <span className="nf-dot" aria-label={L('পড়া হয়নি', 'Unread')} />}
            {x.link && <Icon name="chev" size={16} />}
          </button> })}</div>
      </section>)}
    {more && rows.length > 0 && <div className="nf-more"><button type="button" className="secondary" disabled={busy} onClick={() => void load(false)}>{busy ? L('লোড হচ্ছে…', 'Loading…') : L('আরও দেখুন', 'Show more')}</button></div>}
  </AppShell>
}
