import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { fleet, type FormField } from '../../lib/fleet'

/** A photo kept in the private bucket, shown through a short-lived link; tap to open it large. */
export function Thumb({ path, size = 64 }: { path: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { let on = true; void fleet.photoUrl(path).then(u => { if (on) setUrl(u) }).catch(() => setUrl(null)); return () => { on = false } }, [path])
  return url ? <a href={url} target="_blank" rel="noreferrer" className="fl-thumb" style={{ width: size, height: size }}><img src={url} alt="ছবি" /></a>
    : <span className="fl-thumb empty" style={{ width: size, height: size }}><Icon name="file" size={18} /></span>
}

/** Pick photos (camera or gallery); each is uploaded at once under the vehicle's folder. */
export function PhotoPick({ vehicle, value, onChange, max = 6, label = 'ছবি দিন' }: { vehicle: string; value: string[]; onChange: (v: string[]) => void; max?: number; label?: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  async function add(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setErr('')
    try {
      const room = Math.max(max - value.length, 0)
      const paths: string[] = []
      for (const f of Array.from(files).slice(0, room)) paths.push(await fleet.upload(vehicle, f))
      onChange([...value, ...paths])
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return <div className="fl-photos">
    {value.map(p => <span key={p} className="fl-ph"><Thumb path={p} size={64} />
      <button type="button" className="fl-ph-x" aria-label="ছবি সরান" onClick={() => onChange(value.filter(x => x !== p))}><Icon name="x" size={12} /></button></span>)}
    {value.length < max && <label className={`fl-add${busy ? ' busy' : ''}`}><Icon name="plus" size={20} /><span>{busy ? 'উঠছে…' : label}</span>
      <input type="file" accept="image/*" multiple={max > 1} disabled={busy} onChange={e => { void add(e.target.files); e.target.value = '' }} /></label>}
    {err && <p className="da-error" style={{ flexBasis: '100%' }}>{err}</p>}
  </div>
}

/** The boxes of a format the settings define (service / parts / problem). */
export function FormFields({ fields, data, onChange }: { fields: FormField[]; data: Record<string, string>; onChange: (d: Record<string, string>) => void }) {
  const set = (k: string, v: string) => onChange({ ...data, [k]: v })
  return <>{fields.map(f => <label key={f.key} className="da-field wide"><span>{f.label}{f.required && <b className="req"> *</b>}</span>
    {f.type === 'textarea' ? <textarea rows={3} value={data[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />
      : f.type === 'select' ? <div className="fl-chips">{(f.options ?? []).map(o => <button key={o} type="button" className={`nv-chip${data[f.key] === o ? ' on' : ''}`} aria-pressed={data[f.key] === o}
          onClick={() => set(f.key, data[f.key] === o ? '' : o)}>{o}</button>)}</div>
      : <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'phone' ? 'tel' : f.type === 'number' ? 'decimal' : undefined}
          value={data[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} />}
  </label>)}</>
}

export const missing = (fields: FormField[], data: Record<string, string>) => fields.find(f => f.required && !String(data[f.key] ?? '').trim())
export const tk = (n: number | null | undefined) => `৳ ${Math.round(Number(n ?? 0)).toLocaleString('bn-BD')}`
export const bnNum = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('bn-BD')
export const dayBn = (d: string) => new Date(d.length > 10 ? d : d + 'T00:00:00').toLocaleDateString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short' })
export const timeBn = (t: string) => new Date(t).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
export const todayDhaka = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
