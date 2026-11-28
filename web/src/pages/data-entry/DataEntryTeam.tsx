import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { usePrefs } from '../../lib/prefs'
import { supabase } from '../../lib/supabase'
import { pickRemembered, rememberZone, rememberedZone } from '../../lib/zoneHubMemory'
import { useLoad } from '../accounts/ui'
import { DataEntryTargetSettings } from './DataEntryTargets'
import { DataEntryShiftHub, dataEntryPages, type EntryPage } from './DataEntryShift'
import './data-entry.css'

type Choice = { id: string; name: string }
type Hub = Choice & { available: boolean }
type Candidate = Choice & { code: string; hub_id: string | null }
type Member = Choice & {
  employee_id: string
  code: string | null
  is_active: boolean
  primary_hub_id: string
  additional_hubs: string[]
  eligible: boolean
  revision: number
  rank_id: string | null
  rank_number: number | null
}
type Snapshot = { hubs: Hub[]; members: Member[] }
type Rank = {
  id: string
  rank_number: number
  name_bn: string
  name: string | null
  target_multiplier_pct: number
  is_active: boolean
  revision: number
}

async function teamRpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export function DataEntryTeam({ page = 'team' }: { page?: EntryPage }) {
  const { L } = usePrefs()
  const { viewAs } = useAuth()
  const preview = Boolean(viewAs)
  const zones = useLoad(() => preview ? Promise.resolve([]) : teamRpc<Choice[]>('data_entry_team_zones'), [preview])
  const [selection, setSelection] = useState(() => rememberedZone())
  const zone = pickRemembered(zones.data, selection)
  function chooseZone(id: string) { setSelection(id); rememberZone(id) }

  if (preview) return <AppShell title={L(dataEntryPages[page][0], dataEntryPages[page][1])}>
    <p>{L('টিম পরিচালনার জন্য নিজের অ্যাকাউন্টের ভিউতে ফিরুন।', 'Return to your own account view to manage the team.')}</p>
  </AppShell>

  return <AppShell title={L(dataEntryPages[page][0], dataEntryPages[page][1])}>
    {zones.loading && <p role="status">{L('জোন লোড হচ্ছে…', 'Loading zones…')}</p>}
    {zones.error ? <p className="da-error" role="alert">{errorText(zones.error)}</p> : null}
    {!zones.loading && !zones.error && !zone && <p>{L('এই টিম পরিচালনার জন্য কোনো জোনে আপনার অনুমতি নেই।', 'You do not have access to manage this team in a zone.')}</p>}
    {zone && <>
      {(zones.data?.length ?? 0) > 1 && <label className="data-entry-field">{L('জোন', 'Zone')}
        <select value={zone.id} onChange={e => chooseZone(e.currentTarget.value)}>
          {zones.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      <ZoneTeam key={zone.id + page} zone={zone.id} page={page} />
    </>}
  </AppShell>
}

function ZoneTeam({ zone, page }: { zone: string; page: EntryPage }) {
  const { L } = usePrefs()
  const team = useLoad(() => teamRpc<Snapshot>('data_entry_team_snapshot', { p_zone: zone }), [zone])
  const ranks = useLoad(() => page === 'team'
    ? teamRpc<Rank[]>('data_entry_rank_list', { p_zone: zone })
    : Promise.resolve([]), [zone, page])
  const [term, setTerm] = useState('')
  const [query, setQuery] = useState('')
  const results = useLoad(() => page === 'team' && query
    ? teamRpc<Candidate[]>('data_entry_team_candidates', { p_zone: zone, p_search: query })
    : Promise.resolve([]), [zone, page, query])
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [editing, setEditing] = useState<Member | null>(null)
  const [notice, setNotice] = useState('')

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = term.trim()
    if (value === query) void results.reload()
    setQuery(value)
  }

  async function saved() {
    setCandidate(null)
    setEditing(null)
    setNotice(L('টিমের তথ্য সংরক্ষিত হয়েছে।', 'Team details saved.'))
    await Promise.all([team.reload(), results.reload()])
  }

  if (page !== 'team') {
    if (team.error) return <p role="alert">{errorText(team.error)}</p>
    if (!team.data) return <p role="status">{L('লোড হচ্ছে…', 'Loading…')}</p>
    return <DataEntryShiftHub hubs={team.data.hubs.filter(hub => hub.available)} page={page}
      renderTargetSettings={page === 'targets' ? hub => <DataEntryTargetSettings key={hub.id} hubs={[hub]} /> : undefined} />
  }
  return <>
    {notice && <p role="status">{notice}</p>}
    <section className="panel data-entry-panel">
      <h2>{L('কর্মী যোগ করুন', 'Add employee')}</h2>
      <form className="data-entry-search" onSubmit={search}>
        <label className="data-entry-field">{L('কর্মীর নাম বা আইডি', 'Employee name or ID')}
          <input value={term} onChange={e => setTerm(e.currentTarget.value)} required minLength={2} maxLength={100} />
        </label>
        <button type="submit" disabled={term.trim().length < 2}>{L('খুঁজুন', 'Search')}</button>
      </form>
      {results.loading && query && <p role="status">{L('কর্মী খোঁজা হচ্ছে…', 'Searching employees…')}</p>}
      {results.error ? <p className="da-error" role="alert">{errorText(results.error)}</p> : null}
      {query && !results.loading && !results.error && !results.data?.length && <p>{L('যোগ করার মতো কর্মী পাওয়া যায়নি।', 'No eligible employees found.')}</p>}
      {!results.loading && !results.error && (results.data ?? []).map(item => <button type="button" className="secondary" key={item.id} onClick={() => {
        setCandidate(item)
        setEditing(null)
        setNotice('')
      }}>{item.name} · {item.code}</button>)}
    </section>

    {team.loading && <p role="status">{L('টিম লোড হচ্ছে…', 'Loading team…')}</p>}
    {team.error ? <p className="da-error" role="alert">{errorText(team.error)}</p> : null}
    {team.data && <>
      <DataEntryShiftHub hubs={team.data.hubs.filter(hub => hub.available)} page="team" />
      {(candidate || editing) && <MemberForm
        key={editing?.id ?? candidate?.id}
        zone={zone} member={editing} candidate={candidate} hubs={team.data.hubs}
        onSaved={saved} onCancel={() => { setCandidate(null); setEditing(null) }}
      />}
      <RankPanel zone={zone} ranks={ranks.data ?? []} loading={ranks.loading}
        error={ranks.error} onChanged={async () => { await Promise.all([ranks.reload(), team.reload()]) }} />
      <section className="panel data-entry-panel">
        <h2>{L('টিম সদস্য', 'Team members')}</h2>
        <button type="button" className="secondary" disabled={team.loading} onClick={() => {
          setCandidate(null)
          setEditing(null)
          void team.reload()
        }}>{L('তালিকা আপডেট করুন', 'Refresh team')}</button>
        {team.data.members.length === 0 && <p>{L('এই জোনে এখনো কোনো টিম সদস্য নেই।', 'This zone has no team members yet.')}</p>}
        {team.data.members.map(member => <div className="data-entry-member" key={member.id}>
          <div>
            <strong>{member.name}</strong>{member.code && <span> · {member.code}</span>}
            {member.rank_number != null && <span className="data-entry-rank-badge"> · {L('র‍্যাংক', 'Rank')} {member.rank_number}</span>}
            <div>{team.data?.hubs.find(hub => hub.id === member.primary_hub_id)?.name ?? L('প্রাথমিক হাব এখন পাওয়া যাচ্ছে না', 'Primary hub unavailable')}</div>
            <div>{member.is_active && member.eligible ? L('সক্রিয়', 'Active') : L('নিষ্ক্রিয়', 'Inactive')}</div>
            <RankAssign zone={zone} member={member} ranks={(ranks.data ?? []).filter(r => r.is_active)}
              onSaved={async () => { await team.reload() }} />
          </div>
          <button type="button" className="secondary" onClick={() => {
            setEditing(member)
            setCandidate(null)
            setNotice('')
          }}>{L('সম্পাদনা', 'Edit')}</button>
        </div>)}
      </section>
    </>}
  </>
}

function MemberForm({ zone, member, candidate, hubs, onSaved, onCancel }: {
  zone: string
  member: Member | null
  candidate: Candidate | null
  hubs: Hub[]
  onSaved: () => Promise<void>
  onCancel: () => void
}) {
  const { L } = usePrefs()
  const initialHub = member?.primary_hub_id ?? candidate?.hub_id ?? ''
  const [primary, setPrimary] = useState(hubs.some(hub => hub.id === initialHub && hub.available) ? initialHub : '')
  const [additional, setAdditional] = useState(member?.additional_hubs ?? [])
  const [active, setActive] = useState(member ? member.is_active && member.eligible : true)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const employee = member?.employee_id ?? candidate?.id
  const available = hubs.filter(hub => hub.available)
  const missingAdditional = additional.some(id => !available.some(hub => hub.id === id))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!employee || busy) return
    setBusy(true)
    setFailure('')
    try {
      await teamRpc<string>('data_entry_team_save', {
        p_zone: zone,
        p_employee: employee,
        p_primary_hub: primary || null,
        p_additional_hubs: additional,
        p_is_active: active,
        p_version: member?.revision ?? null,
      })
    } catch (error) {
      setFailure(errorText(error))
      setBusy(false)
      return
    }
    await onSaved()
  }

  return <section className="panel data-entry-panel">
    <h2>{member?.name ?? candidate?.name}</h2>
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        {member && <label className="data-entry-check">
          <input type="checkbox" checked={active} disabled={!member.eligible}
            onChange={e => setActive(e.currentTarget.checked)} />{L('সক্রিয় সদস্য', 'Active member')}
        </label>}
        <label className="data-entry-field">{L('প্রাথমিক হাব', 'Primary hub')}
          <select value={primary} disabled={!active} required={active} onChange={e => {
            const value = e.currentTarget.value
            setPrimary(value)
            setAdditional(ids => ids.filter(id => id !== value))
          }}>
            <option value="">{L('হাব বাছুন', 'Select a hub')}</option>
            {available.map(hub => <option key={hub.id} value={hub.id}>{hub.name}</option>)}
          </select>
        </label>
        <fieldset disabled={!active}>
          <legend>{L('অতিরিক্ত হাব', 'Additional hubs')}</legend>
          {available.filter(hub => hub.id !== primary).map(hub => <label key={hub.id} className="data-entry-check">
            <input type="checkbox" checked={additional.includes(hub.id)} onChange={e => {
              const checked = e.currentTarget.checked
              setAdditional(ids => checked ? [...ids, hub.id] : ids.filter(id => id !== hub.id))
            }} />{hub.name}
          </label>)}
          {missingAdditional && <button type="button" className="secondary"
            onClick={() => setAdditional(ids => ids.filter(id => available.some(hub => hub.id === id)))}>
            {L('অকার্যকর হাব বাদ দিন', 'Remove unavailable hubs')}
          </button>}
        </fieldset>
        {failure && <p className="da-error" role="alert">{failure}</p>}
        <div className="data-entry-actions">
          <button type="submit" disabled={active && (!primary || missingAdditional)}>{L('সংরক্ষণ করুন', 'Save')}</button>
          <button type="button" className="secondary" onClick={onCancel}>{L('বাতিল', 'Cancel')}</button>
        </div>
      </fieldset>
    </form>
  </section>
}

