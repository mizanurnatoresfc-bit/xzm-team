// Shared pieces of the access pages: the catalogue hook, the permission grid (module → sub-menu → six kinds of
// access), the detailed matrix (every single permission) and the hub / zone picker.
import { useMemo, useState, type ReactNode } from 'react'
import { ACCOUNTS, GROUPS, HOME } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { menuApi, type RoleMenu } from '../../lib/menu'
import { ACTION_LABEL, ACTIONS, MODULE_LABEL, RESOURCE_LABEL, roles, type Permission, type RoleRow } from '../../lib/roles'
import { ACTION6, ACTION_KEYS, buildCatalog, cellState, pageShows, type Catalog, type CellState, type MenuEntry, type Mod, type Sub } from '../../lib/accessCatalog'
import type { OverridePlace } from '../../lib/access'
import { useOrg } from '../hr/common'

export const isSuperGrant = (grants: { is_super: boolean; scope_type: string }[]) => grants.some(g => g.is_super && g.scope_type === 'global')
export const roleName = (r: { name: string; name_bn: string | null } | null | undefined, lang: string) => (!r ? '—' : lang === 'bn' && r.name_bn ? r.name_bn : r.name)
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

/** Every entry of the menu, as the catalogue needs it. */
export const menuEntries = (): MenuEntry[] =>
  [...HOME, ...ACCOUNTS.items, ...GROUPS.flatMap(g => g.items)].map(i => ({ to: i.to, bn: i.bn, en: i.en, perms: i.perms }))

/** Roles, permissions and each role's page list, with the catalogue built from them. */
export function useAccessBase(key: unknown = 0) {
  const q = useLoad(async () => {
    const [list, perms, menus] = await Promise.all([roles.list(), roles.permissions(), menuApi.roles().catch(() => [] as RoleMenu[])])
    return { list, perms, menus }
  }, [key])
  const perms = q.data?.perms
  const catalog = useMemo(() => buildCatalog(perms ?? [], menuEntries()), [perms])
  const roleById = useMemo(() => Object.fromEntries((q.data?.list ?? []).map(r => [r.id, r])) as Record<string, RoleRow>, [q.data?.list])
  const menuByRole = useMemo(() => Object.fromEntries((q.data?.menus ?? []).map(m => [m.role_id, m.menu])) as Record<string, string[] | null>, [q.data?.menus])
  return { ...q, catalog, roleById, menuByRole }
}

/** "কর্মী — এডিট" for hr.employee.edit */
export function permName(p: Permission | undefined, code: string, lang: string): string {
  if (!p) return code
  const res = `${p.module}.${p.resource}`
  const thing = lang === 'bn' ? RESOURCE_LABEL[res] ?? pretty(p.resource) : pretty(p.resource)
  const act = ACTION_LABEL[p.action] ? ACTION_LABEL[p.action][lang === 'bn' ? 0 : 1] : p.action
  return `${thing} — ${act}`
}
export const moduleName = (m: string, lang: string) => (MODULE_LABEL[m] ? MODULE_LABEL[m][lang === 'bn' ? 0 : 1] : pretty(m))

// ---------------------------------------------------------------- one box
export type Mark = 'plus' | 'minus' | null

/** A box that is ticked, half ticked or empty; `mark` shows that it differs from what the role gives. */
export function Tri({ state, mark, linked, label, title, onClick, disabled }: {
  state: CellState; mark?: Mark; linked?: boolean; label: string; title?: string; onClick?: () => void; disabled?: boolean }) {
  if (state === 'na') return <span className="ax-na" aria-hidden="true">·</span>
  return <button type="button" role="checkbox" aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false} aria-label={label} title={title}
    className={`ax-box s-${state}${mark ? ` m-${mark}` : ''}${linked ? ' linked' : ''}`} disabled={disabled || !onClick} onClick={onClick}>
    {state === 'all' ? <Icon name="check" size={15} /> : state === 'some' ? <span className="ax-dash" /> : null}
    {mark ? <i className="ax-mk" aria-hidden="true">{mark === 'plus' ? '+' : '−'}</i> : null}
  </button>
}

// ---------------------------------------------------------------- module → sub-menu → six kinds of access
export type PageColumn = { list: Set<string> | null; onToggle?: (to: string, on: boolean) => void }

