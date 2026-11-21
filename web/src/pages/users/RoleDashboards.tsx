import { useState } from 'react'
import { menuApi, type RoleMenu } from '../../lib/menu'
import { ACCOUNTS, ADMIN, GROUPS, HOME, OFFICE, SORTING } from '../../components/AppShell'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Badge, Modal, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { advancedAccessHere } from '../../lib/native'
import { staffPanel, STAFF_DEFAULT, STAFF_SECTIONS, staffSectionName, type StaffSection } from '../../lib/staffPanel'
import { dashboard, dashboardFriendly, PANELS, VIEWS, VIEW_OF, panelLabel, panelNote, type DashView, type PanelCode, type RoleDashboard } from '../../lib/dashboard'

const isSuper = (grants: { is_super: boolean; scope_type: string }[]) => grants.some(g => g.is_super && g.scope_type === 'global')

/** Super Admin decides what each role sees on its home page. */
export function RoleDashboards() {
  const { grants } = useAuth()
  const { L, n, lang } = usePrefs()
  const sup = isSuper(grants)
  const list = useLoad(async () => {
    if (!sup) return [] as RoleDashboard[]
    const [rows, views] = await Promise.all([dashboard.roleLayouts(), dashboard.roleViews()])
    return rows.map(r => ({ ...r, default_view: views[r.role_id] ?? null }))
  }, [sup])
  const viewName = (v: DashView | null | undefined) => { const x = VIEWS.find(y => y[0] === v); return x ? L(x[1], x[2]) : L('নিজে ঠিক হবে', 'Automatic') }
  async function setRoleView(r: RoleDashboard, v: string) {
    try { await dashboard.setRoleView(r.role_id, (v || null) as DashView | null); toast(L(`${r.name}: প্রথমে "${viewName(v as DashView)}" ভিউ খুলবে`, 'Saved')); void list.reload() }
    catch (e) { toast(dashboardFriendly(e)) }
  }
  const [edit, setEdit] = useState<RoleDashboard | null>(null)
  const menus = useLoad(() => (sup ? menuApi.roles() : Promise.resolve([] as RoleMenu[])), [sup])
  const [pages, setPages] = useState<RoleMenu | null>(null)
  const staff = useLoad(() => (sup ? staffPanel.byRole() : Promise.resolve({} as Record<string, StaffSection[] | null>)), [sup])
  const [staffEdit, setStaffEdit] = useState<RoleDashboard | null>(null)
  const { toast, node } = useToast()

  return <AppShell title={L('রোলভিত্তিক ড্যাশবোর্ড বিল্ডার', 'Role-based Dashboard Builder')}
    subtitle={L('প্রতি রোলের হোম ড্যাশবোর্ডে কোন ভিউ, প্যানেল ও স্টাফ অংশ থাকবে এবং কোন ক্রমে থাকবে—এখান থেকে সাজান। কোনো অনুমতি যোগ বা বদলানো হয় না।',
      'Arrange each role’s home views, dashboard panels and staff sections here. This does not add or change permissions.')}>
    {node}
    {!sup ? <p className="notice">{L('এই পাতা শুধু সুপার অ্যাডমিনের জন্য।', 'This page is for the Super Admin only.')}</p> : <>
      {list.error ? <p className="da-error">{dashboardFriendly(list.error)}</p> : null}
      <section className="panel">
        <div className="da-table-wrap"><table className="da-table">
          <thead><tr><th>{L('রোল', 'Role')}</th><th>{L('ইউজার', 'Users')}</th><th>{L('প্রথমে কোন ভিউ', 'Opens on')}</th><th>{L('হোম পেজে যা দেখবে', 'What they see on the home page')}</th><th /></tr></thead>
          <tbody>{(list.data ?? []).map(r => <tr key={r.role_id}>
            <td><strong>{lang === 'bn' && r.name_bn ? r.name_bn : r.name}</strong>{r.is_super ? <> <Badge tone="bad">{L('সব ক্ষমতা', 'Full control')}</Badge></> : null}</td>
            <td>{n(r.user_count)}</td>
            <td data-label={L('প্রথমে কোন ভিউ', 'Opens on')}><select className="rd-view" value={r.default_view ?? ''} onChange={e => void setRoleView(r, e.target.value)}>
              <option value="">{L('নিজে ঠিক হবে', 'Automatic')}</option>{VIEWS.map(([v, bn, en]) => <option key={v} value={v}>{L(bn, en)}</option>)}</select></td>
            <td className="small">{r.panels.length ? r.panels.map(p => panelLabel(p, lang)).join(' · ')
              : <span className="muted">{L('আলাদা করে কিছু বলা নেই — অনুমতি অনুযায়ী দেখাবে', 'Nothing set — follows their permissions')}</span>}</td>
            <td style={{ textAlign: 'right' }}><button className="secondary sm" data-arrange={r.code} onClick={() => setEdit(r)}>{L('সাজান', 'Arrange')}</button></td>
          </tr>)}</tbody></table></div>
        {list.loading && <p className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</p>}
      </section>
      <section className="panel" id="staff-panel">
        <h2>{L('স্টাফ প্যানেল সাজান', 'Arrange the staff panel')}</h2>
        <p className="muted small">{L('স্টাফ প্যানেল পাতায় কোন রোল কোন অংশ দেখবে আর কোন ক্রমে। কিছু না সাজালে সবাই পুরো পাতা দেখবেন। কারও একাধিক রোল থাকলে যেকোনো রোলে রাখা অংশ দেখাবে; কোনো একটি রোল পুরো পাতায় থাকলে পুরো পাতাই দেখাবে। যাকে আজকের কাজের হিসাব দিতে হয়, তার “আজকের কাজের হিসাব” অংশ লুকানো থাকলেও নিচে দেখাবে।',
          'Which parts of the staff panel each role sees, and in what order. Nothing set means the whole page. With several roles, a part shows if any of them has it; if any role is on the whole page, the whole page shows. Someone who must give today’s work count still gets that part at the bottom, even when it is hidden.')}</p>
        <div className="nv-rows">{(list.data ?? []).filter(r => !r.is_super).map(r => { const cur = staff.data?.[r.role_id] ?? null, known = !!staff.data && !staff.error
          return <div key={r.role_id} className="nv-row">
            <span className="tx"><b>{lang === 'bn' && r.name_bn ? r.name_bn : r.name}</b>
              <span>{!known ? '—' : cur ? cur.map(k => staffSectionName(k, lang)).join(' · ') : L('পুরো পাতা (স্ট্যান্ডার্ড)', 'Whole page (standard)')}</span></span>
            <span className="end">{cur ? <Badge tone="info">{L(`${n(cur.length)}টি অংশ`, `${cur.length} parts`)}</Badge> : null}
              <button type="button" className="secondary sm" data-staff-arrange={r.code} disabled={!known}
                title={known ? undefined : L('আগে বর্তমান সাজানো লোড হতে হবে', 'The current setting has to load first')} onClick={() => setStaffEdit(r)}>{L('সাজান', 'Arrange')}</button></span>
          </div> })}</div>
        {staff.error ? <p className="da-error">{dashboardFriendly(staff.error)}</p> : null}
      </section>
      <section className="panel" id="role-pages">
        <h2>{L('ডাইনামিক মেনু বিল্ডার', 'Dynamic Menu Builder')}</h2>
        <p className="muted small">{L('প্রতি রোলের মেনুতে কোন পাতা থাকবে বাছুন, তারপর একই বিভাগের ভেতরে ক্রম সাজান। পেজের বিভাগ ও নাম আপাতত সবার জন্য একই। মেনুতে পাতা যোগ করলেই নতুন অনুমতি তৈরি হয় না—অনুমতি “রোল ও অনুমতি” পাতায় নিয়ন্ত্রণ হয়।',
          'Choose which pages appear for each role, then arrange their order within each existing section. Page sections and names stay shared. Adding a page to the menu does not grant permission; permissions remain controlled in Roles & permissions.')}</p>
        <div className="nv-rows">{(menus.data ?? []).filter(r => !r.is_super).map(r => <div key={r.role_id} className="nv-row">
          <span className="tx"><b>{lang === 'bn' && r.name_bn ? r.name_bn : r.name}</b>
            <span>{r.menu ? L(`${n(r.menu.length)}টি পাতা চালু`, `${r.menu.length} pages on`) : L('সব পাতা (অনুমতি অনুযায়ী)', 'Every page (by permission)')} · {n(r.user_count)} {L('জন ইউজার', 'users')}</span></span>
          <span className="end">{r.menu ? <Badge tone="warn">{L('সীমিত', 'Limited')}</Badge> : null}<button type="button" className="secondary sm" onClick={() => setPages(r)}>{L('পাতা বাছুন', 'Choose pages')}</button></span>
        </div>)}</div>
        {menus.error ? <p className="da-error">{dashboardFriendly(menus.error)}</p> : null}
      </section>
      <section className="panel">
        <h2>{L('প্যানেলগুলো কী কী', 'What the panels are')}</h2>
        <ul className="muted small">{PANELS.map(([code]) => <li key={code}><strong>{panelLabel(code, lang)}</strong> — {panelNote(code, lang)}</li>)}</ul>
      </section>
    </>}
    {staffEdit && staff.data && !staff.error && <StaffEditor role={staffEdit} current={staff.data?.[staffEdit.role_id] ?? null} onClose={() => setStaffEdit(null)}
      onDone={() => { setStaffEdit(null); toast(L('স্টাফ প্যানেল সেভ হয়েছে', 'Staff panel saved')); void staff.reload() }} />}
    {pages && <PagesEditor role={pages} onClose={() => setPages(null)} onDone={() => { setPages(null); toast(L('পাতার তালিকা সেভ হয়েছে', 'Pages saved')); void menus.reload() }} />}
    {edit && <LayoutEditor role={edit} onClose={() => setEdit(null)}
      onDone={() => { setEdit(null); toast(L('ড্যাশবোর্ড সেভ হয়েছে', 'Dashboard saved')); void list.reload() }} />}
  </AppShell>
}

