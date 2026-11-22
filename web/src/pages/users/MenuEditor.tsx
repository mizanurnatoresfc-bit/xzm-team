import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { ACCOUNTS, ADMIN, AppShell, GROUPS, HOME, NEW_UNTIL, OFFICE, SORTING, type MenuGroup, type MenuItem } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { cleanLayout, EMPTY_LAYOUT, loadMenuLayout, saveMenuLayout, secKey, type ItemLayout, type MenuLayout } from '../../lib/menuLayout'

/** The panels in the order the sidebar shows them; the two home rows are a panel of their own here. */
const PANELS: MenuGroup[] = [
  { key: 'home', icon: 'dash', bn: 'উপরের সারি', en: 'Top rows', secs: [{ bn: '', en: '', items: HOME }], items: HOME },
  ACCOUNTS, OFFICE, SORTING, ...GROUPS, ADMIN,
]

/** Rows of one section in the saved order (hidden rows stay in the list so they can be shown again). */
const ordered = (items: MenuItem[], l: MenuLayout) => items.map((i, at) => ({ i, at, o: l.items[i.to] }))
  .sort((a, b) => (a.o?.order ?? a.at) - (b.o?.order ?? b.at) || a.at - b.at).map(x => x.i)

/**
 * সেটিং ও অনুমতি → মেনু এডিটর: rename, reorder and hide menu rows, rename panels and their headings, and set until when a row
 * shows "নতুন". Only what differs from the code is saved, so "আগের মতো" always brings back the original.
 * Who may open a page is not changed here — that stays with the role's permissions and page list.
 */