export function PermGrid({ catalog, has, onToggle, mark, pages, q, tools }: {
  catalog: Catalog
  /** is this permission held (after everything)? */
  has: (code: string) => boolean
  /** leave out for a read-only grid */
  onToggle?: (codes: string[], on: boolean) => void
  mark?: (code: string) => Mark
  /** the "page" column; leave out where pages are not being set */
  pages?: PageColumn | null
  q?: string
  /** quick buttons in a module's heading */
  tools?: (m: Mod) => ReactNode
}) {
  const { L, n, lang } = usePrefs()
  const [shut, setShut] = useState<Record<string, boolean>>({})
  const s = (q ?? '').trim().toLowerCase()
  const hit = (m: Mod, x: Sub) => !s || `${m.bn} ${m.en} ${x.bn} ${x.en} ${x.codes.join(' ')} ${x.tabs.map(t => `${t.bn} ${t.en}`).join(' ')}`.toLowerCase().includes(s)
  const markOf = (codes: string[]): Mark => { if (!mark) return null; const ms = codes.map(mark); return ms.includes('plus') ? 'plus' : ms.includes('minus') ? 'minus' : null }
  const tip = (codes: string[]) => {
    const lines = codes.map(c => `${has(c) ? '✓' : '✗'} ${permName(catalog.byCode[c], c, lang)}  (${c})`)
    const also = [...new Set(codes.flatMap(c => catalog.usedBy[c] ?? []))]
    if (also.length > 1) lines.push('', L('একই অনুমতি এই সারিগুলোতেও আছে — একসাথে বদলায়:', 'The same permission also sits in these rows — they change together:'),
      ...also.map(k => `• ${lang === 'bn' ? catalog.subByKey[k]?.bn : catalog.subByKey[k]?.en}`))
    return lines.join('\n')
  }
  const shownMods = catalog.mods.map(m => ({ m, subs: m.subs.filter(x => hit(m, x)) })).filter(x => x.subs.length)
  if (!shownMods.length) return <p className="muted">{L('এই নামে কিছু পাওয়া যায়নি।', 'Nothing matches.')}</p>

  return <div className={`ax-mods${pages ? '' : ' nopg'}`}>{shownMods.map(({ m, subs }) => {
    const on = m.codes.filter(has).length
    const isShut = !s && (shut[m.key] ?? false)
    const pagesOn = pages ? m.subs.filter(x => x.to && !x.always && pageShows(x, has, pages.list)).length : 0
    return <section key={m.key} className={`ax-mod${isShut ? ' shut' : ''}`} data-module={m.key}>
      <header className="ax-mod-h">
        <button type="button" className="ax-mod-t" aria-expanded={!isShut} onClick={() => setShut(v => ({ ...v, [m.key]: !isShut }))}>
          <span className="ax-mod-i"><Icon name={m.icon} size={18} /></span>
          <span className="tx"><b>{L(m.bn, m.en)}</b>
            <small>{n(on)}/{n(m.codes.length)} {L('অনুমতি', 'permissions')}{pages && m.pages.length ? ` · ${n(pagesOn)}/${n(m.pages.length)} ${L('পাতা মেনুতে', 'pages in menu')}` : ''}</small></span>
          <span className="ax-bar" aria-hidden="true"><i style={{ width: `${m.codes.length ? Math.round(on * 100 / m.codes.length) : 0}%` }} /></span>
          <Icon name="chev" size={16} className="ax-chev" />
        </button>
        {tools && !isShut ? <div className="ax-mod-tools">{tools(m)}</div> : null}
      </header>
      {!isShut && <div className="ax-grid">
        <div className="ax-row ax-head" aria-hidden="true">
          <span className="ax-name">{L('সাব-মেনু', 'Sub-menu')}</span>
          {pages && <span className="ax-pg">{L('পাতা', 'Page')}</span>}
          {ACTION_KEYS.map(k => <span key={k} className="ax-c" title={L(ACTION6[k].note_bn, ACTION6[k].note_en)}>{L(ACTION6[k].bn, ACTION6[k].en)}</span>)}
        </div>
        {subs.map(x => {
          const name = L(x.bn, x.en)
          const rowState = cellState(x.codes, has)
          const shows = pages && x.to ? pageShows(x, has, pages.list) : false
          const inList = !!x.to && (!pages?.list || pages.list.has(x.to))
          const why = !x.to ? L('আলাদা পাতা নেই', 'No page of its own')
            : x.always ? L('সবার জন্য সবসময় খোলা', 'Always open for everyone')
            : shows ? L('মেনুতে দেখাবে', 'Shows in the menu')
            : !inList ? L('পাতা বন্ধ — মেনুতে আসবে না', 'Page off — not in the menu')
            : L('খোলার অনুমতি নেই — মেনুতে আসবে না', 'No permission to open — not in the menu')
          return <div key={x.key} className={`ax-row${x.to ? '' : ' nopage'}`} data-sub={x.key}>
            <span className="ax-name">
              {x.codes.length ? <Tri state={rowState} mark={markOf(x.codes)} label={`${name}: ${L('সব', 'all')}`} title={L('পুরো সারি', 'Whole row')}
                onClick={onToggle ? () => onToggle(x.codes, rowState !== 'all') : undefined} /> : <span className="ax-na" aria-hidden="true" />}
              <span className="tx"><b>{name}</b>
                {pages ? <small className={x.to && !x.always ? (shows ? 'ok' : 'off') : undefined}>{why}{x.tabs.length ? ` · ${n(x.tabs.length)}${L('টি অংশ', ' parts')}` : ''}</small>
                  : x.tabs.length ? <small>{n(x.tabs.length)}{L('টি অংশ', ' parts')}</small> : !x.to ? <small>{why}</small> : null}</span>
            </span>
            {pages && <span className="ax-pg" data-label={L('পাতা', 'Page')}>
              {!x.to ? <span className="ax-na" aria-hidden="true">·</span>
                : x.always ? <span className="ax-auto ok" title={why}><Icon name="check" size={15} /></span>
                : pages.list === null ? <span className={`ax-auto${shows ? ' ok' : ''}`} title={why}><Icon name="eye" size={16} /></span>
                : <Tri state={inList ? 'all' : 'none'} label={`${name}: ${L('পাতা', 'page')}`} title={why}
                    onClick={pages.onToggle ? () => pages.onToggle!(x.to!, !inList) : undefined} />}
            </span>}
            {ACTION_KEYS.map(k => {
              const codes = x.cells[k], st = cellState(codes, has)
              return <span key={k} className={`ax-c${st === 'na' ? ' na' : ''}`} data-label={L(ACTION6[k].bn, ACTION6[k].en)}>
                <Tri state={st} mark={markOf(codes)} linked={codes.some(c => (catalog.usedBy[c]?.length ?? 0) > 1)} label={`${name}: ${L(ACTION6[k].bn, ACTION6[k].en)}`}
                  title={st === 'na' ? undefined : tip(codes)} onClick={onToggle ? () => onToggle(codes, st !== 'all') : undefined} />
              </span>
            })}
          </div>
        })}
      </div>}
    </section>
  })}</div>
}

