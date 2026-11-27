import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { hubLabel, org, type Hub } from '../lib/hr'
import { usePrefs } from '../lib/prefs'
import { isWorkHubBlocked, resolveWorkHub, saveWorkHub, useWorkHub } from '../lib/workHub'
import './work-hub-selector.css'

export function WorkHubSelector() {
  const { session, grants, viewAs } = useAuth()
  const { L } = usePrefs()
  const user = session?.user.id ?? ''
  const saved = useWorkHub(user)
  const [result, setResult] = useState<{ user: string; grants: typeof grants; hubs: Hub[] }>()
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!user || viewAs) return
    let request = 0
    let active = true
    const load = () => {
      const id = ++request
      void org.hubs().then(hubs => {
        if (!active || request !== id) return
        setResult({ user, grants, hubs: hubs.filter(hub => !hub.archived_at) })
        setFailed(false)
      }).catch(() => {
        if (!active || request !== id) return
        setResult(undefined)
        setFailed(true)
      })
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      active = false
      window.removeEventListener('focus', load)
    }
  }, [user, grants, viewAs])

  if (!user || viewAs) return null
  const hubs = result?.user === user && result.grants === grants ? result.hubs : []
  if (!hubs.length) return failed ? <span role="status" className="small muted">{L('হাব লোড হয়নি', 'Hubs unavailable')}</span> : null
  const current = resolveWorkHub(hubs, saved)
  const label = L('কাজের হাব', 'Working hub')

  return <>
    <select className="work-hub-select" aria-label={label} title={current ? hubLabel(current) : label}
      value={current?.id ?? ''} disabled={hubs.length === 1 && !!current}
      onChange={event => {
        const id = event.currentTarget.value
        if (!hubs.some(hub => hub.id === id)) return
        if (isWorkHubBlocked(user)) {
          setMessage(L('হাব বদলানোর আগে বর্তমান কাজ সেভ করুন।', 'Save your current work before switching hubs.'))
        } else if (!saveWorkHub(user, id)) {
          setMessage(L('এই ডিভাইসে হাব সেভ করা যায়নি।', 'Could not save the hub on this device.'))
        } else {
          setMessage('')
        }
      }}>
      {!current && <option value="" disabled>{label}</option>}
      {hubs.map(hub => <option key={hub.id} value={hub.id}>{hubLabel(hub)}</option>)}
    </select>
    {message && <div className="da-toast" role="status" onClick={() => setMessage('')}>{message}</div>}
  </>
}
