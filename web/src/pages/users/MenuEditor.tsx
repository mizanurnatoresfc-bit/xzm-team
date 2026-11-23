import { askConfirm } from '../../components/ask'
import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { ACCOUNTS, ADMIN, AppShell, GROUPS, HOME, HR, NEW_UNTIL, OFFICE, SORTING, type MenuGroup, type MenuItem } from '../../components/AppShell'
import { hasIcon, Icon, ICON_NAMES } from '../../components/Icon'
import { useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { cleanLayout, EMPTY_LAYOUT, loadMenuLayout, saveMenuLayout, secKey, type ItemLayout, type MenuLayout } from '../../lib/menuLayout'

/** The panels in the order the sidebar shows them; the two home rows are a panel of their own here. */
const PANELS: MenuGroup[] = [
  { key: 'home', icon: 'dash', bn: 'উপরের সারি', en: 'Top rows', secs: [{ bn: '', en: '', items: HOME }], items: HOME },
  ACCOUNTS, HR, OFFICE, SORTING, ...GROUPS, ADMIN,
]

/** Rows of one section in the saved order (hidden rows stay in the list so they can be shown again). */
const ordered = (items: MenuItem[], l: MenuLayout) => items.map((i, at) => ({ i, at, o: l.items[i.to] }))
  .sort((a, b) => (a.o?.order ?? a.at) - (b.o?.order ?? b.at) || a.at - b.at).map(x => x.i)

/**
 * সেটিং ও অনুমতি → মেনু এডিটর: rename, reorder and hide menu rows, change a row's or a panel's icon, rename panels and their headings, and set until when a row
 * shows "নতুন". Only what differs from the code is saved, so "আগের মতো" always brings back the original.
 * Who may open a page is not changed here — that stays with the role's permissions and page list.
 */
const CSS = `.me-rows{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.me-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 12px;padding:10px;border:1px solid var(--line,#e5e7eb);border-radius:10px;min-width:0}
.me-ord{display:flex;align-items:center;gap:4px}
.me-f{display:flex;flex-direction:column;gap:3px;flex:1 1 200px;min-width:0}
.me-f input{width:100%;min-width:0;box-sizing:border-box}
.me-date{flex:0 1 170px}
.me-show{display:flex;align-items:center;gap:6px;padding-bottom:8px}
.me-row .link{padding-bottom:8px}
.me-ic{display:inline-grid;place-items:center;width:38px;min-width:38px;height:38px;padding:0;border-radius:10px;background:var(--surface);color:var(--text);border:1px solid var(--border)}
.me-ic:hover:not(:disabled),.me-ic.on{border-color:var(--primary);color:var(--primary)}
.me-ic.on{background:var(--primary);color:#fff}
.me-pick{flex:1 1 100%;display:flex;flex-wrap:wrap;gap:6px;padding:10px;border:1px dashed var(--border);border-radius:10px}
.me-gic{display:flex;flex-direction:column;gap:3px}
.me-ghead{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 12px}
.me-ghead+.me-pick{margin-top:8px}`

/** The icons to choose from; the picked one is marked, and picking the code's own icon saves nothing. */
function IconPick({ value, onPick, label }: { value: string; onPick: (name: string) => void; label: string }) {
  return <div className="me-pick" role="group" aria-label={label}>
    {ICON_NAMES.map(n => <button key={n} type="button" className={`me-ic${n === value ? ' on' : ''}`} title={n} aria-label={n} aria-pressed={n === value} onClick={() => onPick(n)}><Icon name={n} size={18} /></button>)}
  </div>
}

export function MenuEditor() {
  const { can } = useAuth()
  const { L } = usePrefs()
  const { toast, node } = useToast()
  const allowed = can('system.settings.configure')
  const [l, setL] = useState<MenuLayout | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  /** Which icon list is open: 'g:<panel key>' or 'i:<row path>'. */
  const [pick, setPick] = useState('')
  useEffect(() => { void loadMenuLayout(true).then(setL) }, [])

  if (!l) return <AppShell title={L('মেনু এডিটর', 'Menu editor')}><p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p></AppShell>

  const put = (next: MenuLayout) => { setL(next); setDirty(true) }
  const setItem = (to: string, patch: ItemLayout) => put({ ...l, items: { ...l.items, [to]: { ...l.items[to], ...patch } } })
  const named = (lang: 'bn' | 'en', v: string, dflt: string) => { const t = v === dflt ? '' : v; return lang === 'bn' ? { bn: t } : { en: t } }
  const setName = (part: 'groups' | 'secs', key: string, lang: 'bn' | 'en', v: string, dflt: string) => {
    const m = { ...l[part], [key]: { ...l[part][key], ...named(lang, v, dflt) } }
    put(part === 'groups' ? { ...l, groups: m } : { ...l, secs: m })
  }
  const iconOf = (saved: string | undefined, dflt: string) => hasIcon(saved) ? saved : dflt
  const setItemIcon = (i: MenuItem, name: string) => { setItem(i.to, { icon: name === i.icon ? '' : name }); setPick('') }
  const setGroupIcon = (g: MenuGroup, name: string) => { put({ ...l, groups: { ...l.groups, [g.key]: { ...l.groups[g.key], icon: name === g.icon ? '' : name } } }); setPick('') }
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
    subtitle={L('মেনুর নাম, আইকন, ক্রম, লুকানো সারি আর “নতুন” ব্যাজ এখান থেকে বদলান — কোড ধরতে হবে না। কে কোন পাতা খুলতে পারবে তা আগের মতোই রোলের অনুমতি ঠিক করে।',
      'Change the menu’s names, icons, order, hidden rows and “new” badges here, without touching the code. Who may open a page is still decided by the role’s permissions.')}
    actions={allowed ? <>
      <button className="secondary" disabled={busy || !changed} onClick={async () => { if (await askConfirm(L('সব বদল মুছে মেনু আগের মতো করবেন?', 'Undo every change and bring back the original menu?'), { ok: L('আগের মতো করুন', 'Reset'), danger: true })) put(EMPTY_LAYOUT) }}>{L('সব আগের মতো', 'Reset all')}</button>
      <button disabled={busy || !dirty} onClick={() => void save()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ করুন', 'Save')}</button></> : null}>
    <style>{CSS}</style>
    {node}
    {!allowed && <p className="notice">{L('এই পাতা বদলানোর অনুমতি আপনার নেই।', 'You are not allowed to change this page.')}</p>}
    {err && <p className="da-error">{err}</p>}
    <p className="muted small">{L('আইকনে চাপ দিলে অন্য আইকন বেছে নেওয়া যায়। নামের ঘর খালি রাখলে বা আগের নাম লিখলে কোডের নামটাই থাকে। “নতুন” তারিখ খালি রাখলে ব্যাজ দেখায় না; তারিখ পেরোলে ব্যাজ নিজেই সরে যায়।',
      'Press an icon to choose another one. An empty name box, or the original name, keeps the name from the code. With no “new” date there is no badge; after the date the badge goes away by itself.')}</p>
    {PANELS.map(g => <section key={g.key} className="panel">
      {g.key === 'home' ? <h2>{L(g.bn, g.en)}</h2> : <><div className="me-ghead">
        <div className="me-gic"><span className="muted small">{L('আইকন', 'Icon')}</span>
          <button type="button" className={`me-ic${pick === 'g:' + g.key ? ' on' : ''}`} disabled={!allowed} aria-expanded={pick === 'g:' + g.key} aria-label={L('প্যানেলের আইকন বদলান', 'Change the panel icon')}
            onClick={() => setPick(pick === 'g:' + g.key ? '' : 'g:' + g.key)}><Icon name={iconOf(l.groups[g.key]?.icon, g.icon)} size={18} /></button></div>
        <div className="hr-form" style={{ flex: '1 1 240px', minWidth: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <label><span className="muted small">{L('প্যানেলের নাম (বাংলা)', 'Panel name (Bangla)')}</span>
          <input value={l.groups[g.key]?.bn || g.bn} maxLength={80} disabled={!allowed} onChange={e => setName('groups', g.key, 'bn', e.target.value, g.bn)} /></label>
        <label><span className="muted small">{L('প্যানেলের নাম (ইংরেজি)', 'Panel name (English)')}</span>
          <input value={l.groups[g.key]?.en || g.en} maxLength={80} disabled={!allowed} onChange={e => setName('groups', g.key, 'en', e.target.value, g.en)} /></label>
      </div></div>
      {pick === 'g:' + g.key && <IconPick value={iconOf(l.groups[g.key]?.icon, g.icon)} label={L('প্যানেলের আইকন', 'Panel icon')} onPick={n => setGroupIcon(g, n)} />}</>}
      {g.secs.map((x, n) => { const sk = secKey(g.key, n); const rows = ordered(x.items, l)
        return <div key={sk} style={{ marginTop: 14 }}>
          {x.bn && <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label><span className="muted small">{L('ভাগের নাম (বাংলা)', 'Heading (Bangla)')}</span>
              <input value={l.secs[sk]?.bn || x.bn} maxLength={80} disabled={!allowed} onChange={e => setName('secs', sk, 'bn', e.target.value, x.bn)} /></label>
            <label><span className="muted small">{L('ভাগের নাম (ইংরেজি)', 'Heading (English)')}</span>
              <input value={l.secs[sk]?.en || x.en} maxLength={80} disabled={!allowed} onChange={e => setName('secs', sk, 'en', e.target.value, x.en)} /></label>
          </div>}
          <div className="me-rows">{rows.map((i, at) => { const o = l.items[i.to] ?? {}
            const nu = o.new_until !== undefined ? o.new_until ?? '' : NEW_UNTIL[i.to.split('?')[0]] ?? ''
            return <div key={i.to} className="me-row" style={o.hide ? { opacity: .55 } : undefined}>
              <span className="me-ord">
                <button type="button" className="icon" disabled={!allowed || at === 0} aria-label={L('উপরে', 'Up')} onClick={() => move(x.items, at, -1)}>▲</button>
                <button type="button" className="icon" disabled={!allowed || at === rows.length - 1} aria-label={L('নিচে', 'Down')} onClick={() => move(x.items, at, 1)}>▼</button>
                <button type="button" className={`me-ic${pick === 'i:' + i.to ? ' on' : ''}`} disabled={!allowed} aria-expanded={pick === 'i:' + i.to} aria-label={L('আইকন বদলান', 'Change the icon')}
                  onClick={() => setPick(pick === 'i:' + i.to ? '' : 'i:' + i.to)}><Icon name={iconOf(o.icon, i.icon)} size={18} /></button></span>
              <label className="me-f"><span className="muted small">{L('নাম (বাংলা)', 'Name (Bangla)')}</span>
                <input value={o.bn || i.bn} maxLength={80} disabled={!allowed} title={i.to} onChange={e => itemName(i, 'bn', e.target.value)} /></label>
              <label className="me-f"><span className="muted small">{L('নাম (ইংরেজি)', 'Name (English)')}</span>
                <input value={o.en || i.en} maxLength={80} disabled={!allowed} onChange={e => itemName(i, 'en', e.target.value)} /></label>
              <label className="me-f me-date"><span className="muted small">{L('“নতুন” কবে পর্যন্ত', '“New” until')}</span>
                <input type="date" value={nu} min={today} disabled={!allowed} onChange={e => setItem(i.to, { new_until: e.target.value || null })} /></label>
              <label className="me-show"><input type="checkbox" checked={!o.hide} disabled={!allowed || i.to === '/app/menu'} onChange={e => setItem(i.to, { hide: !e.target.checked })} />
                <span className="small">{L('দেখাবে', 'Shown')}</span></label>
              {l.items[i.to] && allowed ? <button type="button" className="link small" onClick={() => resetItem(i.to)}>{L('আগের মতো', 'Reset')}</button> : null}
              {pick === 'i:' + i.to && <IconPick value={iconOf(o.icon, i.icon)} label={L('সারির আইকন', 'Row icon')} onPick={n => setItemIcon(i, n)} />}
            </div> })}</div>
        </div> })}
    </section>)}
  </AppShell>
}
