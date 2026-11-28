import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { usePrefs } from '../../lib/prefs'
import { supabase } from '../../lib/supabase'
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
}
type Snapshot = { hubs: Hub[]; members: Member[] }

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
  const [selection, setSelection] = useState('')
  const zone = zones.data?.find(item => item.id === selection) ?? zones.data?.[0]

  if (preview) return <AppShell title={L(dataEntryPages[page][0], dataEntryPages[page][1])}>
    <p>{L('টিম পরিচালনার জন্য নিজের অ্যাকাউন্টের ভিউতে ফিরুন।', 'Return to your own account view to manage the team.')}</p>
  </AppShell>

  return <AppShell title={L(dataEntryPages[page][0], dataEntryPages[page][1])}>
    {zones.loading && <p role="status">{L('জোন লোড হচ্ছে…', 'Loading zones…')}</p>}
    {zones.error ? <p className="da-error" role="alert">{errorText(zones.error)}</p> : null}
    {!zones.loading && !zones.error && !zone && <p>{L('এই টিম পরিচালনার জন্য কোনো জোনে আপনার অনুমতি নেই।', 'You do not have access to manage this team in a zone.')}</p>}
    {zone && <>
      <label className="data-entry-field">{L('জোন', 'Zone')}
        <select value={zone.id} onChange={e => setSelection(e.currentTarget.value)}>
          {zones.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <ZoneTeam key={zone.id + page} zone={zone.id} page={page} />
    </>}
  </AppShell>
}

function ZoneTeam({ zone, page }: { zone: string; page: EntryPage }) {
  const { L } = usePrefs()
  const team = useLoad(() => teamRpc<Snapshot>('data_entry_team_snapshot', { p_zone: zone }), [zone])
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
            <div>{team.data?.hubs.find(hub => hub.id === member.primary_hub_id)?.name ?? L('প্রাথমিক হাব এখন পাওয়া যাচ্ছে না', 'Primary hub unavailable')}</div>
            <div>{member.is_active && member.eligible ? L('সক্রিয়', 'Active') : L('নিষ্ক্রিয়', 'Inactive')}</div>
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
