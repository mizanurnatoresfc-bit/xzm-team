// Create or change one role: its names, what it may do (module → sub-menu → view / create / edit / delete /
// approve / export) and which pages it gets in the menu. Only the Super Admin saves; the database checks it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Badge, Field, Modal, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { menuApi } from '../../lib/menu'
import { roles, type RoleRow } from '../../lib/roles'
import { userFriendly } from '../../lib/users'
import { accessFriendly } from '../../lib/access'
import { pagesOf, presetCodes, PRESETS, type Mod, type Preset } from '../../lib/accessCatalog'
import { DetailMatrix, isSuperGrant, PermGrid, permName, roleName, useAccessBase, type Mark } from './common'

type Snap = { name: string; name_bn: string; description: string; sel: Set<string>; limit: boolean; pages: Set<string>; active: boolean }
const EMPTY = { name: '', name_bn: '', description: '' }
// The older role page (still used inside the Android app) and this one are the same sub-menu: keep both on a page list together.
const OLD_PAGE = '/app/roles', NEW_PAGE = '/app/access'
const withTwin = (list: string[]) => (list.includes(NEW_PAGE) && !list.includes(OLD_PAGE) ? [...list, OLD_PAGE] : list)

export function RoleBuilder() {
  const { id = 'new' } = useParams()
  const [sp] = useSearchParams()
  const copyId = sp.get('copy')
  const { grants, refreshGrants } = useAuth()
  const { L, n, lang } = usePrefs()
  const nav = useNavigate()
  const { toast, node } = useToast()
  const base = useAccessBase(id)
  const isNew = id === 'new'
  const role: RoleRow | null = isNew ? null : base.roleById[id] ?? null
  const sup = isSuperGrant(grants)
  const ready = !!base.data
  const canEdit = ready && sup && !role?.is_super && !role?.archived_at
  const perms = base.data?.perms
  const allCodes = useMemo(() => (perms ?? []).map(p => p.code), [perms])

  const [f, setF] = useState(EMPTY)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [limit, setLimit] = useState(false)
  const [pages, setPages] = useState<Set<string>>(new Set())
  const [active, setActive] = useState(true)
  const [saved, setSaved] = useState<Snap | null>(null)
  const [view, setView] = useState<'menu' | 'detail'>('menu')
  const [q, setQ] = useState('')
  const [review, setReview] = useState(false)
  const [archive, setArchive] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  /** A message that has to survive the reload after a save that only half worked. */
  const carry = useRef('')

  useEffect(() => {
    if (!base.data) return
    const src = role ?? (isNew && copyId ? base.roleById[copyId] ?? null : null)
    const list = src ? pagesOf(base.menuByRole[src.id]) : null
    if (list?.has(OLD_PAGE)) list.add(NEW_PAGE)
    const next: Snap = {
      name: role ? role.name : src ? `${src.name} copy` : '', name_bn: role ? role.name_bn ?? '' : src?.name_bn ? `${src.name_bn} (কপি)` : '',
      description: (role ?? src)?.description ?? '',
      sel: new Set(src ? (src.is_super ? allCodes : src.permissions) : []),
      limit: list !== null, pages: list ?? new Set(base.catalog.pages), active: role ? role.status === 'active' : true }
    setF({ name: next.name, name_bn: next.name_bn, description: next.description })
    setSel(next.sel); setLimit(next.limit); setPages(next.pages); setActive(next.active)
    // a new role starts from nothing, so everything ticked counts as a change
    setSaved(role ? next : { ...EMPTY, sel: new Set(), limit: false, pages: new Set(base.catalog.pages), active: true })
    setErr(carry.current); carry.current = ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.data, role?.id, copyId])

  const diff = useMemo(() => {
    if (!saved) return null
    const added = [...sel].filter(c => !saved.sel.has(c)).sort(), removed = [...saved.sel].filter(c => !sel.has(c)).sort()
    const now = limit ? pages : null, was = saved.limit ? saved.pages : null
    const known = base.catalog.pages
    const pageOff = now ? known.filter(p => !now.has(p) && (!was || was.has(p))) : []
    const pageOn = was ? known.filter(p => !was.has(p) && (!now || now.has(p))) : []
    const pagesChanged = limit !== saved.limit || pageOff.length > 0 || pageOn.length > 0
    const meta = f.name.trim() !== saved.name || f.name_bn.trim() !== saved.name_bn || f.description.trim() !== saved.description
    const status = active !== saved.active
    return { added, removed, pageOn, pageOff, pagesChanged, meta, status, any: added.length + removed.length > 0 || pagesChanged || meta || status }
  }, [saved, sel, limit, pages, f, active, base.catalog.pages])

  const toggle = (codes: string[], on: boolean) => { setSel(s => { const x = new Set(s); codes.forEach(c => (on ? x.add(c) : x.delete(c))); return x }) }
  /** Sets a module (or everything) to a ready-made level: what the level includes goes on, the rest of that module goes off. */
  const applyPreset = (m: Mod | null, p: Preset) => {
    const subs = m ? m.subs : base.catalog.mods.flatMap(x => x.subs)
    const reach = m ? subs.flatMap(s => s.codes) : allCodes, on = new Set(presetCodes(subs, p))
    setSel(s => { const x = new Set(s); reach.forEach(c => (on.has(c) ? x.add(c) : x.delete(c))); return x })
  }
  const togglePage = (to: string, on: boolean) => setPages(p => { const x = new Set(p); if (on) x.add(to); else x.delete(to); return x })
  const copyFrom = (rid: string) => { const r = base.roleById[rid]; if (r) setSel(new Set(r.is_super ? allCodes : r.permissions)) }
  const reset = () => { if (!saved) return; setF({ name: saved.name, name_bn: saved.name_bn, description: saved.description }); setSel(new Set(saved.sel)); setLimit(saved.limit); setPages(new Set(saved.pages)); setActive(saved.active) }
  // boxes changed since the last save carry a + or −
  const mark = (code: string): Mark => (!saved || isNew ? null : sel.has(code) && !saved.sel.has(code) ? 'plus' : !sel.has(code) && saved.sel.has(code) ? 'minus' : null)

  async function save() {
    setErr('')
    const name = f.name.trim() || f.name_bn.trim()
    if (!name) { setReview(false); return setErr(L('রোলের নাম দিন', 'Enter the role name')) }
    setBusy(true)
    let rid: string | null = null
    try {
      rid = await roles.save(isNew ? null : id, name, f.name_bn.trim(), f.description.trim(), [...sel])
      if (diff?.pagesChanged) await menuApi.save(rid, limit ? withTwin([...pages]) : null)
      if (!isNew && diff?.status) await roles.setStatus(rid, active)
      await refreshGrants().catch(() => undefined)
      toast(L('রোল সেভ হয়েছে', 'Role saved')); setReview(false)
      if (isNew) nav(`/app/access/role/${rid}`, { replace: true }); else void base.reload()
    } catch (e) {
      setReview(false)
      const msg = accessFriendly(e, userFriendly)
      if (!rid) setErr(msg)
      else {
        // names and permissions went in, a later step (pages / on-off) did not: show what is really saved, and say so
        carry.current = L(`নাম ও অনুমতি সেভ হয়েছে, কিন্তু পাতা বা চালু/বন্ধ সেভ হয়নি — আবার করুন। (${msg})`, `Names and permissions were saved, but the pages or the on/off switch were not — please do that part again. (${msg})`)
        if (isNew) nav(`/app/access/role/${rid}`, { replace: true }); else void base.reload()
      }
    } finally { setBusy(false) }
  }

  const title = isNew ? L('নতুন রোল', 'New role') : role ? roleName(role, lang) : L('রোল', 'Role')
  const back = <Link to="/app/access/roles">← {L('রোল তালিকা', 'Roles')}</Link>
  if (!isNew && base.data && !role) return <AppShell title={title} subtitle={back}><p className="muted">{L('রোল পাওয়া যায়নি।', 'Role not found.')}</p></AppShell>
  const has = (c: string) => sel.has(c)
  const pageName = (to: string) => { const s = base.catalog.subByKey[to]; return s ? L(s.bn, s.en) : to }

  return <AppShell title={title} subtitle={back}
    actions={canEdit ? <>
      {role && !role.is_system && <button className="danger" onClick={() => setArchive(true)}>{L('আর্কাইভ', 'Archive')}</button>}
      {role && <button className="secondary" onClick={() => nav(`/app/access/role/new?copy=${role.id}`)}><Icon name="plus" size={15} />{L('কপি করে নতুন রোল', 'Copy to a new role')}</button>}
      <button disabled={busy || !diff?.any} onClick={() => setReview(true)}><Icon name="save" size={15} />{L('সেভ করুন', 'Save')}</button>
    </> : null}>
    {node}
    {base.error ? <p className="da-error">{accessFriendly(base.error, userFriendly)}</p> : null}
    {role?.is_super && <p className="notice">{L('সুপার অ্যাডমিনের সব অনুমতি সবসময় থাকে, সব জায়গায় — এটা কমানো বা বদলানো যায় না।', 'The Super Admin always has every permission, everywhere; it cannot be reduced or changed.')}</p>}
    {role?.archived_at && <p className="notice">{L('এই রোল আর্কাইভ করা — আর কাউকে দেওয়া যাবে না।', 'This role is archived and cannot be given to anyone.')}</p>}
    {!sup && <p className="notice">{L('শুধু দেখতে পারছেন — রোল বানানো বা বদলানো শুধু সুপার অ্যাডমিন পারেন।', 'View only — only the Super Admin can create or change roles.')}</p>}
    {err && <p className="da-error" role="alert">{err}</p>}

    {!ready && !base.error && <p className="page-loading" role="status"><span className="spin" />{L('লোড হচ্ছে…', 'Loading…')}</p>}
    {ready && <section className="panel ax-role-head">
      <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        <Field label={L('রোলের নাম (বাংলা)', 'Role name (Bangla)')} hint={isNew ? L('যেমন: হাব ক্যাশিয়ার', 'e.g. হাব ক্যাশিয়ার') : undefined}>
          <input value={f.name_bn} disabled={!canEdit} onChange={e => setF({ ...f, name_bn: e.target.value })} /></Field>
        <Field label={L('রোলের নাম (ইংরেজি)', 'Role name (English)')} hint={isNew ? L('খালি রাখলে বাংলা নামই বসবে', 'Left empty, the Bangla name is used') : undefined}>
          <input value={f.name} disabled={!canEdit} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Hub Cashier" /></Field>
        <Field wide label={L('এই রোল কী কাজের জন্য', 'What this role is for')}><input value={f.description} disabled={!canEdit} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      {role && <p className="ax-facts">
        {role.is_super ? <Badge tone="bad">{L('সব ক্ষমতা', 'Full control')}</Badge> : role.is_system ? <Badge tone="neutral">{L('শুরুর রোল', 'Built-in')}</Badge> : <Badge tone="info">{L('নিজের বানানো', 'Custom')}</Badge>}
        {!active && <Badge tone="warn">{L('বন্ধ রাখা', 'Switched off')}</Badge>}
        <Link to={`/app/access/users?role=${role.id}`}>{n(role.user_count)} {L('জন ইউজারের এই রোল আছে', 'users hold this role')} →</Link>
        {canEdit && !role.is_system && <label className="da-check ax-switch"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          {L('রোল চালু (টিক তুললে যাঁদের এই রোল আছে তাঁরা এর অনুমতি সাময়িকভাবে হারাবেন)', 'Role is on (untick to switch it off for a while: its holders lose what it gives)')}</label>}
      </p>}
    </section>}

    {ready && <section className="panel">
      <div className="da-bar ax-tools">
        <div className="da-seg" role="group" aria-label={L('ভিউ', 'View')}>
          <button type="button" className={view === 'menu' ? '' : 'secondary'} aria-pressed={view === 'menu'} onClick={() => setView('menu')}><Icon name="grid" size={15} />{L('মডিউল ও সাব-মেনু', 'Modules & sub-menus')}</button>
          <button type="button" className={view === 'detail' ? '' : 'secondary'} aria-pressed={view === 'detail'} onClick={() => setView('detail')}><Icon name="table" size={15} />{L('সব অনুমতি (বিস্তারিত)', 'Every permission (detail)')}</button>
        </div>
        <input type="search" className="ax-search" placeholder={L('মডিউল, সাব-মেনু বা অনুমতি খুঁজুন…', 'Search module, sub-menu or permission…')} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <p className="ax-count"><b>{n(sel.size)}</b>/{n(allCodes.length)} {L('টি অনুমতি দেওয়া', 'permissions given')}
        {!sup ? null : limit ? <> · <b>{n(base.catalog.pages.filter(p => pages.has(p)).length)}</b>/{n(base.catalog.pages.length)} {L('টি পাতা চালু', 'pages on')}</> : <> · {L('সব পাতা (অনুমতি অনুযায়ী)', 'every page (by permission)')}</>}</p>

      {canEdit && <div className="ax-quick">
        <span className="muted small">{L('পুরো রোল এক চাপে:', 'Whole role in one tap:')}</span>
        {PRESETS.map(([p, bn, en, nb, ne]) => <button key={p} type="button" className="secondary sm" title={L(nb, ne)} onClick={() => applyPreset(null, p)}>{L(bn, en)}</button>)}
        <select className="ax-copy" value="" aria-label={L('অন্য রোল থেকে কপি', 'Copy from another role')} onChange={e => e.target.value && copyFrom(e.target.value)}>
          <option value="">{L('অন্য রোলের মতো করুন…', 'Make it like another role…')}</option>
          {(base.data?.list ?? []).filter(r => !r.archived_at && r.id !== role?.id).map(r => <option key={r.id} value={r.id}>{roleName(r, lang)}</option>)}</select>
      </div>}

      {view === 'menu' && <>
        {sup && <div className="ax-pagemode">
          <div className="da-seg" role="group" aria-label={L('পাতার সীমা', 'Page limit')}>
            <button type="button" className={limit ? 'secondary' : ''} aria-pressed={!limit} disabled={!canEdit} onClick={() => setLimit(false)}>{L('সব পাতা (সীমা নেই)', 'Every page (no limit)')}</button>
            <button type="button" className={limit ? '' : 'secondary'} aria-pressed={limit} disabled={!canEdit} onClick={() => setLimit(true)}>{L('শুধু টিক দেওয়া পাতা', 'Only the ticked pages')}</button>
          </div>
          <span className="muted small">{limit ? L('“পাতা” ঘরে টিক থাকলে তবেই সাব-মেনুটি মেনুতে আসবে; টিক না থাকলে ঠিকানা লিখেও খুলবে না।', 'A sub-menu is in the menu only when its “Page” box is ticked; unticked, it does not open even by its address.')
            : L('অনুমতি থাকলেই সাব-মেনু মেনুতে আসে। নির্দিষ্ট কিছু পাতা লুকাতে “শুধু টিক দেওয়া পাতা” বাছুন।', 'A sub-menu shows whenever the permission is there. Choose “Only the ticked pages” to hide some of them.')}</span>
        </div>}
        <p className="ax-legend"><span><i className="ax-box s-all sample"><Icon name="check" size={13} /></i>{L('আছে', 'given')}</span><span><i className="ax-box s-some sample"><span className="ax-dash" /></i>{L('কিছু আছে', 'partly')}</span>
          <span><i className="ax-box s-none linked sample" />{L('নিচে দাগ = একই তথ্য অন্য সাব-মেনুতেও, একসাথে বদলায়', 'underline = shared with another sub-menu, changes together')}</span>
          {!isNew && <span><i className="ax-box s-all m-plus sample"><i className="ax-mk">+</i></i><i className="ax-box s-none m-minus sample"><i className="ax-mk">−</i></i>{L('সেভ না করা বদল', 'unsaved change')}</span>}</p>
        <PermGrid catalog={base.catalog} has={has} onToggle={canEdit ? toggle : undefined} mark={mark} q={q}
          pages={sup ? { list: limit ? pages : null, onToggle: canEdit ? togglePage : undefined } : null}
          tools={canEdit ? m => <>
            <select className="ax-preset" value="" aria-label={`${L(m.bn, m.en)}: ${L('দ্রুত সেট', 'quick set')}`} onChange={e => e.target.value && applyPreset(m, e.target.value as Preset)}>
              <option value="">{L('পুরো মডিউল…', 'Whole module…')}</option>{PRESETS.map(([p, bn, en]) => <option key={p} value={p}>{L(bn, en)}</option>)}</select>
            {limit && m.pages.length > 0 && <button type="button" className="secondary sm" onClick={() => { const all = m.pages.every(p => pages.has(p)); setPages(s => { const x = new Set(s); m.pages.forEach(p => (all ? x.delete(p) : x.add(p))); return x }) }}>
              {m.pages.every(p => pages.has(p)) ? L('সব পাতা বন্ধ', 'All pages off') : L('সব পাতা চালু', 'All pages on')}</button>}
          </> : undefined} />
      </>}
      {view === 'detail' && <>
        <p className="muted small">{L('এখানে প্রতিটি অনুমতি আলাদা করে দেওয়া বা তোলা যায় (যেমন অনুমোদন আর বাতিল আলাদা)। জোন/হাবের রোলে অনুমতি শুধু সেই জোন/হাবের তথ্যে খাটে।',
          'Every single permission can be given or taken here (approve and reject separately, for example). For zone/hub roles a permission applies only to that zone/hub.')}</p>
        <DetailMatrix perms={base.data?.perms ?? []} has={has} onToggle={canEdit ? toggle : undefined} mark={mark} q={q} />
      </>}
    </section>}

    {canEdit && diff?.any && <div className="ax-savebar no-print" role="status">
      <span className="tx">{L('সেভ হয়নি:', 'Not saved:')} {diff.added.length > 0 && <b className="plus">+{n(diff.added.length)}</b>} {diff.removed.length > 0 && <b className="minus">−{n(diff.removed.length)}</b>}
        {diff.pagesChanged && <span> · {L('পাতা বদল', 'pages changed')}</span>}{(diff.meta || diff.status) && <span> · {L('রোলের তথ্য', 'role details')}</span>}</span>
      {!isNew && <button type="button" className="secondary sm" onClick={reset}>{L('বদল বাদ দিন', 'Discard')}</button>}
      <button type="button" className="sm" disabled={busy} onClick={() => setReview(true)}>{L('দেখে সেভ করুন', 'Review & save')}</button>
    </div>}

    {review && diff && <Modal wide title={L('সেভ করার আগে দেখে নিন', 'Check before saving')} onClose={() => setReview(false)}
      actions={<><button className="secondary" onClick={() => setReview(false)}>{L('ফিরে যান', 'Back')}</button>
        <button disabled={busy} onClick={() => void save()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('ঠিক আছে, সেভ করুন', 'Yes, save')}</button></>}>
      <p><b>{f.name_bn.trim() || f.name.trim() || L('(নাম নেই)', '(no name)')}</b>{role ? <> — {L(`এই রোল ${n(role.user_count)} জনের আছে; সেভ করলে তাঁদের সবার জন্য সাথে সাথে বদলাবে।`, `${role.user_count} people hold this role; saving changes it for all of them at once.`)}</> : null}</p>
      {diff.status && <p className="notice">{active ? L('রোল আবার চালু হবে।', 'The role will be switched on again.') : L('রোল বন্ধ হবে — যাঁদের শুধু এই রোল আছে তাঁরা কিছুই দেখতে পাবেন না।', 'The role will be switched off — people who hold only this role will see nothing.')}</p>}
      <div className="ax-review">
        <div><h3 className="plus">+ {L('নতুন দেওয়া হচ্ছে', 'Being given')} ({n(diff.added.length)})</h3>
          {diff.added.length ? <ul>{diff.added.map(c => <li key={c}>{permName(base.catalog.byCode[c], c, lang)}</li>)}</ul> : <p className="muted small">{L('কিছু না', 'Nothing')}</p>}</div>
        <div><h3 className="minus">− {L('তুলে নেওয়া হচ্ছে', 'Being taken away')} ({n(diff.removed.length)})</h3>
          {diff.removed.length ? <ul>{diff.removed.map(c => <li key={c}>{permName(base.catalog.byCode[c], c, lang)}</li>)}</ul> : <p className="muted small">{L('কিছু না', 'Nothing')}</p>}</div>
      </div>
      {diff.pagesChanged && <div className="ax-review-pages"><h3>{L('পাতা (সাব-মেনু)', 'Pages (sub-menus)')}</h3>
        {limit !== (saved?.limit ?? false) && <p>{limit ? L('এখন থেকে শুধু টিক দেওয়া পাতাগুলো এই রোল পাবে।', 'From now on this role gets only the ticked pages.') : L('পাতার সীমা তুলে দেওয়া হচ্ছে — অনুমতি থাকলেই সব পাতা আসবে।', 'The page limit is being removed — every page the permissions allow will show.')}</p>}
        {diff.pageOff.length > 0 && <p><b className="minus">{L('বন্ধ হচ্ছে:', 'Switched off:')}</b> {diff.pageOff.map(pageName).join(' · ')}</p>}
        {diff.pageOn.length > 0 && <p><b className="plus">{L('চালু হচ্ছে:', 'Switched on:')}</b> {diff.pageOn.map(pageName).join(' · ')}</p>}</div>}
      {!sel.size && <p className="notice">{L('কোনো অনুমতি নেই — এই রোলের লোক লগইন করে শুধু নিজের প্যানেল দেখবে।', 'No permissions — people with this role only see their own panel.')}</p>}
    </Modal>}

    {archive && role && <ArchiveRole role={role} onClose={() => setArchive(false)} onDone={() => nav('/app/access/roles')} />}
  </AppShell>
}

function ArchiveRole({ role, onClose, onDone }: { role: RoleRow; onClose: () => void; onDone: () => void }) {
  const { L } = usePrefs()
  const [reason, setReason] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    if (!reason.trim()) return setErr(L('কারণ লিখুন', 'Enter a reason'))
    setBusy(true); setErr('')
    try { await roles.archive(role.id, reason.trim()); onDone() } catch (e) { setErr(userFriendly(e)) } finally { setBusy(false) }
  }
  return <Modal title={L('রোল আর্কাইভ করবেন?', 'Archive this role?')} onClose={onClose}
    actions={<><button className="secondary" onClick={onClose}>{L('বাতিল', 'Cancel')}</button><button className="danger" disabled={busy} onClick={() => void go()}>{L('আর্কাইভ', 'Archive')}</button></>}>
    <p className="muted small">{L('যাঁদের এই রোল আছে, আগে তাঁদের থেকে সরাতে হবে। আর্কাইভ করা রোল ইতিহাসে থেকে যায়।', 'Remove it from every user first. Archived roles stay in the history.')}</p>
    <Field label={L('কারণ', 'Reason')}><input value={reason} onChange={e => setReason(e.target.value)} /></Field>
    {err && <p className="da-error">{err}</p>}
  </Modal>
}
