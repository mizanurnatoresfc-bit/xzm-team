import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { askConfirm } from '../../components/ask'
import { AppShell } from '../../components/AppShell'
import { RELEASE_STAGES, routeModules, type ModuleRelease, type ReleasePlatform } from '../../lib/moduleRelease'
import { releaseSnapshot, useRelease } from '../../lib/releaseAccess'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'

type Choice = { id: string; name: string; code?: string }
type Evidence = { pr: number; commit_sha: string; test_run: number; test_result: string; deployment: string }
type Entry = { id: string; parent: string | null; revision: number; config: ModuleRelease; evidence: Evidence | null; verified: boolean }
type Catalog = { modules: Entry[]; roles: Choice[]; hubs: Choice[] }
type Audit = { id: number; actor: string; created_at: string; before_config: ModuleRelease; after_config: ModuleRelease; rollback_of: number | null }

const repo = 'https://github.com/mizanurnatoresfc-bit/xzm-team'
const stageLabels: Record<ModuleRelease['stage'], string> = {
  planning: 'Planning', development: 'Development', testing: 'Testing', ready: 'Release Ready',
  published: 'Published', maintenance: 'Maintenance', disabled: 'Disabled',
}

function errorText(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
}

export default function ModuleControl() {
  const { viewAs, setViewAs } = useAuth()
  const [catalog, setCatalog] = useState<Catalog>()
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    void supabase.rpc('module_release_admin').then(({ data, error: failure }) => {
      if (!active) return
      if (failure) setError(failure.message)
      else {
        setError('')
        setCatalog(data as Catalog)
        setSelected(value => value || (data as Catalog).modules[0]?.id || '')
      }
    })
    return () => { active = false }
  }, [reload])
  const entry = catalog?.modules.find(module => module.id === selected)
  const matches = catalog?.modules.filter(module => module.id.includes(query.trim().toLowerCase()))
  return <AppShell title="মডিউল নিয়ন্ত্রণ কেন্দ্র">
    {error && <p role="alert" className="da-error">{error} <button onClick={() => setReload(n => n + 1)}>আবার চেষ্টা করুন</button></p>}
    {viewAs && <button onClick={() => setViewAs(null)}>সুপার অ্যাডমিনে ফিরুন</button>}
    {!catalog && !error && <p role="status">লোড হচ্ছে…</p>}
    {catalog && <section className="panel">
      <label>মডিউল খুঁজুন <input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>{' '}
      <label>মডিউল <select value={selected} onChange={event => setSelected(event.target.value)}>
        {entry && !matches?.includes(entry) && <option value={entry.id}>{entry.id}</option>}
        {matches?.map(module => <option key={module.id} value={module.id}>{module.id}</option>)}
      </select></label>
      <p><Link to="/app/menu">Menu Editor</Link> · <Link to="/app/menu-roles">Role permissions</Link> · <Link to="/app/role-dashboards">Role dashboard</Link></p>
    </section>}
    {entry && catalog && <ModuleSettings key={entry.id + ':' + entry.revision} entry={entry} catalog={catalog}
      onSaved={() => setReload(value => value + 1)} />}
  </AppShell>
}

