// Hub-wise and zone-wise data limits, seen from the place: pick a hub or a zone and see everyone who gets its data,
// and how — limited to that hub, through its zone, or because they see the whole company.
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { Badge, Stat } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { reachOf } from '../../lib/access'
import { userFriendly, type RoleGrant, type UserRow } from '../../lib/users'
import { useOrg } from '../hr/common'
import type { CenterData } from './AccessCenter'
import { permName, roleName } from './common'

type Via = { u: UserRow; roles: RoleGrant[] }

export function ScopeTab({ d }: { d: CenterData }) {
  const { L, n, lang } = usePrefs()
  const o = useOrg()
  const [sp, setSp] = useSearchParams()
  const kind: 'hub' | 'zone' = sp.get('kind') === 'zone' ? 'zone' : 'hub'
  const pick = sp.get('id') ?? ''
  const [q, setQ] = useState('')
  const set = (patch: Record<string, string>) => { const x = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v) x.set(k, v); else x.delete(k) } setSp(x, { replace: true }) }
  const people = useMemo(() => (d.people ?? []).filter(u => !u.archived_at && u.status === 'active'), [d.people])
  const zones = o.data?.zones ?? [], hubs = o.data?.hubs ?? []
  const supers = people.filter(u => u.roles.some(r => r.is_super))
  const rest = people.filter(u => !u.roles.some(r => r.is_super))
  const whole = rest.filter(u => reachOf(u.roles) === 'global')
  const zoneOnly = rest.filter(u => reachOf(u.roles) === 'zone'), hubOnly = rest.filter(u => reachOf(u.roles) === 'hub')

  const at = (u: UserRow, test: (g: RoleGrant) => boolean): Via | null => { const roles = u.roles.filter(test); return roles.length ? { u, roles } : null }
  const list = (test: (g: RoleGrant) => boolean) => rest.map(u => at(u, test)).filter(Boolean) as Via[]
  const count = (test: (g: RoleGrant) => boolean) => rest.filter(u => u.roles.some(test)).length
  const s = q.trim().toLowerCase()
  const zoneOf = (id: string) => hubs.find(h => h.id === id)?.zone_id ?? ''
  const hubGroups = [...zones.map(z => ({ id: z.id, name: z.name, hubs: hubs.filter(h => h.zone_id === z.id) })),
    { id: '', name: L('অন্য জোন', 'Other zones'), hubs: hubs.filter(h => !zones.some(z => z.id === h.zone_id)) }]
    .map(g => ({ ...g, hubs: g.hubs.filter(h => !s || `${h.name} ${h.code} ${g.name}`.toLowerCase().includes(s)) })).filter(g => g.hubs.length)

  const picked = kind === 'hub' ? hubs.find(h => h.id === pick) : zones.find(z => z.id === pick)
  const direct = !picked ? [] : kind === 'hub' ? list(g => g.scope_type === 'hub' && g.hub_id === pick) : list(g => g.scope_type === 'zone' && g.zone_id === pick)
  const viaZone = !picked || kind !== 'hub' ? [] : list(g => g.scope_type === 'zone' && g.zone_id === zoneOf(pick))
  const inside = !picked || kind !== 'zone' ? [] : list(g => g.scope_type === 'hub' && zoneOf(g.hub_id ?? '') === pick)
  const everywhere = list(g => g.scope_type === 'global')
  const own = d.overrides.filter(x => x.live && x.effect === 'grant' && (kind === 'hub' ? x.scope_type === 'hub' && x.hub_id === pick : x.scope_type === 'zone' && x.zone_id === pick))

  const group = (tone: 'ok' | 'info' | 'warn', rows: Via[], title: string, note: string) => <div className="ax-via" key={title}>
    <h3><Badge tone={tone}>{n(rows.length)}</Badge> {title}</h3><p className="muted small">{note}</p>
    {!rows.length ? <p className="muted small">{L('কেউ নেই', 'Nobody')}</p> : <ul className="ax-people">{rows.map(({ u, roles }) => <li key={u.id}>
      <span className="ax-av sm" aria-hidden="true">{(u.full_name || u.email || '?').slice(0, 2).toUpperCase()}</span>
      <span className="tx"><b>{u.full_name || u.email}</b><small>{[...new Set(roles.map(r => roleName(r, lang) + (r.scope_type === 'hub' && kind === 'zone' ? ` · ${r.hub ?? ''}` : '')))].join(', ')}</small></span>
      <Link to={`/app/access/user/${u.id}#roles`} className="small">{d.sup ? L('সীমা বদলান', 'Change limit') : L('দেখুন', 'Open')} →</Link></li>)}</ul>}
  </div>

  if (d.peopleError) return <p className="notice">{/42501|Not authori/i.test(String((d.peopleError as { message?: string })?.message ?? d.peopleError))
    ? L('কে কোন হাব বা জোন দেখেন তা জানতে ইউজারের তালিকা দেখার অনুমতি লাগে।', 'Seeing who reaches which hub or zone needs the right to list accounts.') : userFriendly(d.peopleError)}</p>

  return <>
    <div className="da-stats">
      <Stat icon="globe" tone={whole.length ? 'warn' : undefined} label={L('পুরো কোম্পানি দেখেন', 'See the whole company')} value={n(whole.length)} sub={L('কোনো সীমা নেই', 'no limit')} />
      <Stat icon="map" label={L('জোনে সীমিত', 'Limited to zones')} value={n(zoneOnly.length)} />
      <Stat icon="hub" label={L('হাবে সীমিত', 'Limited to hubs')} value={n(hubOnly.length)} />
      <Stat icon="key" label={L('সুপার অ্যাডমিন', 'Super Admins')} value={n(supers.length)} sub={L('সব কিছু, সবসময়', 'everything, always')} />
    </div>
    <section className="panel">
      <div className="da-bar ax-tools">
        <div className="da-seg" role="group" aria-label={L('কী ধরে দেখবেন', 'Browse by')}>
          <button type="button" className={kind === 'hub' ? '' : 'secondary'} aria-pressed={kind === 'hub'} onClick={() => set({ kind: 'hub', id: '' })}><Icon name="hub" size={15} />{L('হাব অনুযায়ী', 'By hub')}</button>
          <button type="button" className={kind === 'zone' ? '' : 'secondary'} aria-pressed={kind === 'zone'} onClick={() => set({ kind: 'zone', id: '' })}><Icon name="map" size={15} />{L('জোন অনুযায়ী', 'By zone')}</button>
        </div>
        {kind === 'hub' && hubs.length > 8 && <input type="search" className="ax-search" value={q} onChange={e => setQ(e.target.value)} placeholder={L('হাব খুঁজুন…', 'Search hubs…')} />}
      </div>
      <p className="muted small">{kind === 'hub' ? L('একটি হাব বাছুন — কে কে ওই হাবের তথ্য পান দেখাবে। সংখ্যা = যাঁরা ওই হাবেই সীমিত।', 'Pick a hub to see who gets its data. The number = people limited to that very hub.')
        : L('একটি জোন বাছুন — কে কে ওই জোনের তথ্য পান দেখাবে। সংখ্যা = যাঁরা ওই জোনে সীমিত।', 'Pick a zone to see who gets its data. The number = people limited to that zone.')}</p>
      <div className="ax-scope">
        <div className="ax-places" role="listbox" aria-label={kind === 'hub' ? L('হাব', 'Hubs') : L('জোন', 'Zones')}>
          {kind === 'zone' ? zones.map(z => <button key={z.id} type="button" role="option" aria-selected={pick === z.id} className={`ax-pl${pick === z.id ? ' on' : ''}`} onClick={() => set({ id: z.id })}>
            <Icon name="map" size={16} /><span className="t">{z.name}</span><span className="c">{n(count(g => g.scope_type === 'zone' && g.zone_id === z.id))}</span></button>)
            : hubGroups.map(g => <div key={g.id} className="ax-plgrp"><div className="ax-zname">{g.name}</div>
              {g.hubs.map(h => <button key={h.id} type="button" role="option" aria-selected={pick === h.id} className={`ax-pl${pick === h.id ? ' on' : ''}`} onClick={() => set({ id: h.id })}>
                <Icon name="hub" size={16} /><span className="t">{h.name}</span><span className="c">{n(count(x => x.scope_type === 'hub' && x.hub_id === h.id))}</span></button>)}</div>)}
          {o.loading && <p className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</p>}
          {!o.loading && !(kind === 'zone' ? zones.length : hubGroups.length) && <p className="muted small">{L('কিছু পাওয়া যায়নি।', 'Nothing found.')}</p>}
        </div>
        <div className="ax-scope-d" data-scope-detail>
          {!picked ? <p className="ax-hint"><Icon name={kind === 'hub' ? 'hub' : 'map'} size={22} />{kind === 'hub' ? L('বাঁ দিক থেকে একটি হাব বাছুন।', 'Pick a hub on the left.') : L('বাঁ দিক থেকে একটি জোন বাছুন।', 'Pick a zone on the left.')}</p> : <>
            <h2 className="ax-scope-h"><Icon name={kind === 'hub' ? 'hub' : 'map'} size={20} />{picked.name}
              {kind === 'hub' && <small className="muted"> · {o.names.zone[zoneOf(pick)] ?? ''}</small>}</h2>
            {group('ok', direct, kind === 'hub' ? L('শুধু এই হাবে সীমিত', 'Limited to this hub') : L('এই জোনে সীমিত', 'Limited to this zone'),
              kind === 'hub' ? L('এঁরা এই হাবের তথ্যই পান (আর যে হাবগুলো আলাদা করে দেওয়া)।', 'They get this hub’s data (and any other hub given separately).') : L('এঁরা এই জোনের সব হাবের তথ্য পান।', 'They get every hub of this zone.'))}
            {kind === 'hub' && group('info', viaZone, L('জোনের মাধ্যমে পান', 'Through the zone'), L('এঁদের রোল পুরো জোনের জন্য, তাই এই হাবও দেখেন।', 'Their role is for the whole zone, so they see this hub too.'))}
            {kind === 'zone' && group('info', inside, L('এই জোনের কোনো হাবে সীমিত', 'Limited to a hub inside this zone'), L('এঁরা পুরো জোন নয়, শুধু নিজের হাব দেখেন।', 'They see only their own hub, not the whole zone.'))}
            {group('warn', everywhere, L('পুরো কোম্পানি দেখেন', 'See the whole company'), L('এঁদের রোলে কোনো সীমা নেই, তাই সব হাব ও জোন দেখেন।', 'No limit on their role, so they see every hub and zone.'))}
            {own.length > 0 && <div className="ax-via"><h3><Badge tone="ok">{n(own.length)}</Badge> {L('শুধু এই জায়গার জন্য দেওয়া ব্যক্তিগত অনুমতি', 'Personal permissions given for this place only')}</h3>
              <ul className="ax-people">{own.map(x => <li key={x.id}><span className="tx"><b>{x.user_name}</b><small>+ {permName(d.base.catalog.byCode[x.permission], x.permission, lang)}{x.valid_to ? ` · ${L('পর্যন্ত', 'until')} ${x.valid_to}` : ''}</small></span>
                <Link to={`/app/access/user/${x.user_id}#own`} className="small">{L('দেখুন', 'Open')} →</Link></li>)}</ul></div>}
            <p className="muted small">{L(`সুপার অ্যাডমিন (${n(supers.length)} জন) সবসময় সব কিছু দেখেন।`, `Super Admins (${supers.length}) always see everything.`)}</p>
          </>}
        </div>
      </div>
    </section>
  </>
}
