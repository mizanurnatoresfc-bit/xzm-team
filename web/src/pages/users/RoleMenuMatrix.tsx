import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell, ACCOUNTS, ADMIN, DATA_ENTRY, GROUPS, HOME, HR, OFFICE, PANEL_PAGES, ROUTES, SORTING, type MenuGroup } from '../../components/AppShell'
import { useAuth } from '../../auth/AuthProvider'
import { menuApi, type RoleMenu } from '../../lib/menu'
import { advancedAccessHere } from '../../lib/native'
import { usePrefs } from '../../lib/prefs'
import { dashboardFriendly } from '../../lib/dashboard'
import { askConfirm } from '../../components/ask'
import { Badge, useLoad, useToast } from '../accounts/ui'

/**
 * Quick control of the role-based sidebar (Super Admin): every menu page down the side, every role across the top, one tick box for each pair.
 * It writes the same page list as the per-role "পাতা বাছুন" dialog (menuApi.save), so who may open what still follows the role's permissions as well.
 * A role with no limit shows every page; "সীমিত করুন" turns it into a ticked list that can then be trimmed.
 */
const CSS = `.rm-wrap{overflow:auto;max-height:70vh;border:1px solid var(--border,#e5e7eb);border-radius:12px}
.rm{border-collapse:separate;border-spacing:0;min-width:100%;font-size:14px}
.rm th,.rm td{padding:6px 10px;border-bottom:1px solid var(--border,#e5e7eb);background:var(--surface,#fff);text-align:center;vertical-align:middle}
.rm thead th{position:sticky;top:0;z-index:3;min-width:132px;vertical-align:top}
.rm .rm-pg{position:sticky;left:0;z-index:2;text-align:left;min-width:190px;max-width:240px;border-right:1px solid var(--border,#e5e7eb)}
.rm thead .rm-pg{z-index:4}
.rm .rm-sec th{background:var(--surface-2,#f3f4f6);text-align:left;font-weight:700}
.rm .rm-sec .rm-pg{background:var(--surface-2,#f3f4f6)}
.rm .rm-sec td{background:var(--surface-2,#f3f4f6)}
.rm td.rm-chg{background:color-mix(in srgb,var(--primary,#2563eb) 12%,var(--surface,#fff))}
.rm td.rm-lock{opacity:.4}
.rm input[type=checkbox]{width:20px;height:20px;cursor:pointer}
.rm input[type=checkbox]:disabled{cursor:not-allowed}
.rm-role{display:flex;flex-direction:column;gap:4px;align-items:center}
.rm-role b{font-size:13px;line-height:1.25}
.rm-role select,.rm-role button{font-size:12px;max-width:128px}
.rm-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:8px 0}
.rm-bar input[type=search]{flex:1 1 220px;min-width:0}
.rm-cnt{font-size:12px;color:var(--muted,#6b7280)}`

const GROUPS_ALL: MenuGroup[] = [
  { key: 'home', icon: 'dash', bn: 'শুরু', en: 'Start', secs: [], items: HOME.filter(i => i.to !== '/app') },
  ACCOUNTS, HR, OFFICE, ROUTES, SORTING, DATA_ENTRY, ADMIN, ...GROUPS, PANEL_PAGES,
]

type Draft = Record<string, string[] | null>