/** Tick the pages a role gets. "No limit" clears the list. */
function PagesEditor({ role, onClose, onDone }: { role: RoleMenu; onClose: () => void; onDone: () => void }) {
  const { L, lang } = usePrefs()
  const [limit, setLimit] = useState(role.menu !== null)
  const [picked, setPicked] = useState<string[]>(role.menu ?? [])
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const toggle = (to: string) => setPicked(p => p.includes(to) ? p.filter(x => x !== to) : [...p, to])
  const groups = [{ key: 'home', bn: 'শুরু', en: 'Start', items: HOME.filter(i => i.to !== '/app') }, ACCOUNTS, OFFICE, SORTING, ADMIN, ...GROUPS]
  const groupOf = (to: string) => groups.find(g => g.items.some(i => i.to === to))?.key ?? ''
  const movePage = (to: string, direction: -1 | 1) => setPicked(current => {
    const peers = current.map((value, index) => ({ value, index })).filter(x => groupOf(x.value) === groupOf(to))
    const at = peers.findIndex(x => x.value === to), next = at + direction
    if (at < 0 || next < 0 || next >= peers.length) return current
    const copy = [...current], a = peers[at].index, b = peers[next].index
    ;[copy[a], copy[b]] = [copy[b], copy[a]]
    return copy
  })
  async function save() {
    setBusy(true); setErr('')
    try { await menuApi.save(role.role_id, limit ? picked : null); onDone() } catch (e) { setErr(dashboardFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal wide title={`${L('পাতা বাছুন', 'Choose pages')} — ${lang === 'bn' && role.name_bn ? role.name_bn : role.name}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ', 'Save')}</button></>}>
    <div className="da-seg" role="group"><button type="button" className={limit ? 'secondary' : ''} aria-pressed={!limit} onClick={() => setLimit(false)}>{L('সব পাতা (সীমা নেই)', 'Every page (no limit)')}</button>
      <button type="button" className={limit ? '' : 'secondary'} aria-pressed={limit} onClick={() => setLimit(true)}>{L('শুধু টিক দেওয়া পাতা', 'Only the ticked pages')}</button></div>
    {limit && <><p className="muted small">{L('হোম, নিজের প্রোফাইল ও পাসওয়ার্ড বদলানো সবসময় খোলা থাকে। টিক দেওয়া পাতা তখনই দেখাবে যখন রোলের সেই পাতার অনুমতিও আছে।',
      'Home, own profile and password are always open. A ticked page shows only when the role also has the permission for it.')}</p>
      <h3 className="rd-h">{L('মেনুর ক্রম', 'Menu order')}</h3>
      <p className="muted small">{L('উপরের আইটেমগুলো একই বিভাগের মধ্যে ↑ ↓ দিয়ে সাজান।', 'Use ↑ ↓ to arrange selected pages within each section.')}</p>
      <div className="nv-rows rd-list" data-list="menu-order">{groups.map(g => {
        const selected = picked.filter(to => groupOf(to) === g.key)
        return selected.length ? <div key={g.key} className="nv-row"><span className="tx"><b>{L(g.bn, g.en)}</b>
          <span>{selected.map((to, index) => {
            const item = g.items.find(i => i.to === to)!
            return <span key={to} className="rd-menu-item"><span>{index + 1}. {L(item.bn, item.en)}</span>
              <span className="rd-acts"><button type="button" className="secondary sm" aria-label={L('উপরে নিন', 'Move up')} disabled={index === 0} onClick={() => movePage(to, -1)}>↑</button>
                <button type="button" className="secondary sm" aria-label={L('নিচে নিন', 'Move down')} disabled={index === selected.length - 1} onClick={() => movePage(to, 1)}>↓</button></span></span>
          })}</span></span></div> : null
      })}</div>
      <h3 className="rd-h">{L('পাতা বাছুন', 'Choose pages')}</h3>
      <div className="pg-pick">{groups.map(g => <fieldset key={g.key}><legend>{L(g.bn, g.en)}
        <button type="button" className="link small" onClick={() => { const all = g.items.filter(i => !i.only || (i.only === 'web') === advancedAccessHere()).map(i => i.to); setPicked(p => all.every(t => p.includes(t)) ? p.filter(t => !all.includes(t)) : [...new Set([...p, ...all])]) }}>{L('সব', 'all')}</button></legend>
        {g.items.filter(i => !i.only || (i.only === 'web') === advancedAccessHere()).map(i => <label key={i.to} className="da-check"><input type="checkbox" checked={picked.includes(i.to)} onChange={() => toggle(i.to)} /> {L(i.bn, i.en)}</label>)}</fieldset>)}</div>
      <p className="muted small">{L(`${picked.length}টি পাতা বাছা হয়েছে`, `${picked.length} pages chosen`)}</p></>}
    {err && <p className="da-error" role="alert">{err}</p>}
  </Modal>
}

function LayoutEditor({ role, onClose, onDone }: { role: RoleDashboard; onClose: () => void; onDone: () => void }) {
  const { L, n, lang } = usePrefs()
  const [picked, setPicked] = useState<PanelCode[]>(role.panels)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const rest = PANELS.map(x => x[0]).filter(c => !picked.includes(c))
  const shares = (a: PanelCode, b: PanelCode) => (VIEW_OF[a] ?? []).some(v => VIEW_OF[b]?.includes(v))
  // Up / down jumps over panels of other views: those are never on screen together, so swapping with them would look like nothing happened.
  const target = (p: PanelCode, d: -1 | 1) => {
    const i = picked.indexOf(p)
    for (let j = i + d; j >= 0 && j < picked.length; j += d) if (shares(p, picked[j])) return j
    return -1
  }
  const move = (p: PanelCode, d: -1 | 1) => {
    const i = picked.indexOf(p), j = target(p, d)
    if (i < 0 || j < 0) return
    const c = [...picked]; c.splice(i, 1); c.splice(j, 0, p); setPicked(c)
  }
  const tags = (code: PanelCode) => (VIEW_OF[code] ?? []).map(v => <span key={v} className={`vw-tag v-${v}`}>{L(...(VIEWS.find(x => x[0] === v)!.slice(1, 3) as [string, string]))}</span>)
  async function save() {
    setErr(''); setBusy(true)
    try { await dashboard.saveRoleLayout(role.role_id, picked); onDone() }
    catch (e) { setErr(dashboardFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal wide title={`${lang === 'bn' && role.name_bn ? role.name_bn : role.name} — ${L('হোম পেজ সাজান', 'arrange the home page')}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button disabled={busy} onClick={() => void save()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ করুন', 'Save')}</button></>}>
    <p className="muted small">{L('উপরের তালিকায় যা আছে, এই রোলের হোম পেজে সেটাই এই ক্রমে দেখাবে। ↑ ↓ দিয়ে সাজান, “সরান” দিয়ে বাদ দিন, নিচের তালিকা থেকে যোগ করুন। রংয়ের ট্যাগ বলে প্যানেলটি কোন ভিউতে (আমি / হাব / জোন) থাকে।',
      'What is in the top list shows on this role’s home page, in this order. Arrange with ↑ ↓, take off with “Remove”, add from the list below. The coloured tag says which view (Me / Hub / Zone) a panel sits in.')}</p>

    <h3 className="rd-h">{L('হোম পেজে আছে', 'On the home page')} <span className="muted small">({n(picked.length)})</span></h3>
    {!picked.length ? <p className="notice">{L('কিছু রাখা নেই — এই রোলের অনুমতি অনুযায়ী প্যানেল আপনা-আপনি দেখাবে।', 'Nothing chosen — panels follow this role’s permissions on their own.')}</p>
      : <div className="nv-rows rd-list" data-list="on">{picked.map((code, i) => <div key={code} className="nv-row" data-panel={code}>
          <span className="nv-av rd-no">{n(i + 1)}</span>
          <span className="tx"><b>{panelLabel(code, lang)}</b><span>{tags(code)}{panelNote(code, lang)}</span></span>
          <span className="rd-acts">
            <button type="button" className="secondary sm" aria-label={`${code} up`} disabled={target(code, -1) < 0} onClick={() => move(code, -1)}>↑</button>
            <button type="button" className="secondary sm" aria-label={`${code} down`} disabled={target(code, 1) < 0} onClick={() => move(code, 1)}>↓</button>
            <button type="button" className="danger sm" aria-label={`${code} remove`} onClick={() => setPicked(x => x.filter(y => y !== code))}>{L('সরান', 'Remove')}</button>
          </span></div>)}</div>}

    <h3 className="rd-h">{L('যোগ করা যায়', 'Can be added')} <span className="muted small">({n(rest.length)})</span></h3>
    {!rest.length ? <p className="muted small">{L('সব প্যানেলই হোম পেজে আছে।', 'Every panel is already on the home page.')}</p>
      : <div className="nv-rows rd-list" data-list="off">{rest.map(code => <div key={code} className="nv-row none" data-panel={code}>
          <span className="tx"><b>{panelLabel(code, lang)}</b><span>{tags(code)}{panelNote(code, lang)}</span></span>
          <span className="rd-acts"><button type="button" className="sm" aria-label={`${code} add`} onClick={() => setPicked(x => [...x, code])}>+ {L('যোগ করুন', 'Add')}</button></span></div>)}</div>}
    <p className="muted small">{L('রোলের অনুমতি না থাকলে প্যানেল যোগ করলেও দেখাবে না।', 'A panel the role has no permission for stays hidden even if added.')}</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}

/** Super Admin: which staff panel parts a role sees, in which order. "Standard" clears it. */
function StaffEditor({ role, current, onClose, onDone }: { role: RoleDashboard; current: StaffSection[] | null; onClose: () => void; onDone: () => void }) {
  const { L, n, lang } = usePrefs()
  const [picked, setPicked] = useState<StaffSection[]>(current ?? STAFF_DEFAULT)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const rest = STAFF_DEFAULT.filter(k => !picked.includes(k))
  const info = (k: StaffSection) => STAFF_SECTIONS.find(x => x[0] === k)!
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= picked.length) return; const c = [...picked]; [c[i], c[j]] = [c[j], c[i]]; setPicked(c) }
  async function save(list: StaffSection[] | null) {
    setErr(''); setBusy(true)
    try { await staffPanel.save(role.role_id, list); onDone() } catch (e) { setErr(dashboardFriendly(e)) } finally { setBusy(false) }
  }
  const same = picked.join() === STAFF_DEFAULT.join()
  return <Modal wide title={`${lang === 'bn' && role.name_bn ? role.name_bn : role.name} — ${L('স্টাফ প্যানেল সাজান', 'arrange the staff panel')}`} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button>
      {current && <button className="secondary" disabled={busy} onClick={() => void save(null)}>{L('স্ট্যান্ডার্ডে ফেরান', 'Back to standard')}</button>}
      <button disabled={busy || !picked.length} onClick={() => void save(same ? null : picked)}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ করুন', 'Save')}</button></>}>
    <p className="muted small">{L('উপরের তালিকার অংশগুলোই এই রোলের স্টাফ প্যানেলে এই ক্রমে দেখাবে। ↑ ↓ দিয়ে সাজান, “সরান” দিয়ে লুকান, নিচ থেকে আবার যোগ করুন। উপরের নামের কার্ড আর শর্টকাট সবসময় থাকে।',
      'The parts in the top list show on this role’s staff panel, in this order. Arrange with ↑ ↓, hide with “Remove”, add back from below. The name card and shortcuts at the top always stay.')}</p>
    <h3 className="rd-h">{L('পাতায় আছে', 'On the page')} <span className="muted small">({n(picked.length)})</span></h3>
    {!picked.length ? <p className="notice">{L('অন্তত একটা অংশ রাখুন।', 'Keep at least one part.')}</p>
      : <div className="nv-rows rd-list">{picked.map((k, i) => <div key={k} className="nv-row" data-section={k}>
          <span className="nv-av rd-no">{n(i + 1)}</span>
          <span className="tx"><b>{staffSectionName(k, lang)}</b><span>{L(info(k)[3], info(k)[4])}</span></span>
          <span className="rd-acts">
            <button type="button" className="secondary sm" aria-label={`${k} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="secondary sm" aria-label={`${k} down`} disabled={i === picked.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="danger sm" aria-label={`${k} remove`} onClick={() => setPicked(x => x.filter(y => y !== k))}>{L('সরান', 'Remove')}</button>
          </span></div>)}</div>}
    <h3 className="rd-h">{L('লুকানো আছে', 'Hidden')} <span className="muted small">({n(rest.length)})</span></h3>
    {!rest.length ? <p className="muted small">{L('সব অংশই পাতায় আছে।', 'Every part is on the page.')}</p>
      : <div className="nv-rows rd-list">{rest.map(k => <div key={k} className="nv-row none" data-section={k}>
          <span className="tx"><b>{staffSectionName(k, lang)}</b><span>{L(info(k)[3], info(k)[4])}</span></span>
          <span className="rd-acts"><button type="button" className="sm" aria-label={`${k} add`} onClick={() => setPicked(x => [...x, k])}>+ {L('যোগ করুন', 'Add')}</button></span></div>)}</div>}
    <p className="muted small">{L('অংশ রাখলেও কেউ শুধু ততটুকুই দেখবেন যতটুকু তাঁর অনুমতি আছে।', 'A part still shows only what the person may see.')}</p>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
