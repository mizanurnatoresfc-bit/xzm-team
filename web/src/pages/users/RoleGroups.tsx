import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell, buildNav } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { useAuth, type ViewAs } from '../../auth/AuthProvider'
import { usePrefs } from '../../lib/prefs'
import { Badge, useLoad, useToast } from '../accounts/ui'
import { dashboard } from '../../lib/dashboard'
import { menuApi, type PanelGroup } from '../../lib/menu'
import { AERV, GROUP_INFO, aervRows, groupAdmin, groupDefaults, groupFriendly, type Aerv, type AervRow, type RoleGroupRow } from '../../lib/features'

const COLS: Array<PanelGroup | 'auto'> = ['zone', 'hub', 'self', 'auto']

/**
 * Role-based groups + AERV (Super Admin): put each role in one of the three groups — সুপার অ্যাডমিন / জোনাল ম্যানেজার,
 * ম্যানেজার, স্টাফ / রাইডার — and tick Add / Edit / Remove / View per feature. The group decides the menu panels, the
 * dropdown bar, the home view and the tab bar; AERV decides what the role may do on each page.
 */
export function RoleGroups() {
  const { isSuperAdmin, viewAs, setViewAs } = useAuth()
  const { L, n, lang } = usePrefs()
  const nav = useNavigate()
  const { toast, node } = useToast()
  const sup = isSuperAdmin && !viewAs
  const data = useLoad(async () => {
    if (!sup) return null
    const [roles, codes] = await Promise.all([groupAdmin.list(), groupAdmin.allCodes()])
    return { roles, codes }
  }, [sup])
  const [sel, setSel] = useState<string | null>(null)
  const gridRef = useRef<HTMLElement>(null)
  const roles = data.data?.roles ?? []
  const codes = data.data?.codes ?? []
  const role = roles.find(r => r.role_id === sel) ?? null
  const label = (r: RoleGroupRow) => lang === 'bn' && r.name_bn ? r.name_bn : r.name

  // How many menu pages a role would get, with its own permissions and group (no page limit counted).
  const pagesFor = (r: RoleGroupRow) => {
    if (r.is_super) return null
    const has = new Set(r.permissions)
    return buildNav(p => has.has(p), null, r.panel_group).groups.reduce((a, g) => a + g.secs.reduce((b, s) => b + s.items.length, 0), 0)
  }
  async function move(r: RoleGroupRow, v: string) {
    const g = (v || null) as PanelGroup | null
    try {
      await groupAdmin.set(r.role_id, g)
      toast(g ? L(`${label(r)} → ${GROUP_INFO[g][0]}`, `${r.name} → ${GROUP_INFO[g][1]}`) : L(`${label(r)}: অনুমতি দেখে নিজে ঠিক হবে`, `${r.name}: automatic`))
      void data.reload()
    } catch (e) { toast(groupFriendly(e)) }
  }
  async function preview(r: RoleGroupRow) {
    try {
      const [lays, menus] = await Promise.all([dashboard.roleLayouts().catch(() => []), menuApi.roles().catch(() => [])])
      const lay = lays.find(x => x.role_id === r.role_id)
      const next: ViewAs = { id: r.role_id, name: label(r), permissions: r.permissions, is_super: r.is_super, panels: lay ? lay.panels : null,
        view: (r.default_view ?? lay?.default_view ?? null) as ViewAs['view'], menu: menus.find(m => m.role_id === r.role_id)?.menu ?? null, group: r.panel_group }
      setViewAs(next); nav('/app')
    } catch (e) { toast(groupFriendly(e)) }
  }
  const openGrid = (r: RoleGroupRow) => { setSel(r.role_id); window.setTimeout(() => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }

  return <AppShell title={L('রোল গ্রুপ ও AERV অনুমতি', 'Role groups & AERV permissions')}
    subtitle={L('প্রতিটি রোলকে তিন গ্রুপের একটিতে রাখুন, তারপর প্রতিটি ফিচারে A যোগ · E সম্পাদনা · R মুছা · V দেখা টিক দিন। মেনু, ড্রপডাউন ও ড্যাশবোর্ড নিজে থেকেই সেই মতো সাজবে।',
      'Put each role in one of three groups, then tick A Add · E Edit · R Remove · V View per feature. The menu, dropdowns and dashboard follow on their own.')}>
    {node}
    {!sup ? <p className="notice">{viewAs ? L('রোল হিসেবে দেখার সময় এই পাতা বন্ধ — আগে সুপার অ্যাডমিনে ফিরুন।', 'Closed while viewing as a role — go back to Super Admin first.')
      : L('এই পাতা শুধু সুপার অ্যাডমিনের জন্য।', 'This page is for the Super Admin only.')}</p> : <>
      {data.error ? <p className="da-error">{groupFriendly(data.error)}</p> : null}
      {data.loading && !data.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : null}
      <section className="panel">
        <h2>{L('তিন গ্রুপ', 'The three groups')}</h2>
        <p className="muted small">{L('গ্রুপ ঠিক করে কে কোন প্যানেল পর্যন্ত মেনু পাবেন, হোম পেজ কোন ভিউতে খুলবে আর নিচের ট্যাব কেমন হবে। কোনো গ্রুপে না রাখলে রোলের অনুমতি দেখে নিজে ঠিক হয়। একজনের কয়েকটা রোল থাকলে সবচেয়ে উপরের গ্রুপ ধরা হয়।',
          'The group decides how far up the menu panels go, which view the home page opens on and the bottom tabs. Without a group it is worked out from permissions. With several roles, the highest group counts.')}</p>
        <div className="rg-cols">{COLS.map(c => {
          const list = roles.filter(r => (r.is_super ? 'zone' : r.panel_group ?? 'auto') === c)
          const info = c === 'auto' ? null : GROUP_INFO[c]
          return <div key={c} className={`rg-col g-${c}`} data-col={c}>
            <h3><Icon name={info ? info[2] : 'gear'} size={18} />{info ? L(info[0], info[1]) : L('গ্রুপ দেওয়া নেই (নিজে ঠিক হবে)', 'No group (automatic)')}</h3>
            <p className="rg-note">{info ? L(info[3], info[4]) : L('অনুমতি দেখে প্যানেল ঠিক হয়', 'Panels follow permissions')}</p>
            {!list.length && <p className="muted small">{L('কোনো রোল নেই', 'No roles')}</p>}
            {list.map(r => { const pg = pagesFor(r); return <div key={r.role_id} className={`rg-role${sel === r.role_id ? ' sel' : ''}`} data-role={r.code}>
              <div className="rg-top"><b>{label(r)}</b>{r.is_super ? <Badge tone="bad">{L('সব ক্ষমতা', 'Full control')}</Badge> : null}</div>
              <div className="rg-stats"><span>{n(r.user_count)} {L('জন', 'users')}</span><span>{n(r.permissions.length)} {L('অনুমতি', 'permissions')}</span>
                {pg !== null && <span>{n(pg)} {L('পাতা', 'pages')}</span>}</div>
              {!r.is_super && <div className="rg-acts">
                <select aria-label={L('গ্রুপ', 'Group')} value={r.panel_group ?? ''} onChange={e => void move(r, e.target.value)}>
                  <option value="">{L('নিজে ঠিক হবে', 'Automatic')}</option>
                  {(['zone', 'hub', 'self'] as PanelGroup[]).map(g => <option key={g} value={g}>{L(GROUP_INFO[g][0], GROUP_INFO[g][1])}</option>)}</select>
                <button type="button" className="sm" onClick={() => openGrid(r)}>AERV</button>
                <button type="button" className="secondary sm" title={L('এই রোল যেভাবে দেখে', 'See it as this role')} onClick={() => void preview(r)}><Icon name="eye" size={14} /></button>
              </div>}
            </div> })}
          </div>
        })}</div>
      </section>
      {role && <section className="panel" ref={gridRef} id="aerv">
        <AervGrid key={role.role_id} role={role} codes={codes} label={label(role)} onClose={() => setSel(null)}
          onSaved={c => { toast(L(`সেভ হয়েছে — এখন ${n(c)}টি অনুমতি`, `Saved — ${c} permissions now`)); void data.reload() }} />
      </section>}
    </>}
  </AppShell>
}

type Filter = 'all' | 'accounts' | PanelGroup | 'other'
const FILTERS: Array<[Filter, string, string]> = [
  ['all', 'সব', 'All'], ['accounts', 'হিসাব', 'Accounts'], ['self', 'স্টাফ / রাইডার', 'Staff / Rider'], ['hub', 'ম্যানেজার', 'Manager'],
  ['zone', 'জোনাল', 'Zonal'], ['other', 'অন্যান্য অনুমতি', 'Other permissions'],
]

/** The AERV grid for one role: one line per feature, four boxes. Changes stay on screen until Save. */
function AervGrid({ role, codes, label, onClose, onSaved }: { role: RoleGroupRow; codes: string[]; label: string; onClose: () => void; onSaved: (count: number) => void }) {
  const { L, n } = usePrefs()
  const { rows, open } = useMemo(() => aervRows(codes), [codes])
  const orig = useMemo(() => new Set(role.permissions), [role.permissions])
  const [cur, setCur] = useState<Set<string>>(() => new Set(role.permissions))
  useEffect(() => { setCur(new Set(role.permissions)) }, [role.permissions])
  const [q, setQ] = useState('')
  const [f, setF] = useState<Filter>('all')
  const [onlyOn, setOnlyOn] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const grant = [...cur].filter(c => !orig.has(c))
  const revoke = [...orig].filter(c => !cur.has(c))
  const dirty = grant.length + revoke.length > 0

  const state = (cs: string[]) => !cs.length ? 'na' : cs.every(c => cur.has(c)) ? 'on' : cs.some(c => cur.has(c)) ? 'some' : 'off'
  const setMany = (cs: string[], on: boolean) => setCur(s => { const x = new Set(s); cs.forEach(c => on ? x.add(c) : x.delete(c)); return x })
  const flip = (cs: string[]) => setMany(cs, state(cs) !== 'on')
  const all = (r: AervRow) => AERV.flatMap(([k]) => r.codes[k])
  const qq = q.trim().toLowerCase()
  const shown = rows.filter(r => (f === 'all' || r.group === f)
    && (!qq || `${r.bn} ${r.en} ${r.resources.join(' ')} ${r.pages.map(p => `${p.bn} ${p.en}`).join(' ')}`.toLowerCase().includes(qq))
    && (!onlyOn || all(r).some(c => cur.has(c))))
  const heads: Array<[AervRow['group'], string, string]> = [['accounts', ...GROUP_INFO.accounts.slice(0, 2) as [string, string]], ['self', ...GROUP_INFO.self.slice(0, 2) as [string, string]],
    ['hub', ...GROUP_INFO.hub.slice(0, 2) as [string, string]], ['zone', ...GROUP_INFO.zone.slice(0, 2) as [string, string]], ['other', 'অন্যান্য অনুমতি (কোনো পাতায় নেই)', 'Other permissions (on no page)']]
  const colAll = (k: Aerv) => [...new Set(shown.flatMap(r => r.codes[k]))]

  async function save() {
    setBusy(true); setErr('')
    try { const c = await groupAdmin.saveAerv(role.role_id, grant, revoke); onSaved(c) } catch (e) { setErr(groupFriendly(e)) } finally { setBusy(false) }
  }
  function auto() {
    const g = role.panel_group
    if (!g) { setErr(L('আগে রোলটিকে একটি গ্রুপে রাখুন।', 'Put the role in a group first.')); return }
    setErr(''); setMany(groupDefaults(g, rows), true)
  }

  return <>
    <div className="da-bar"><h2 style={{ margin: 0 }}>AERV — {label}</h2>
      <button type="button" className="secondary sm" onClick={onClose}><Icon name="x" size={14} />{L('বন্ধ', 'Close')}</button></div>
    {role.is_system && <p className="notice small">{L('এটা সিস্টেমের রোল — বদলানো যায়, তবে সাবধানে।', 'This is a built-in role — it can be changed, carefully.')}</p>}
    <div className="av-legend">{AERV.map(([k, bn, en, acts]) => <span key={k}><b>{k}</b> = {L(bn, en)} <span className="muted">({acts.join(', ')})</span></span>)}</div>
    <div className="av-tools">
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('ফিচার খুঁজুন…', 'Search features…')} aria-label={L('ফিচার খুঁজুন', 'Search features')} />
      <select value={f} onChange={e => setF(e.target.value as Filter)} aria-label={L('গ্রুপ', 'Group')}>{FILTERS.map(([v, bn, en]) => <option key={v} value={v}>{L(bn, en)}</option>)}</select>
      <label className="da-check"><input type="checkbox" checked={onlyOn} onChange={e => setOnlyOn(e.target.checked)} /> {L('শুধু চালু', 'Only on')}</label>
      <button type="button" className="secondary sm" onClick={auto} title={L('গ্রুপের মেনুর সব পাতায় V (দেখা) টিক দেয়; সেভ না করা পর্যন্ত কিছু বদলায় না', 'Ticks V on every page of the group’s menu; nothing changes until Save')}>
        <Icon name="play" size={14} />{L('অটো: গ্রুপের সব পাতা দেখা', 'Auto: view the group’s pages')}</button>
    </div>
    <div className="av-wrap"><table className="av-table">
      <thead><tr><th>{L('ফিচার', 'Feature')}</th>{AERV.map(([k, bn, en]) => { const cs = colAll(k); const st = state(cs)
        return <th key={k} className="av-c"><button type="button" className={`av-cell ${st}`} disabled={!cs.length} title={L(`দেখানো সব লাইনে ${bn}`, `${en} on every shown line`)} onClick={() => flip(cs)}>{k}</button></th> })}
        <th className="av-c">{L('সব', 'All')}</th></tr></thead>
      <tbody>{heads.map(([g, bn, en]) => { const list = shown.filter(r => r.group === g); if (!list.length) return null
        return <Fragment key={g}><tr className="av-grp"><td colSpan={6}>{L(bn, en)} <span className="muted small">({n(list.length)})</span></td></tr>
          {list.map(r => { const changed = all(r).some(c => cur.has(c) !== orig.has(c)); const every = all(r)
            return <tr key={r.key} className={changed ? 'changed' : ''} data-row={r.key}>
              <td><span><Icon name={r.icon} size={14} /> {L(r.bn, r.en)}</span>
                {r.pages.length > 1 && <span className="av-sub">{r.pages.slice(1).map(p => L(p.bn, p.en)).join(' · ')}</span>}
                <span className="av-sub">{r.resources.join(', ')}</span></td>
              {AERV.map(([k, bn, en]) => { const cs = r.codes[k]; const st = state(cs)
                return <td key={k} className="av-c"><button type="button" className={`av-cell ${st}`} disabled={!cs.length} aria-pressed={st === 'on'}
                  aria-label={`${L(r.bn, r.en)} — ${L(bn, en)}`} title={cs.length ? cs.join('\n') : L('এই ফিচারে নেই', 'Not on this feature')} onClick={() => flip(cs)}>{st === 'na' ? '—' : k}</button></td> })}
              <td className="av-c"><input type="checkbox" aria-label={L('সব', 'All')} checked={every.length > 0 && every.every(c => cur.has(c))} onChange={e => setMany(every, e.target.checked)} /></td>
            </tr> })}</Fragment> })}</tbody>
    </table></div>
    {open.length > 0 && <p className="muted small">{L('সবার জন্য খোলা (অনুমতি লাগে না): ', 'Open to everyone (no permission needed): ')}{open.map(p => L(p.bn, p.en)).join(' · ')}</p>}
    {err && <p className="da-error" role="alert">{err}</p>}
    <div className="av-save">
      <button type="button" disabled={!dirty || busy} onClick={() => void save()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ করুন', 'Save')}</button>
      <button type="button" className="secondary" disabled={!dirty || busy} onClick={() => setCur(new Set(role.permissions))}>{L('আগের মতো', 'Undo changes')}</button>
      <span className="muted small">{dirty ? L(`${n(grant.length)}টি যোগ, ${n(revoke.length)}টি বাদ — সেভ করলে বসবে`, `${grant.length} to add, ${revoke.length} to take away`) : L('কোনো বদল নেই', 'No changes')}</span>
    </div>
  </>
}