export function RoleMenuMatrix() {
  const { grants } = useAuth()
  const { L, n, lang } = usePrefs()
  const { toast, node } = useToast()
  const sup = grants.some(g => g.is_super && g.scope_type === 'global')
  const menus = useLoad(() => (sup ? menuApi.roles() : Promise.resolve([] as RoleMenu[])), [sup])
  const [draft, setDraft] = useState<Draft>({})
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const roles = useMemo(() => (menus.data ?? []).filter(r => !r.is_super), [menus.data])
  const here = advancedAccessHere()
  // The pages this device's menu has (the website and the Android app each have their own twin of the roles page).
  const groups = useMemo(() => GROUPS_ALL.map(g => ({ ...g, items: g.items.filter(i => !i.only || (i.only === 'web') === here) })).filter(g => g.items.length), [here])
  const everyPage = useMemo(() => groups.flatMap(g => g.items.map(i => i.to)), [groups])

  const nameOf = (r: RoleMenu) => (lang === 'bn' && r.name_bn ? r.name_bn : r.name)
  const listOf = (r: RoleMenu): string[] | null => (r.role_id in draft ? draft[r.role_id] : r.menu)
  const changed = (r: RoleMenu) => r.role_id in draft
  const dirtyRoles = roles.filter(changed)
  const set = (r: RoleMenu, list: string[] | null) => {
    const same = JSON.stringify(list) === JSON.stringify(r.menu)
    setDraft(d => { const c = { ...d }; if (same) delete c[r.role_id]; else c[r.role_id] = list; return c })
  }

  const has = (r: RoleMenu, to: string) => { const l = listOf(r); return l === null || l.includes(to) }
  function toggle(r: RoleMenu, to: string, on: boolean) {
    const l = listOf(r); if (l === null) return
    set(r, on ? (l.includes(to) ? l : [...l, to]) : l.filter(x => x !== to))
  }
  function toggleMany(r: RoleMenu, tos: string[], on: boolean) {
    const l = listOf(r); if (l === null) return
    set(r, on ? [...l, ...tos.filter(t => !l.includes(t))] : l.filter(x => !tos.includes(x)))
  }
  const copyFrom = (r: RoleMenu, fromId: string) => {
    const from = roles.find(x => x.role_id === fromId); if (!from) return
    set(r, listOf(from) === null ? null : [...(listOf(from) as string[])])
  }

  const match = (i: { bn: string; en: string; to: string }) => { const t = q.trim().toLowerCase(); return !t || `${i.bn} ${i.en} ${i.to}`.toLowerCase().includes(t) }

  async function save() {
    setErr(''); setBusy(true)
    const failed: string[] = [], failedIds = new Set<string>()
    for (const r of dirtyRoles) {
      try { await menuApi.save(r.role_id, draft[r.role_id]) } catch (e) { failedIds.add(r.role_id); failed.push(`${nameOf(r)}: ${dashboardFriendly(e)}`) }
    }
    setBusy(false)
    await menus.reload()
    // Only the roles that failed stay as unsaved changes.
    setDraft(d => Object.fromEntries(Object.entries(d).filter(([id]) => failedIds.has(id))))
    if (failed.length) setErr(failed.join(' · '))
    else toast(L('মেনু সেভ হয়েছে — ওই রোলের লোকজন পরের বার লোড করলে নতুন মেনু পাবেন', 'Menu saved — people in those roles get it the next time they load'))
  }
  async function discard() {
    if (await askConfirm(L('সেভ না করা সব বদল ফেলে দেবেন?', 'Throw away every unsaved change?'), { ok: L('ফেলে দিন', 'Discard'), danger: true })) setDraft({})
  }

  return <AppShell title={L('রোল অনুযায়ী মেনু — দ্রুত নিয়ন্ত্রণ', 'Menu by role — quick control')}
    subtitle={L('এক পাতায় সব রোল: টিক দিলে ওই রোলের সাইডবারে পাতাটা থাকবে, তুললে থাকবে না। কোনো অনুমতি বদলায় না — অনুমতি আগের মতোই “রোল ও অনুমতি” থেকে ঠিক হয়।',
      'All roles on one page: a tick puts the page in that role’s sidebar, no tick takes it out. No permission changes — permissions are still set in Roles & permissions.')}
    actions={sup ? <>
      <button className="secondary" disabled={busy || !dirtyRoles.length} onClick={() => void discard()}>{L('বদল ফেলুন', 'Discard')}</button>
      <button disabled={busy || !dirtyRoles.length} onClick={() => void save()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L(`সেভ করুন (${n(dirtyRoles.length)} রোল)`, `Save (${dirtyRoles.length} roles)`)}</button></> : null}>
    <style>{CSS}</style>
    {node}
    {!sup ? <p className="notice">{L('এই পাতা শুধু সুপার অ্যাডমিনের জন্য।', 'This page is for the Super Admin only.')}</p> : <>
      {err && <p className="da-error" role="alert">{err}</p>}
      {menus.error ? <p className="da-error">{dashboardFriendly(menus.error)}</p> : null}
      <p className="muted small">{L('“সব পাতা” রোলে সব পাতা দেখায় (অনুমতি থাকলে)। “সীমিত করুন” চাপলে সব টিক দেওয়া অবস্থায় শুরু হয়, তারপর যেগুলো লাগবে না তুলে দিন। হোম, নিজের প্রোফাইল ও পাসওয়ার্ড সবসময় খোলা থাকে। পাতার নাম, ক্রম বা আইকন বদলাতে ',
        'A “Every page” role shows every page it has permission for. “Limit” starts with everything ticked; untick what the role does not need. Home, own profile and password are always open. To rename, reorder or hide a page for everybody, use the ')}
        <Link to="/app/menu">{L('মেনু এডিটর', 'Menu editor')}</Link>{L(' আছে।', '.')} <Link to="/app/role-dashboards#role-pages">{L('একটা রোলের জন্য আলাদা করে সাজাতে চাইলে এখানে।', 'To set one role’s page order, go here.')}</Link></p>
      <div className="rm-bar">
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('পাতা খুঁজুন…', 'Search pages…')} aria-label={L('পাতা খুঁজুন', 'Search pages')} />
        <span className="rm-cnt">{L(`${n(roles.length)}টি রোল · ${n(everyPage.length)}টি পাতা`, `${roles.length} roles · ${everyPage.length} pages`)}</span>
      </div>
      {menus.loading && <p className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</p>}
      {!!roles.length && <div className="rm-wrap"><table className="rm">
        <thead><tr>
          <th className="rm-pg">{L('পাতা', 'Page')}</th>
          {roles.map(r => { const l = listOf(r)
            return <th key={r.role_id} scope="col" className={changed(r) ? 'rm-chg' : undefined}><div className="rm-role">
              <b>{nameOf(r)}</b>
              <span className="rm-cnt">{n(r.user_count)} {L('জন', 'users')}</span>
              {l === null ? <Badge tone="info">{L('সব পাতা', 'Every page')}</Badge> : <Badge tone="warn">{L(`${n(l.length)}টি পাতা`, `${l.length} pages`)}</Badge>}
              {l === null
                ? <button type="button" className="secondary sm" onClick={() => set(r, [...everyPage])}>{L('সীমিত করুন', 'Limit')}</button>
                : <button type="button" className="secondary sm" onClick={() => set(r, null)}>{L('সীমা তুলুন', 'No limit')}</button>}
              <select aria-label={`${nameOf(r)} — ${L('অন্য রোল থেকে কপি', 'copy from another role')}`} value="" onChange={e => { copyFrom(r, e.target.value); e.target.value = '' }}>
                <option value="">{L('কপি করুন…', 'Copy from…')}</option>
                {roles.filter(x => x.role_id !== r.role_id).map(x => <option key={x.role_id} value={x.role_id}>{nameOf(x)}</option>)}</select>
            </div></th> })}
        </tr></thead>
        <tbody>{groups.map(g => { const rows = g.items.filter(match); if (!rows.length) return null
          const tos = rows.map(i => i.to)
          return [<tr key={g.key} className="rm-sec"><th scope="row" className="rm-pg">{L(g.bn, g.en)}</th>
            {roles.map(r => { const l = listOf(r), all = tos.every(t => has(r, t))
              return <td key={r.role_id} className={changed(r) ? 'rm-chg' : undefined}>{l === null ? <span className="rm-cnt">—</span>
                : <button type="button" className="link small" onClick={() => toggleMany(r, tos, !all)}>{all ? L('কোনোটা না', 'None') : L('সব', 'All')}</button>}</td> })}</tr>,
          ...rows.map(i => <tr key={g.key + i.to}>
            <th scope="row" className="rm-pg" title={i.to}>{L(i.bn, i.en)}</th>
            {roles.map(r => { const l = listOf(r)
              return <td key={r.role_id} className={`${changed(r) ? 'rm-chg' : ''}${l === null ? ' rm-lock' : ''}`}>
                <input type="checkbox" checked={has(r, i.to)} disabled={l === null} aria-label={`${nameOf(r)} — ${L(i.bn, i.en)}`}
                  title={l === null ? L('এই রোলে সীমা নেই — আগে “সীমিত করুন” চাপুন', 'This role has no limit — press “Limit” first') : undefined}
                  onChange={e => toggle(r, i.to, e.target.checked)} /></td> })}</tr>)]
        })}</tbody></table></div>}
      {!menus.loading && !roles.length && !menus.error && <p className="muted">{L('কোনো রোল পাওয়া যায়নি।', 'No roles found.')}</p>}
    </>}
  </AppShell>
}
