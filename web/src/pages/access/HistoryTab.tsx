// Permission change history: who changed what for whom, when and why. Read from the audit log the database
// keeps by itself for roles, their permissions, role assignments, page lists and personal permissions.
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { DataTable } from '../../components/DataTable'
import { Badge, Field, useLoad } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { access, buildEvents, wholeActions, type AccessEvent, type AuditRow, type EventKind } from '../../lib/access'
import { userFriendly } from '../../lib/users'
import { useOrg } from '../hr/common'
import type { CenterData } from './AccessCenter'
import { permName, roleName } from './common'

const KINDS: Array<[EventKind, string, string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral']> = [
  ['perm', 'রোলের অনুমতি', 'Role permissions', 'info'], ['role', 'রোল', 'Roles', 'neutral'], ['assign', 'ইউজারের রোল ও সীমা', 'User roles & limits', 'ok'],
  ['pages', 'পাতা (সাব-মেনু)', 'Pages (sub-menus)', 'warn'], ['override', 'ব্যক্তিগত অনুমতি', 'Personal permissions', 'bad'], ['layout', 'ড্যাশবোর্ড', 'Dashboard', 'neutral'],
]

export function HistoryTab({ d }: { d: CenterData }) {
  const { L, n, lang } = usePrefs()
  const { can } = useAuth()
  const o = useOrg()
  const [sp, setSp] = useSearchParams()
  const kind = (sp.get('kind') ?? '') as EventKind | '', who = sp.get('user') ?? '', role = sp.get('role') ?? ''
  const set = (k: string, v: string) => { const x = new URLSearchParams(sp); if (v) x.set(k, v); else x.delete(k); setSp(x, { replace: true }) }
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [system, setSystem] = useState(false)
  const [rows, setRows] = useState<AuditRow[]>([]); const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true); const [error, setError] = useState<unknown>(null)
  const names = useLoad(() => access.people(), [])

  async function load(reset: boolean) {
    setLoading(true); setError(null)
    try {
      const page = wholeActions(await access.history({ from: from || null, to: to || null, system, beforeId: reset ? null : rows[rows.length - 1]?.id ?? null }))
      setRows(reset ? page.rows : [...rows, ...page.rows]); setMore(page.more)
    } catch (e) { setError(e) } finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(true) }, [from, to, system])

  const perms = d.base.data?.perms
  const permById = useMemo(() => Object.fromEntries((perms ?? []).filter(p => p.id).map(p => [p.id!, p.code])) as Record<string, string>, [perms])
  const events = useMemo(() => buildEvents(rows, permById), [rows, permById])
  const person = (id: string | null) => (!id ? L('সিস্টেম', 'System') : names.data?.[id] || d.people?.find(u => u.id === id)?.full_name || L('(অজানা)', '(unknown)'))
  const roleLabel = (id: string | null, info?: Record<string, unknown>) => (id && d.base.roleById[id] ? roleName(d.base.roleById[id], lang)
    : String((lang === 'bn' ? info?.name_bn ?? info?.name : info?.name) ?? L('(রোল)', '(role)')))
  const pn = (label: string) => { const [code, at] = label.split(' @'); return permName(d.base.catalog.byCode[code], code, lang) + (at ? ` (${at === 'global' ? L('পুরো কোম্পানি', 'whole company') : at === 'zone' ? L('একটি জোন', 'one zone') : L('একটি হাব', 'one hub')})` : '') }
  const pageName = (p: string) => { const s = d.base.catalog.subByKey[p.split('?')[0]]; return s ? L(s.bn, s.en) : p }
  const placeOf = (i: Record<string, unknown>) => (i.scope_type === 'global' ? L('পুরো কোম্পানি', 'whole company')
    : i.scope_type === 'zone' ? `${L('জোন', 'zone')}: ${o.names.zone[String(i.zone_id)] ?? '—'}` : `${L('হাব', 'hub')}: ${o.names.hub[String(i.hub_id)] ?? '—'}`)

  /** One event in words: what happened, to whom / which role, and the details. */
  const say = (e: AccessEvent): { what: string; target: string; lines: string[] } => {
    const list = (sign: string, xs: string[], f: (x: string) => string) => (xs.length ? [`${sign} ${xs.map(f).join(', ')}`] : [])
    switch (e.what) {
      case 'role_new': return { what: L('নতুন রোল বানানো', 'Role created'), target: roleLabel(e.role, e.info), lines: [] }
      case 'role_edit': return { what: L('রোলের নাম / বিবরণ বদল', 'Role details changed'), target: roleLabel(e.role, e.info),
        lines: e.info.old_name && e.info.old_name !== e.info.name ? [`${String(e.info.old_name)} → ${String(e.info.name)}`] : [] }
      case 'role_on': return { what: L('রোল আবার চালু', 'Role switched on'), target: roleLabel(e.role, e.info), lines: [] }
      case 'role_off': return { what: L('রোল বন্ধ রাখা', 'Role switched off'), target: roleLabel(e.role, e.info), lines: [] }
      case 'role_archive': return { what: L('রোল আর্কাইভ', 'Role archived'), target: roleLabel(e.role, e.info), lines: [] }
      case 'role_restore': return { what: L('রোল ফিরিয়ে আনা', 'Role restored'), target: roleLabel(e.role, e.info), lines: [] }
      case 'perm_set': return { what: L(`রোলের অনুমতি বদল (+${n(e.added.length)} −${n(e.removed.length)})`, `Role permissions changed (+${e.added.length} −${e.removed.length})`), target: roleLabel(e.role),
        lines: [...list('+', e.added, pn), ...list('−', e.removed, pn)] }
      case 'assign': return { what: L('রোল দেওয়া', 'Role given'), target: person(e.user), lines: [`${roleLabel(e.role)} — ${placeOf(e.info)}${e.info.valid_to ? ` · ${L('পর্যন্ত', 'until')} ${String(e.info.valid_to)}` : ''}`] }
      case 'unassign': return { what: L('রোল সরানো', 'Role removed'), target: person(e.user), lines: [`${roleLabel(e.role)} — ${placeOf(e.info)}`] }
      case 'assign_until': return { what: L('রোলের মেয়াদ বদল', 'Role end date changed'), target: person(e.user), lines: [`${roleLabel(e.role)} — ${placeOf(e.info)}${e.info.valid_to ? ` · ${String(e.info.valid_to)}` : ''}`] }
      case 'pages_set': return { what: e.info.was_open ? L(`পাতা সীমিত করা (${n(Number(e.info.count ?? 0))}টি পাতা)`, `Pages limited (${Number(e.info.count ?? 0)} pages)`) : L('পাতার তালিকা বদল', 'Page list changed'), target: roleLabel(e.role),
        lines: e.info.was_open ? [] : [...list('+', e.added, pageName), ...list('−', e.removed, pageName)] }
      case 'pages_open': return { what: L('পাতার সীমা তুলে দেওয়া', 'Page limit removed'), target: roleLabel(e.role), lines: [] }
      case 'layout': return { what: L('হোম পেজের ড্যাশবোর্ড সাজানো', 'Home dashboard arranged'), target: roleLabel(e.role), lines: [] }
      case 'override_set': return { what: L('ব্যক্তিগত অনুমতি: বাড়তি দেওয়া / বন্ধ করা', 'Personal permissions: extra given / switched off'), target: person(e.user),
        lines: [...list(L('+ বাড়তি:', '+ extra:'), e.added, pn), ...list(L('− বন্ধ:', '− off:'), e.removed, pn)] }
      case 'override_off': return { what: L('ব্যক্তিগত অনুমতি তুলে নেওয়া', 'Personal permissions taken back'), target: person(e.user),
        lines: [...list(L('বাড়তি তুলে নেওয়া:', 'extra taken back:'), e.removed, pn), ...list(L('বন্ধ তুলে দেওয়া (আবার চালু):', 'switch-off lifted (on again):'), e.added, pn)] }
    }
  }
  const shown = useMemo(() => events.filter(e => (!kind || e.kind === kind) && (!who || e.user === who || e.actor === who) && (!role || e.role === role)),
    [events, kind, who, role])
  const when = (v: string) => new Date(v).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' })
  const touched = useMemo(() => [...new Set(events.flatMap(e => [e.user, e.actor]).filter(Boolean) as string[])], [events])
  const rolesSeen = useMemo(() => [...new Set(events.map(e => e.role).filter(Boolean) as string[])], [events])

  return <>
    {!can('system.audit.view') && <p className="notice">{L('ইতিহাস দেখতে “অডিট লগ — দেখা” অনুমতি লাগে।', 'Seeing the history needs “Audit log — View”.')}</p>}
    <section className="da-filters panel no-print">
      <Field label={L('কী ধরনের বদল', 'Kind of change')}><select value={kind} onChange={e => set('kind', e.target.value)}><option value="">{L('সব', 'All')}</option>
        {KINDS.map(([k, bn, en]) => <option key={k} value={k}>{L(bn, en)}</option>)}</select></Field>
      <Field label={L('কোন রোল', 'Role')}><select value={role} onChange={e => set('role', e.target.value)}><option value="">{L('সব রোল', 'All roles')}</option>
        {rolesSeen.map(id => <option key={id} value={id}>{roleLabel(id)}</option>)}{role && !rolesSeen.includes(role) && <option value={role}>{roleLabel(role)}</option>}</select></Field>
      <Field label={L('কার (যাঁর বদলেছে বা যিনি বদলেছেন)', 'Person (changed, or changed by)')}><select value={who} onChange={e => set('user', e.target.value)}><option value="">{L('সবাই', 'Everyone')}</option>
        {touched.map(id => <option key={id} value={id}>{person(id)}</option>)}{who && !touched.includes(who) && <option value={who}>{person(who)}</option>}</select></Field>
      <Field label={L('তারিখ থেকে', 'From')}><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label={L('তারিখ পর্যন্ত', 'To')}><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
      <label className="da-check"><input type="checkbox" checked={system} onChange={e => setSystem(e.target.checked)} />{L('সিস্টেম নিজে যা বসিয়েছে তাও দেখান', 'Also show what the system set up itself')}</label>
    </section>
    {error ? <p className="da-error">{userFriendly(error)}</p> : null}
    <section className="panel">
      <div className="da-bar"><strong>{n(shown.length)} {L('টি বদল', 'changes')}</strong>{loading && <span className="muted small">{L('লোড হচ্ছে…', 'Loading…')}</span>}</div>
      <DataTable<AccessEvent> title={L('অনুমতি বদলের ইতিহাস', 'Permission change history')} file="permission-history" rows={shown} rowKey={e => e.key} views={['table', 'list']} phoneView="list"
        empty={<p className="muted">{loading ? L('লোড হচ্ছে…', 'Loading…') : L('এই সময়ে কোনো বদল পাওয়া যায়নি।', 'No changes found for this period.')}</p>} cols={[
          { key: 'at', label: L('কখন', 'When'), value: e => when(e.at) },
          { key: 'actor', label: L('কে করেছেন', 'Changed by'), value: e => person(e.actor) },
          { key: 'what', label: L('কী হয়েছে', 'What'), primary: true, value: e => say(e).what,
            render: e => { const k = KINDS.find(x => x[0] === e.kind)!; return <><Badge tone={k[3]}>{L(k[1], k[2])}</Badge> <strong>{say(e).what}</strong></> } },
          { key: 'target', label: L('কার / কোন রোল', 'For whom / which role'), value: e => say(e).target,
            render: e => (e.user ? <Link to={`/app/access/user/${e.user}`} onClick={x => x.stopPropagation()}>{say(e).target}</Link> : e.role && d.base.roleById[e.role] ? <Link to={`/app/access/role/${e.role}`} onClick={x => x.stopPropagation()}>{say(e).target}</Link> : <>{say(e).target}</>) },
          { key: 'detail', label: L('বিস্তারিত', 'Details'), value: e => say(e).lines.join(' | '),
            render: e => { const ls = say(e).lines; return ls.length ? <span className="ax-hl">{ls.map((x, i) => <span key={i} className={x.startsWith('+') ? 'plus' : x.startsWith('−') ? 'minus' : undefined}>{x}</span>)}</span> : <span className="muted">—</span> } },
          { key: 'reason', label: L('কারণ', 'Reason'), value: e => e.reason ?? '' },
        ]} />
      {more && <p style={{ textAlign: 'center', marginTop: 12 }}><button type="button" className="secondary" disabled={loading} onClick={() => void load(false)}>{L('আরও পুরোনো দেখুন', 'Load older')}</button></p>}
    </section>
  </>
}