function ModuleSettings({ entry, catalog, onSaved }: { entry: Entry; catalog: Catalog; onSaved: () => void }) {
  const release = useRelease()
  const [config, setConfig] = useState<ModuleRelease>(() => entry.config.stage === 'ready' && !entry.verified
    ? { ...entry.config, stage: 'testing' }
    : entry.config)
  const [history, setHistory] = useState<Audit[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [role, setRole] = useState('')
  const [hub, setHub] = useState('')
  const [platform, setPlatform] = useState<ReleasePlatform>('web')
  const [preview, setPreview] = useState<string>()
  const [user, setUser] = useState('')
  const paths = Object.entries(routeModules).filter(([, id]) => id === entry.id).map(([path]) => path)

  useEffect(() => {
    let active = true
    void supabase.rpc('module_release_history', { p_module: entry.id }).then(({ data, error: failure }) => {
      if (!active) return
      if (failure) setError(failure.message)
      else setHistory(data as Audit[])
    })
    return () => { active = false }
  }, [entry.id])

  async function save(next: ModuleRelease, rollback?: number) {
    setBusy(true)
    setError('')
    setPreview(undefined)
    try {
      const { error: failure } = await supabase.rpc('module_release_save', {
        p_module: entry.id, p_revision: entry.revision, p_config: next, p_rollback: rollback ?? null,
      })
      if (failure) throw failure
      release.refresh()
      onSaved()
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  async function previewSaved() {
    setPreview(undefined)
    setError('')
    try {
      const snapshot = await releaseSnapshot(platform, hub || null, role || null)
      setPreview(snapshot[entry.id]?.allowed ? 'Release policy allows access' : 'Release policy blocks access')
    } catch (failure) { setError(errorText(failure)) }
  }

  const evidence = entry.evidence
  return <>
    <section className="panel">
      <h2>{entry.id}</h2>
      <p>{paths.join(' · ') || 'Function'}</p>
      {entry.parent && <p>Dependency · {entry.parent}</p>}
      <p>Saved status · {entry.config.stage === 'ready' && !entry.verified ? 'Verification required' : stageLabels[entry.config.stage]}</p>
      {evidence ? <p>
        <a href={repo + '/pull/' + evidence.pr}>PR #{evidence.pr}</a> · <a href={repo + '/commit/' + evidence.commit_sha}>{evidence.commit_sha.slice(0, 8)}</a>
        {' · '}<a href={repo + '/actions/runs/' + evidence.test_run}>Tests {evidence.test_result}</a> · Deployment {evidence.deployment}
      </p> : <p>Verification evidence pending</p>}
      {error && <p role="alert" className="da-error">{error}</p>}
      <form onSubmit={event => { event.preventDefault(); void save(config) }}>
        <fieldset disabled={busy}>
          <label>Status <select value={config.stage} onChange={event => setConfig({ ...config, stage: event.target.value as ModuleRelease['stage'] })}>
            {RELEASE_STAGES.map(stage => <option key={stage} value={stage} disabled={stage === 'ready' && !entry.verified}>{stageLabels[stage]}</option>)}
          </select></label>{' '}
          <label><input type="checkbox" checked={config.enabled} onChange={event => setConfig({ ...config, enabled: event.target.checked })} /> Enabled</label>{' '}
          <label><input type="checkbox" checked={config.demo} onChange={event => setConfig({ ...config, demo: event.target.checked })} /> DEMO Hub testing</label>
          <div>{(['web', 'android'] as const).map(item => <label key={item}>
            <input type="checkbox" checked={config.platforms.includes(item)} onChange={event => setConfig({
              ...config, platforms: event.target.checked ? [...config.platforms, item] : config.platforms.filter(value => value !== item),
            })} /> {item}{' '}
          </label>)}</div>
          <label>Menu order <input type="number" min="-99999999" max="99999999" value={config.menu_order ?? ''}
            onChange={event => setConfig({ ...config, menu_order: event.target.value === '' ? null : event.target.valueAsNumber })} /></label>
          <ScopePicker label="Allowed roles" choices={catalog.roles} value={config.roles} onChange={roles => setConfig({ ...config, roles })} />
          <ScopePicker label="Allowed hubs" choices={catalog.hubs} value={config.hubs} onChange={hubs => setConfig({ ...config, hubs })} />
          <fieldset>
            <legend>User exceptions</legend>
            <label>User UUID <input value={user} onChange={event => setUser(event.target.value.trim())} /></label>{' '}
            <button type="button" disabled={!user} onClick={() => { setConfig({ ...config, users: { ...config.users, [user]: true } }); setUser('') }}>Allow</button>{' '}
            <button type="button" disabled={!user} onClick={() => { setConfig({ ...config, users: { ...config.users, [user]: false } }); setUser('') }}>Deny</button>
            {Object.entries(config.users).map(([id, allowed]) => <div key={id}>{id} · {allowed ? 'Allow' : 'Deny'}{' '}
              <button type="button" onClick={() => setConfig({ ...config, users: Object.fromEntries(Object.entries(config.users).filter(([key]) => key !== id)) })}>Remove</button>
            </div>)}
          </fieldset>
          <button type="submit">Save</button>{' '}
          {entry.config.stage === 'published'
            ? <button type="button" onClick={() => void save({ ...entry.config, stage: 'development' })}>Unpublish</button>
            : <button type="button" onClick={() => void save({ ...entry.config, stage: 'published' })}>Publish</button>}
        </fieldset>
      </form>
    </section>
    <section className="panel">
      <h2>Saved release policy preview</h2>
      <label>Role <select aria-label="Role" value={role} onChange={event => { setRole(event.target.value); setPreview(undefined) }}>
        <option value="">My roles</option>{catalog.roles.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
      </select></label>{' '}
      <label>Hub <select aria-label="Hub" value={hub} onChange={event => { setHub(event.target.value); setPreview(undefined) }}>
        <option value="">Default scope</option>{catalog.hubs.map(choice => <option key={choice.id} value={choice.id}>{choice.name} ({choice.code})</option>)}
      </select></label>{' '}
      <label>Platform <select aria-label="Platform" value={platform} onChange={event => { setPlatform(event.target.value as ReleasePlatform); setPreview(undefined) }}>
        <option value="web">Web</option><option value="android">Android</option>
      </select></label>{' '}
      <button onClick={() => void previewSaved()}>Preview</button>
      {preview && <p role="status">{preview}. Existing role permissions also apply.</p>}
    </section>
    <section className="panel">
      <h2>Release history</h2>
      {!history.length && <p>No configuration changes recorded.</p>}
      <ul>{history.map(record => <li key={record.id}>
        <time dateTime={record.created_at}>{new Date(record.created_at).toLocaleString()}</time>
        {' · '}{stageLabels[record.before_config.stage]} → {stageLabels[record.after_config.stage]} · {record.actor}
        {record.rollback_of && <> · Restored before change {record.rollback_of}</>}{' '}
        <button disabled={busy} onClick={async () => {
          if (await askConfirm('Restore the configuration from before this change?', { ok: 'Restore' })) {
            await save(config, record.id)
          }
        }}>Restore previous configuration</button>
      </li>)}</ul>
    </section>
  </>
}

function ScopePicker({ label, choices, value, onChange }: {
  label: string; choices: Choice[]; value: string[] | null; onChange: (ids: string[] | null) => void
}) {
  return <fieldset><legend>{label}</legend>
    <label><input type="checkbox" checked={value === null} onChange={event => onChange(event.target.checked ? null : [])} /> All</label>
    {value !== null && <select multiple aria-label={label} value={value}
      onChange={event => onChange(Array.from(event.target.selectedOptions, option => option.value))}>
      {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}{choice.code ? ' (' + choice.code + ')' : ''}</option>)}
      {value.filter(id => !choices.some(choice => choice.id === id)).map(id => <option key={id} value={id}>{id}</option>)}
    </select>}
  </fieldset>
}
