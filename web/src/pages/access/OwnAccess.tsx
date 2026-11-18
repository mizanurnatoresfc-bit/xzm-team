// What one person can do in the end — and their own permissions: something extra on top of the roles (+), or
// something the roles give that is switched off for this person (−). The grid shows the end result; a box that
// differs from the roles carries a + or −. Only the Super Admin changes it; the database applies it everywhere.
import { useMemo, useState } from 'react'
import { DataTable } from '../../components/DataTable'
import { Icon } from '../../components/Icon'
import { Badge, Field } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { access, accessFriendly, effectiveOf, type Effective, type Override, type OverridePlace, type UserGrant } from '../../lib/access'
import { userFriendly, type UserRow } from '../../lib/users'
import { useOrg } from '../hr/common'
import { DetailMatrix, moduleName, NotInstalled, PermGrid, permName, PLACE_LABEL, placeText, roleName, useAccessBase, type Mark } from './common'

type Draft = { permission: string; effect: 'grant' | 'deny'; scope_type: OverridePlace; zone_id: string | null; hub_id: string | null; valid_to: string | null }
const dkey = (d: Draft) => `${d.permission}|${d.effect}|${d.scope_type}|${d.zone_id ?? ''}|${d.hub_id ?? ''}|${d.valid_to ?? ''}`
const toDraft = (o: Override): Draft => ({ permission: o.permission, effect: o.effect, scope_type: o.scope_type, zone_id: o.zone_id, hub_id: o.hub_id, valid_to: o.valid_to })
const dhaka = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })

export function OwnAccess({ u, base, rows, loading, dbGrants, sup, self, targetSuper, onSaved, onPreview }: {
  u: UserRow; base: ReturnType<typeof useAccessBase>
  /** every personal permission of this person, taken back ones included; null = the database part is not installed */
  rows: Override[] | null; loading: boolean
  /** the database's own answer for what this person holds (null = not available) */
  dbGrants: UserGrant[] | null
  sup: boolean; self: boolean; targetSuper: boolean
  onSaved: (msg: string) => void; onPreview?: (codes: string[]) => void
}) {
  const { L, n, lang } = usePrefs()
  const o = useOrg()
  const perms = base.data?.perms
  const allCodes = useMemo(() => (perms ?? []).map(p => p.code), [perms])
  const installed = rows !== null
  const today = dhaka()
  const liveRows = useMemo(() => (rows ?? []).filter(x => !x.revoked_at && x.live), [rows])
  const ended = (rows ?? []).filter(x => !x.revoked_at && !x.live)
  const past = (rows ?? []).filter(x => x.revoked_at)

  // what the roles alone give
  const roleCodes = useMemo(() => {
    const s = new Set<string>()
    for (const g of u.roles) { const r = base.roleById[g.role_id]; if (!r || r.status !== 'active' || r.archived_at) continue; (r.is_super ? allCodes : r.permissions).forEach(c => s.add(c)) }
    return s
  }, [u.roles, base.roleById, allCodes])

  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState<Draft[]>([])
  const [place, setPlace] = useState<{ scope: OverridePlace; zone: string; hub: string }>({ scope: 'role', zone: '', hub: '' })
  const [until, setUntil] = useState(''); const [reason, setReason] = useState('')
  const [view, setView] = useState<'menu' | 'detail' | 'list'>('menu')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')

  const items: Draft[] = edit ? draft : liveRows.map(toDraft)
  const plus = useMemo(() => new Set(items.filter(i => i.effect === 'grant').map(i => i.permission)), [items])
  const minus = useMemo(() => new Set(items.filter(i => i.effect === 'deny').map(i => i.permission)), [items])
  // while only looking, the database's own answer decides; while changing, the draft does
  const dbCodes = useMemo(() => (dbGrants && !dbGrants.some(g => g.is_super) ? new Set(dbGrants.map(g => g.permission_code).filter(Boolean) as string[]) : null), [dbGrants])
  const has = (c: string) => targetSuper || (!edit && dbCodes ? dbCodes.has(c) : !minus.has(c) && (roleCodes.has(c) || plus.has(c)))
  const mark = (c: string): Mark => (targetSuper ? null : minus.has(c) ? 'minus' : plus.has(c) ? 'plus' : null)
  const heldCodes = allCodes.filter(has)
  const zoneName = (id: string | null) => (id ? o.names.zone[id] ?? '—' : null), hubName = (id: string | null) => (id ? o.names.hub[id] ?? '—' : null)
  const dirty = edit && (draft.length !== liveRows.length || new Set([...draft.map(dkey), ...liveRows.map(x => dkey(toDraft(x)))]).size !== draft.length)

  function toggle(codes: string[], on: boolean) {
    setErr('')
    if (on && codes.some(c => !roleCodes.has(c)) && ((place.scope === 'zone' && !place.zone) || (place.scope === 'hub' && !place.hub)))
      return setErr(L('আগে উপরে জোন বা হাব বেছে নিন — বাড়তি অনুমতি কোথায় খাটবে।', 'First choose the zone or hub above — where the extra permission applies.'))
    setDraft(d => {
      let x = [...d]
      for (const c of codes) {
        if (on) {
          x = x.filter(i => !(i.permission === c && i.effect === 'deny'))
          if (!roleCodes.has(c) && !x.some(i => i.permission === c && i.effect === 'grant'))
            x.push({ permission: c, effect: 'grant', scope_type: place.scope, zone_id: place.scope === 'zone' ? place.zone : null, hub_id: place.scope === 'hub' ? place.hub : null, valid_to: until || null })
        } else {
          x = x.filter(i => !(i.permission === c && i.effect === 'grant'))
          if (roleCodes.has(c) && !x.some(i => i.permission === c && i.effect === 'deny'))
            x.push({ permission: c, effect: 'deny', scope_type: 'global', zone_id: null, hub_id: null, valid_to: until || null })
        }
      }
      return x
    })
  }
  const start = () => { setDraft(liveRows.map(toDraft)); setReason(''); setErr(''); setEdit(true) }
  async function save() {
    setErr('')
    if (!reason.trim()) return setErr(L('কারণ লিখুন — কেন এই ইউজারের জন্য আলাদা করা হচ্ছে', 'Enter a reason — why this person differs'))
    setBusy(true)
    try {
      const r = await access.saveOverrides(u.id, draft, reason.trim())
      setEdit(false); setReason('')
      document.getElementById('own')?.scrollIntoView({ block: 'start' })
      onSaved(L(`সেভ হয়েছে — নতুন ${n(r.added)}টি, তুলে নেওয়া ${n(r.removed)}টি`, `Saved — ${r.added} added, ${r.removed} taken back`))
    } catch (e) { setErr(accessFriendly(e, userFriendly)) } finally { setBusy(false) }
  }

  // the list view: where each permission works and where it comes from
  // what differs from the roles comes first: switched off, then extra, then everything the roles give
  const rank = (e: Effective) => (e.denied ? 0 : e.sources.some(x => x.kind === 'personal') ? 1 : 2)
  const effective = useMemo(() => effectiveOf(u.roles, base.roleById,
    items.map(i => ({ ...i, zone: zoneName(i.zone_id), hub: hubName(i.hub_id), live: true })), allCodes).list.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [u.roles, base.roleById, items, allCodes, o.names])
  const srcText = (e: Effective) => (e.denied ? L('এই ইউজারের জন্য বন্ধ করা', 'Switched off for this person')
    : e.sources.map(s => (s.kind === 'role' ? roleName(base.roleById[s.role], lang) : L('ব্যক্তিগত (বাড়তি)', 'Personal (extra)'))).join(' + '))
  const itemPlace = (i: Draft) => (i.effect === 'deny' ? L('সব জায়গায়', 'Everywhere') : placeText({ scope_type: i.scope_type, zone: zoneName(i.zone_id), hub: hubName(i.hub_id) }, L))

  return <section className="panel" id="own">
    <div className="da-bar"><h2 style={{ margin: 0 }}>{L('এই ইউজার যা করতে পারেন', 'What this person can do')}</h2>
      <span className="da-actions">
        {onPreview && !edit && <button type="button" className="secondary sm" onClick={() => onPreview(heldCodes)}><Icon name="eye" size={15} />{L('এই ইউজার যেভাবে দেখে', 'See it as this person')}</button>}
        {sup && installed && !targetSuper && !self && !edit && base.data && <button type="button" className="sm" data-own-edit onClick={start}><Icon name="edit" size={15} />{L('আলাদা অনুমতি দিন / বন্ধ করুন', 'Give or switch off for this person')}</button>}</span></div>
    {!installed && !loading && <NotInstalled />}
    {targetSuper ? <p className="notice">{L('সুপার অ্যাডমিনের সব অনুমতি সবসময় থাকে, সব জায়গায়। তাঁর জন্য আলাদা করে কিছু দেওয়া বা বন্ধ করা যায় না।', 'A Super Admin always holds every permission, everywhere. Nothing can be given to or taken from one.')}</p>
      : <p className="muted small">{L('রোল যা দেয় তার সাথে এই ইউজারের নিজের বাড়তি (+) আর বন্ধ করা (−) অনুমতি মিলিয়ে শেষ ফল। বন্ধ করা অনুমতি সব জায়গায় বন্ধ থাকে; বাড়তি অনুমতি রোলের জায়গায়, বা বাছা জোন/হাবে খাটে।',
        'The end result: what the roles give, plus this person’s own extras (+) and what is switched off for them (−). A switched-off permission is off everywhere; an extra applies where the roles work, or at a chosen zone / hub.')}</p>}

    {!targetSuper && items.length > 0 && <div className="ax-ownlist" data-own-list>
      {items.map(i => <span key={dkey(i)} className={`ax-ownchip ${i.effect === 'grant' ? 'plus' : 'minus'}`} title={i.permission}>
        <b>{i.effect === 'grant' ? '+' : '−'}</b>{permName(base.catalog.byCode[i.permission], i.permission, lang)}
        <small>{itemPlace(i)}{i.valid_to ? ` · ${L('পর্যন্ত', 'until')} ${i.valid_to}` : ''}</small>
        {edit && <button type="button" className="link" aria-label={L('ফিরিয়ে নিন', 'Take back')} onClick={() => setDraft(d => d.filter(x => dkey(x) !== dkey(i)))}><Icon name="x" size={14} /></button>}</span>)}
    </div>}

    {edit && <div className="ax-ownedit">
      <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))' }}>
        <Field label={L('বাড়তি অনুমতি কোথায় খাটবে', 'Where an extra permission applies')}>
          <select value={place.scope} onChange={e => setPlace({ scope: e.target.value as OverridePlace, zone: '', hub: '' })}>
            {(['role', 'global', 'zone', 'hub'] as OverridePlace[]).map(k => <option key={k} value={k}>{k === 'zone' ? L('একটি জোনে', 'One zone') : k === 'hub' ? L('একটি হাবে', 'One hub') : L(...PLACE_LABEL[k])}</option>)}</select></Field>
        {place.scope === 'zone' && <Field label={L('জোন', 'Zone')}><select value={place.zone} onChange={e => setPlace({ ...place, zone: e.target.value })}><option value="">{L('বেছে নিন…', 'Choose…')}</option>
          {o.data?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>}
        {place.scope === 'hub' && <Field label={L('হাব', 'Hub')}><select value={place.hub} onChange={e => setPlace({ ...place, hub: e.target.value })}><option value="">{L('বেছে নিন…', 'Choose…')}</option>
          {o.data?.hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>}
        <Field label={L('মেয়াদ (ঐচ্ছিক)', 'Until (optional)')} hint={L('এই তারিখের পর নিজে থেকেই বন্ধ হবে', 'Ends by itself after this date')}><input type="date" min={today} value={until} onChange={e => setUntil(e.target.value)} /></Field>
      </div>
      <p className="muted small">{L('নিচে টিক দিন বা তুলুন: রোলে নেই এমন ঘরে টিক দিলে “বাড়তি” (+), রোলে আছে এমন ঘরের টিক তুললে এই ইউজারের জন্য “বন্ধ” (−) হবে। উপরের জায়গা ও মেয়াদ নতুন টিকে বসবে।',
        'Tick or untick below: ticking a box the roles do not give makes an “extra” (+); unticking one the roles give switches it “off” (−) for this person. The place and date above go on the new ticks.')}</p>
    </div>}

    {!targetSuper && !base.data && <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>}
    {!targetSuper && base.data && <>
      <div className="da-bar ax-tools">
        <div className="da-seg" role="group" aria-label={L('ভিউ', 'View')}>
          <button type="button" className={view === 'menu' ? '' : 'secondary'} aria-pressed={view === 'menu'} onClick={() => setView('menu')}><Icon name="grid" size={15} />{L('মডিউল ও সাব-মেনু', 'Modules & sub-menus')}</button>
          <button type="button" className={view === 'detail' ? '' : 'secondary'} aria-pressed={view === 'detail'} onClick={() => setView('detail')}><Icon name="table" size={15} />{L('সব অনুমতি', 'Every permission')}</button>
          {!edit && <button type="button" className={view === 'list' ? '' : 'secondary'} aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="menu" size={15} />{L('কোথায় ও কোথা থেকে', 'Where & from what')}</button>}
        </div>
        {view !== 'list' && <input type="search" className="ax-search" placeholder={L('খুঁজুন…', 'Search…')} value={q} onChange={e => setQ(e.target.value)} />}
      </div>
      <p className="ax-count"><b>{n(heldCodes.length)}</b>/{n(allCodes.length)} {L('টি অনুমতি কার্যকর', 'permissions in force')}{plus.size > 0 && <> · <b className="plus">+{n(plus.size)}</b> {L('বাড়তি', 'extra')}</>}{minus.size > 0 && <> · <b className="minus">−{n(minus.size)}</b> {L('বন্ধ', 'off')}</>}</p>
      {view === 'menu' && <PermGrid catalog={base.catalog} has={has} mark={mark} q={q} onToggle={edit ? toggle : undefined} />}
      {view === 'detail' && <DetailMatrix perms={base.data?.perms ?? []} has={has} mark={mark} q={q} onToggle={edit ? toggle : undefined} />}
      {view === 'list' && !edit && <DataTable<Effective> title={`${u.full_name || u.email || ''} — ${L('কার্যকর অনুমতি', 'permissions in force')}`} file="user-permissions" rows={effective} rowKey={e => e.code} phoneView="list"
        empty={<p className="muted">{L('কোনো অনুমতি নেই।', 'No permissions.')}</p>} cols={[
          { key: 'perm', label: L('অনুমতি', 'Permission'), value: e => permName(base.catalog.byCode[e.code], e.code, lang), render: e => <><strong>{permName(base.catalog.byCode[e.code], e.code, lang)}</strong><span className="sec">{e.code}</span></> },
          { key: 'module', label: L('মডিউল', 'Module'), value: e => moduleName(e.code.split('.')[0], lang) },
          { key: 'where', label: L('কোথায় খাটে', 'Applies at'), value: e => (e.denied ? '—' : e.places.map(p => placeText(p, L)).join(' · ')) },
          { key: 'from', label: L('কোথা থেকে', 'Comes from'), value: srcText, render: e => (e.denied ? <Badge tone="bad">{srcText(e)}</Badge> : e.sources.some(s => s.kind === 'personal') ? <Badge tone="ok">{srcText(e)}</Badge> : <>{srcText(e)}</>) },
        ]} />}
    </>}

    {edit && <div className="ax-savebar inline" role="status">
      <Field label={L('কারণ', 'Reason')} required><input value={reason} onChange={e => setReason(e.target.value)} placeholder={L('যেমন: ম্যানেজার ছুটিতে, ৭ দিন অনুমোদন দেবেন', 'e.g. covers approvals for 7 days while the manager is on leave')} /></Field>
      <span className="acts"><button type="button" className="secondary" disabled={busy} onClick={() => { setEdit(false); setErr('') }}>{L('বাতিল', 'Cancel')}</button>
        <button type="button" disabled={busy || !dirty} data-own-save onClick={() => void save()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ করুন', 'Save')}</button></span>
    </div>}
    {err && <p className="da-error" role="alert">{err}</p>}

    {installed && (ended.length > 0 || past.length > 0) && <details className="ax-past"><summary>{L('আগের আলাদা অনুমতি', 'Earlier personal permissions')} ({n(ended.length + past.length)})</summary>
      <ul>{[...ended, ...past].map(x => <li key={x.id}><b className={x.effect === 'grant' ? 'plus' : 'minus'}>{x.effect === 'grant' ? '+' : '−'}</b> {permName(base.catalog.byCode[x.permission], x.permission, lang)}
        <small> — {x.effect === 'grant' ? placeText(x, L) : L('সব জায়গায়', 'everywhere')} · {L('দিয়েছেন', 'by')} {x.created_by_name ?? '—'} ({x.created_at.slice(0, 10)}): {x.reason}
          {x.revoked_at ? ` · ${L('তুলে নেওয়া', 'taken back')} ${x.revoked_at.slice(0, 10)}${x.revoke_reason ? `: ${x.revoke_reason}` : ''}` : ` · ${L('মেয়াদ শেষ', 'ended')} ${x.valid_to ?? ''}`}</small></li>)}</ul>
    </details>}
  </section>
}