// ---------------------------------------------------------------- every single permission (database module → thing → action)
export function DetailMatrix({ perms, has, onToggle, mark, q }: {
  perms: Permission[]; has: (code: string) => boolean; onToggle?: (codes: string[], on: boolean) => void; mark?: (code: string) => Mark; q?: string }) {
  const { L, n, lang } = usePrefs()
  const s = (q ?? '').trim().toLowerCase()
  // module -> resource -> action -> permission
  const groups = useMemo(() => {
    const g: Record<string, Record<string, Record<string, Permission>>> = {}
    for (const p of perms) {
      const key = `${p.module}.${p.resource}`
      if (s && !`${RESOURCE_LABEL[key] ?? ''} ${p.code} ${p.description ?? ''}`.toLowerCase().includes(s)) continue
      ;((g[p.module] ??= {})[p.resource] ??= {})[p.action] = p
    }
    return g
  }, [perms, s])
  const markOf = (codes: string[]): Mark => { if (!mark) return null; const ms = codes.map(mark); return ms.includes('plus') ? 'plus' : ms.includes('minus') ? 'minus' : null }
  if (!Object.keys(groups).length) return <p className="muted">{L('এই নামে কিছু পাওয়া যায়নি।', 'Nothing matches.')}</p>
  return <>{Object.entries(groups).map(([mod, res]) => {
    const all = Object.values(res).flatMap(a => Object.values(a).map(p => p.code))
    const on = all.filter(has).length
    const acts = ACTIONS.filter(a => Object.values(res).some(r => r[a]))
    const al = (a: string) => (ACTION_LABEL[a] ? L(...ACTION_LABEL[a]) : a)
    return <div key={mod} className="ax-detail" data-dbmodule={mod}>
      <div className="da-bar" style={{ marginBottom: 6 }}>
        <strong>{moduleName(mod, lang)} <span className="muted small">{n(on)}/{n(all.length)}</span></strong>
        {onToggle && <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="secondary sm" onClick={() => onToggle(all, true)}>{L('সব দিন', 'All')}</button>
          <button type="button" className="secondary sm" onClick={() => onToggle(all, false)}>{L('সব তুলুন', 'None')}</button></span>}
      </div>
      <div className="da-table-wrap"><table className="da-table perm-table">
        <thead><tr><th>{L('বিষয়', 'Area')}</th>{acts.map(a => <th key={a} style={{ textAlign: 'center' }}>{al(a)}</th>)}</tr></thead>
        <tbody>{Object.entries(res).map(([r, byAct]) => {
          const codes = Object.values(byAct).map(p => p.code)
          const rowState = cellState(codes, has)
          const label = lang === 'bn' ? RESOURCE_LABEL[`${mod}.${r}`] ?? pretty(r) : pretty(r)
          return <tr key={r}>
            <td><span className="ax-drow"><Tri state={rowState} mark={markOf(codes)} label={`${label}: ${L('সব', 'all')}`} onClick={onToggle ? () => onToggle(codes, rowState !== 'all') : undefined} />
              <span>{label}<span className="sec">{Object.values(byAct)[0]?.description ?? ''}</span></span></span></td>
            {acts.map(a => <td key={a} style={{ textAlign: 'center' }} className={byAct[a] ? undefined : 'na'} data-label={al(a)}>{byAct[a]
              ? <Tri state={has(byAct[a].code) ? 'all' : 'none'} mark={mark ? mark(byAct[a].code) : null} label={`${label} ${a}`} title={`${byAct[a].description ?? ''}\n${byAct[a].code}`}
                  onClick={onToggle ? () => onToggle([byAct[a].code], !has(byAct[a].code)) : undefined} />
              : <span className="muted">·</span>}</td>)}
          </tr>
        })}</tbody></table></div>
    </div>
  })}</>
}