export function MenuEditor() {
  const { can } = useAuth()
  const { L } = usePrefs()
  const { toast, node } = useToast()
  const allowed = can('system.settings.configure')
  const [l, setL] = useState<MenuLayout | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  useEffect(() => { void loadMenuLayout(true).then(setL) }, [])

  if (!l) return <AppShell title={L('মেনু এডিটর', 'Menu editor')}><p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p></AppShell>

  const put = (next: MenuLayout) => { setL(next); setDirty(true) }
  const setItem = (to: string, patch: ItemLayout) => put({ ...l, items: { ...l.items, [to]: { ...l.items[to], ...patch } } })
  const named = (lang: 'bn' | 'en', v: string, dflt: string) => { const t = v === dflt ? '' : v; return lang === 'bn' ? { bn: t } : { en: t } }
  const setName = (part: 'groups' | 'secs', key: string, lang: 'bn' | 'en', v: string, dflt: string) => {
    const m = { ...l[part], [key]: { ...l[part][key], ...named(lang, v, dflt) } }
    put(part === 'groups' ? { ...l, groups: m } : { ...l, secs: m })
  }
  const itemName = (i: MenuItem, lang: 'bn' | 'en', v: string) => setItem(i.to, named(lang, v, i[lang]))
  function move(items: MenuItem[], from: number, by: -1 | 1) {
    const list = ordered(items, l!), to = from + by
    if (to < 0 || to >= list.length) return
    ;[list[from], list[to]] = [list[to], list[from]]
    const next = { ...l!.items }
    list.forEach((i, n) => { next[i.to] = { ...next[i.to], order: n } })
    put({ ...l!, items: next })
  }
  function resetItem(to: string) { const next = { ...l!.items }; delete next[to]; put({ ...l!, items: next }) }

  async function save() {
    setErr(''); setBusy(true)
    try { await saveMenuLayout(l!); setDirty(false); toast(L('সেভ হয়েছে — মেনুতে বসে গেছে', 'Saved — the menu now shows it')) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
  const changed = Object.keys(cleanLayout(l).items).length + Object.keys(cleanLayout(l).groups).length + Object.keys(cleanLayout(l).secs).length

  return <AppShell title={L('মেনু এডিটর', 'Menu editor')}
    subtitle={L('মেনুর নাম, ক্রম, লুকানো সারি আর “নতুন” ব্যাজ এখান থেকে বদলান — কোড ধরতে হবে না। কে কোন পাতা খুলতে পারবে তা আগের মতোই রোলের অনুমতি ঠিক করে।',
      'Change the menu’s names, order, hidden rows and “new” badges here, without touching the code. Who may open a page is still decided by the role’s permissions.')}
    actions={allowed ? <>
      <button className="secondary" disabled={busy || !changed} onClick={() => { if (window.confirm(L('সব বদল মুছে মেনু আগের মতো করবেন?', 'Undo every change and bring back the original menu?'))) put(EMPTY_LAYOUT) }}>{L('সব আগের মতো', 'Reset all')}</button>
      <button disabled={busy || !dirty} onClick={() => void save()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ করুন', 'Save')}</button></> : null}>
    {node}
    {!allowed && <p className="notice">{L('এই পাতা বদলানোর অনুমতি আপনার নেই।', 'You are not allowed to change this page.')}</p>}
    {err && <p className="da-error">{err}</p>}
    <p className="muted small">{L('নামের ঘর খালি রাখলে বা আগের নাম লিখলে কোডের নামটাই থাকে। “নতুন” তারিখ খালি রাখলে ব্যাজ দেখায় না; তারিখ পেরোলে ব্যাজ নিজেই সরে যায়।',
      'An empty name box, or the original name, keeps the name from the code. With no “new” date there is no badge; after the date the badge goes away by itself.')}</p>
    {PANELS.map(g => <section key={g.key} className="panel">
      {g.key === 'home' ? <h2>{L(g.bn, g.en)}</h2> : <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <label><span className="muted small">{L('প্যানেলের নাম (বাংলা)', 'Panel name (Bangla)')}</span>
          <input value={l.groups[g.key]?.bn || g.bn} maxLength={80} disabled={!allowed} onChange={e => setName('groups', g.key, 'bn', e.target.value, g.bn)} /></label>
        <label><span className="muted small">{L('প্যানেলের নাম (ইংরেজি)', 'Panel name (English)')}</span>
          <input value={l.groups[g.key]?.en || g.en} maxLength={80} disabled={!allowed} onChange={e => setName('groups', g.key, 'en', e.target.value, g.en)} /></label>
      </div>}
      {g.secs.map((x, n) => { const sk = secKey(g.key, n); const rows = ordered(x.items, l)
        return <div key={sk} style={{ marginTop: 14 }}>
          {x.bn && <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label><span className="muted small">{L('ভাগের নাম (বাংলা)', 'Heading (Bangla)')}</span>
              <input value={l.secs[sk]?.bn || x.bn} maxLength={80} disabled={!allowed} onChange={e => setName('secs', sk, 'bn', e.target.value, x.bn)} /></label>
            <label><span className="muted small">{L('ভাগের নাম (ইংরেজি)', 'Heading (English)')}</span>
              <input value={l.secs[sk]?.en || x.en} maxLength={80} disabled={!allowed} onChange={e => setName('secs', sk, 'en', e.target.value, x.en)} /></label>
          </div>}
          <div className="da-table-wrap"><table className="da-table">
            <thead><tr><th>{L('ক্রম', 'Order')}</th><th>{L('নাম (বাংলা)', 'Name (Bangla)')}</th><th>{L('নাম (ইংরেজি)', 'Name (English)')}</th>
              <th>{L('“নতুন” কবে পর্যন্ত', '“New” until')}</th><th>{L('দেখাবে', 'Shown')}</th><th /></tr></thead>
            <tbody>{rows.map((i, at) => { const o = l.items[i.to] ?? {}
              const nu = o.new_until !== undefined ? o.new_until ?? '' : NEW_UNTIL[i.to.split('?')[0]] ?? ''
              return <tr key={i.to} style={o.hide ? { opacity: .55 } : undefined}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="icon" disabled={!allowed || at === 0} aria-label={L('উপরে', 'Up')} onClick={() => move(x.items, at, -1)}>▲</button>
                  <button type="button" className="icon" disabled={!allowed || at === rows.length - 1} aria-label={L('নিচে', 'Down')} onClick={() => move(x.items, at, 1)}>▼</button></td>
                <td><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Icon name={i.icon} size={15} />
                  <input value={o.bn || i.bn} maxLength={80} disabled={!allowed} aria-label={L('নাম (বাংলা)', 'Name (Bangla)')} title={i.to} onChange={e => itemName(i, 'bn', e.target.value)} /></span></td>
                <td><input value={o.en || i.en} maxLength={80} disabled={!allowed} aria-label={L('নাম (ইংরেজি)', 'Name (English)')} onChange={e => itemName(i, 'en', e.target.value)} /></td>
                <td><input type="date" value={nu} min={today} disabled={!allowed} aria-label={L('“নতুন” ব্যাজ কবে পর্যন্ত', '“New” badge until')}
                  onChange={e => setItem(i.to, { new_until: e.target.value || null })} /></td>
                <td><input type="checkbox" checked={!o.hide} disabled={!allowed || i.to === '/app/menu'} aria-label={L('মেনুতে দেখাবে', 'Show in the menu')} onChange={e => setItem(i.to, { hide: !e.target.checked })} /></td>
                <td>{l.items[i.to] && allowed ? <button type="button" className="link small" onClick={() => resetItem(i.to)}>{L('আগের মতো', 'Reset')}</button> : null}</td>
              </tr> })}</tbody>
          </table></div>
        </div> })}
    </section>)}
  </AppShell>
}