function RankPanel({ zone, ranks, loading, error, onChanged }: {
  zone: string
  ranks: Rank[]
  loading: boolean
  error: unknown
  onChanged: () => Promise<void>
}) {
  const { L } = usePrefs()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [edits, setEdits] = useState<Record<string, { name_bn: string; multiplier: string; active: boolean }>>({})

  async function seed() {
    setBusy(true); setFailure('')
    try { await teamRpc('data_entry_rank_seed_defaults', { p_zone: zone }); await onChanged() }
    catch (e) { setFailure(errorText(e)) }
    finally { setBusy(false) }
  }

  async function save(rank: Rank) {
    const draft = edits[rank.id] ?? { name_bn: rank.name_bn, multiplier: String(rank.target_multiplier_pct), active: rank.is_active }
    const multiplier = Number(draft.multiplier)
    if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 300) {
      setFailure(L('শতাংশ ০ থেকে ৩০০-এর মধ্যে হতে হবে।', 'Percentage must be between 0 and 300.'))
      return
    }
    setBusy(true); setFailure('')
    try {
      await teamRpc('data_entry_rank_save', {
        p_zone: zone, p_rank_id: rank.id,
        p_name_bn: draft.name_bn, p_name: null,
        p_multiplier: multiplier, p_is_active: draft.active, p_version: rank.revision,
      })
      setEdits(prev => { const next = { ...prev }; delete next[rank.id]; return next })
      await onChanged()
    } catch (e) { setFailure(errorText(e)) }
    finally { setBusy(false) }
  }

  return <section className="panel data-entry-panel">
    <h2>{L('সিনিয়র র‍্যাংক ১–৮', 'Senior ranks 1–8')}</h2>
    {loading && <p role="status">{L('র‍্যাংক লোড হচ্ছে…', 'Loading ranks…')}</p>}
    {error ? <p className="da-error" role="alert">{errorText(error)}</p> : null}
    {failure && <p className="da-error" role="alert">{failure}</p>}
    {!loading && !error && ranks.length === 0 && <>
      <p>{L('এই জোনে এখনো কোনো র‍্যাংক সেট করা হয়নি।', 'No ranks have been set for this zone yet.')}</p>
      <button type="button" disabled={busy} onClick={() => void seed()}>
        {L('ডিফল্ট ১–৮ র‍্যাংক তৈরি করুন', 'Seed default ranks 1–8')}
      </button>
    </>}
    {ranks.length > 0 && <div className="data-entry-ranks">
      {ranks.map(rank => {
        const draft = edits[rank.id] ?? { name_bn: rank.name_bn, multiplier: String(rank.target_multiplier_pct), active: rank.is_active }
        const dirty = draft.name_bn !== rank.name_bn || draft.multiplier !== String(rank.target_multiplier_pct) || draft.active !== rank.is_active
        return <div className="data-entry-rank-row" key={rank.id}>
          <strong>#{rank.rank_number}</strong>
          <label className="data-entry-field">{L('নাম', 'Name')}
            <input value={draft.name_bn} maxLength={60}
              onChange={e => setEdits(prev => ({ ...prev, [rank.id]: { ...draft, name_bn: e.currentTarget.value } }))} />
          </label>
          <label className="data-entry-field">{L('শতাংশ', 'Percent')}
            <input type="number" min={0} max={300} step="0.01" value={draft.multiplier}
              onChange={e => setEdits(prev => ({ ...prev, [rank.id]: { ...draft, multiplier: e.currentTarget.value } }))} />
          </label>
          <label className="data-entry-check">
            <input type="checkbox" checked={draft.active}
              onChange={e => setEdits(prev => ({ ...prev, [rank.id]: { ...draft, active: e.currentTarget.checked } }))} />
            {L('সক্রিয়', 'Active')}
          </label>
          <button type="button" disabled={!dirty || busy} onClick={() => void save(rank)}>
            {L('সংরক্ষণ', 'Save')}
          </button>
        </div>
      })}
      <p className="data-entry-note">{L(
        'শতাংশ অদ্যই সংরক্ষিত হবে, কিন্তু টার্গেট বণ্টনে এটি এখনো প্রয়োগ হয়নি (পরবর্তী release)।',
        'Percentages save now but are not yet applied to target distribution (next release).'
      )}</p>
    </div>}
  </section>
}

function RankAssign({ zone, member, ranks, onSaved }: {
  zone: string
  member: Member
  ranks: Rank[]
  onSaved: () => Promise<void>
}) {
  const { L } = usePrefs()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  if (ranks.length === 0) return null
  async function change(value: string) {
    setBusy(true); setFailure('')
    try {
      await teamRpc('data_entry_rank_assign', { p_zone: zone, p_member: member.id, p_rank_id: value || null })
      await onSaved()
    } catch (e) { setFailure(errorText(e)) }
    finally { setBusy(false) }
  }
  return <div className="data-entry-rank-assign">
    <label>{L('র‍্যাংক', 'Rank')}
      <select disabled={busy} value={member.rank_id ?? ''} onChange={e => void change(e.currentTarget.value)}>
        <option value="">{L('নির্ধারিত নয়', 'Unassigned')}</option>
        {ranks.map(r => <option key={r.id} value={r.id}>#{r.rank_number} · {r.name_bn} · {r.target_multiplier_pct}%</option>)}
      </select>
    </label>
    {failure && <span className="da-error" role="alert">{failure}</span>}
  </div>
}