// ---------------------------------------------------------------- places: whole company / zones / hubs
/** A data limit: everything, or some whole zones plus some single hubs. */
export type PlacePick = { all: boolean; zones: string[]; hubs: string[] }
export const PLACE_LABEL: Record<OverridePlace, [string, string]> = {
  role: ['রোলের জায়গায়', 'Where the roles work'], global: ['পুরো কোম্পানি', 'Whole company'], zone: ['জোন', 'Zone'], hub: ['হাব', 'Hub'] }
const PLACE_ICON: Record<OverridePlace, string> = { role: 'shield', global: 'globe', zone: 'map', hub: 'hub' }
const PLACE_CLASS: Record<OverridePlace, string> = { role: 'rb-self', global: 'rb-super', zone: 'rb-zone', hub: 'rb-hub' }

export function placeText(g: { scope_type: string; zone?: string | null; hub?: string | null }, L: (bn: string, en: string) => string): string {
  return g.scope_type === 'global' ? L(...PLACE_LABEL.global) : g.scope_type === 'zone' ? `${L('জোন', 'Zone')}: ${g.zone ?? '—'}`
    : g.scope_type === 'hub' ? `${L('হাব', 'Hub')}: ${g.hub ?? '—'}` : L(...PLACE_LABEL.role)
}
export function PlaceChip({ g }: { g: { scope_type: string; zone?: string | null; hub?: string | null } }) {
  const { L } = usePrefs()
  const k = (['role', 'global', 'zone', 'hub'].includes(g.scope_type) ? g.scope_type : 'hub') as OverridePlace
  return <span className={`rb ${PLACE_CLASS[k]}`}><Icon name={PLACE_ICON[k]} size={12} />{k === 'zone' ? g.zone ?? '—' : k === 'hub' ? g.hub ?? '—' : L(...PLACE_LABEL[k])}</span>
}

/** Whole company, or whole zones (zone-wise limit) plus single hubs (hub-wise limit), on one screen. */
export function PlacePicker({ value, onChange, onlyAll }: { value: PlacePick; onChange: (v: PlacePick) => void; onlyAll?: boolean }) {
  const { L, n } = usePrefs()
  const o = useOrg()
  const [q, setQ] = useState('')
  const zones = o.data?.zones ?? [], hubs = o.data?.hubs ?? []
  const s = q.trim().toLowerCase()
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  const groups = [...zones.map(z => ({ id: z.id, name: z.name, hubs: hubs.filter(h => h.zone_id === z.id) })),
    { id: '', name: L('অন্য জোন', 'Other zones'), hubs: hubs.filter(h => !zones.some(z => z.id === h.zone_id)) }]
    .map(g => ({ ...g, hubs: g.hubs.filter(h => !s || `${h.name} ${h.code} ${g.name}`.toLowerCase().includes(s)) })).filter(g => g.hubs.length)
  // a whole zone already holds its hubs: ticking it drops the single hubs of that zone
  const zoneFlip = (id: string) => { const zs = flip(value.zones, id)
    onChange({ ...value, zones: zs, hubs: zs.includes(id) ? value.hubs.filter(h => hubs.find(x => x.id === h)?.zone_id !== id) : value.hubs }) }
  return <div className="ax-place">
    <div className="da-seg" role="group" aria-label={L('তথ্যের সীমা', 'Data limit')}>
      <button type="button" className={value.all ? '' : 'secondary'} aria-pressed={value.all} onClick={() => onChange({ ...value, all: true })}><Icon name="globe" size={15} />{L('পুরো কোম্পানি', 'Whole company')}</button>
      <button type="button" className={value.all ? 'secondary' : ''} aria-pressed={!value.all} disabled={onlyAll} onClick={() => onChange({ ...value, all: false })}><Icon name="map" size={15} />{L('নির্দিষ্ট জোন / হাব', 'Chosen zones / hubs')}</button>
    </div>
    {value.all ? <p className="muted small">{L('সব জোন ও সব হাবের তথ্য দেখবে ও কাজ করতে পারবে — কোনো সীমা থাকবে না।', 'Sees and works on every zone and hub — no limit.')}</p> : <>
      <fieldset className="ax-zone"><legend><Icon name="map" size={14} />{L('জোন অনুযায়ী সীমা', 'Zone-wise limit')}</legend>
        <p className="muted small">{L('টিক দেওয়া জোনের সব হাবের তথ্য দেখবে — এর বাইরের কিছু নয়।', 'Every hub of a ticked zone — nothing outside.')}</p>
        <div className="ax-chips">{zones.map(z => { const on = value.zones.includes(z.id)
          return <label key={z.id} className={`chip-toggle${on ? ' on' : ''}`}><input type="checkbox" checked={on} onChange={() => zoneFlip(z.id)} />{z.name}</label> })}
          {!zones.length && <span className="muted small">{o.loading ? L('লোড হচ্ছে…', 'Loading…') : L('কোনো জোন নেই', 'No zones')}</span>}</div>
      </fieldset>
      <fieldset className="ax-zone"><legend><Icon name="hub" size={14} />{L('হাব অনুযায়ী সীমা', 'Hub-wise limit')}</legend>
        <p className="muted small">{L('শুধু টিক দেওয়া হাবের তথ্য দেখবে — অন্য হাবের কিছুই নয়।', 'Only the ticked hubs — nothing of any other hub.')}</p>
        {hubs.length > 8 && <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('হাব খুঁজুন (নাম বা নম্বর)…', 'Search hubs (name or number)…')} />}
        {groups.map(g => { const whole = !!g.id && value.zones.includes(g.id), ids = g.hubs.map(h => h.id), all = ids.every(id => value.hubs.includes(id))
          return <div key={g.id} className="ax-zgrp"><div className="ax-zname">{g.name}{whole ? <small>{L('— পুরো জোন টিক দেওয়া', '— whole zone ticked')}</small>
            : <button type="button" className="link small" onClick={() => onChange({ ...value, hubs: all ? value.hubs.filter(id => !ids.includes(id)) : [...new Set([...value.hubs, ...ids])] })}>{all ? L('সব তুলুন', 'none') : L('সব', 'all')}</button>}</div>
            <div className="ax-chips">{g.hubs.map(h => { const on = whole || value.hubs.includes(h.id)
              return <label key={h.id} className={`chip-toggle${on ? ' on' : ''}${whole ? ' fixed' : ''}`}><input type="checkbox" checked={on} disabled={whole} onChange={() => onChange({ ...value, hubs: flip(value.hubs, h.id) })} />{h.name}</label> })}</div>
          </div> })}
        {!groups.length && <p className="muted small">{o.loading ? L('লোড হচ্ছে…', 'Loading…') : L('কোনো হাব পাওয়া যায়নি', 'No hubs found')}</p>}
      </fieldset>
      <p className="ax-picked">{n(value.zones.length)}{L('টি জোন', ' zones')} + {n(value.hubs.length)}{L('টি হাব বাছা হয়েছে', ' hubs chosen')}</p>
    </>}
  </div>
}

/** The database part (personal permissions) has not been applied yet. */
export function NotInstalled() {
  const { L } = usePrefs()
  return <p className="notice">{L('এই অংশ চালু করতে ডাটাবেসে একটি আপডেট বসাতে হবে (migration 20261117004000_advanced_permissions)। বসানো হলেই এখানে কাজ শুরু হবে — বাকি সব অংশ এখনই চলছে।',
    'This part needs one database update (migration 20261117004000_advanced_permissions). It starts working here as soon as that is applied — everything else already works.')}</p>
}
