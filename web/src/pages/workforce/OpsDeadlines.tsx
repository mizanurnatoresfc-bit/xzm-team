import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { usePrefs } from '../../lib/prefs'
import { wf, wfFriendly, type OpsDeadlineTimes } from '../../lib/workforce'
import { Field, useLoad, useToast } from '../accounts/ui'
import { Empty, Loading, Section } from './shared'

const FIELDS = [
  { key: 'pickup', bn: 'পিকআপ', en: 'Pickup' },
  { key: 'pickup_return', bn: 'মার্চেন্টকে রিটার্ন জমা', en: 'Return to merchant' },
  { key: 'delivery_return', bn: 'ডেলিভারি রিটার্ন', en: 'Delivery return' },
  { key: 'delivery', bn: 'ডেলিভারি', en: 'Delivery' },
] as const

export function OpsDeadlineEditor({ zone }: { zone: string }) {
  const { L } = usePrefs()
  const { viewAs } = useAuth()
  const { toast, node } = useToast()
  const q = useLoad(() => zone ? wf.opsDeadlines(zone) : Promise.resolve(null), [zone])
  const [draft, setDraft] = useState<Partial<OpsDeadlineTimes>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const policy = q.data?.zone_id === zone ? q.data : null
  const value = (key: keyof OpsDeadlineTimes) => draft[key] ?? policy?.[key] ?? ''
  const dirty = FIELDS.some(({ key }) => value(key) !== (policy?.[key] ?? ''))

  async function save() {
    if (!zone || !policy || !dirty || saving || viewAs) return
    setError('')
    setSaving(true)
    try {
      await wf.saveOpsDeadlines(zone, {
        pickup: value('pickup') || null,
        pickup_return: value('pickup_return') || null,
        delivery_return: value('delivery_return') || null,
        delivery: value('delivery') || null,
      })
      await q.reload()
      setDraft({})
      toast(L('রিপোর্টের সময় সেভ হয়েছে।', 'Report deadlines saved.'))
    } catch (e) {
      setError(wfFriendly(e))
    } finally {
      setSaving(false)
    }
  }

  return <Section title={L('দৈনিক রিপোর্ট জমার সময়', 'Daily report deadlines')}
    hint={L('সব সময় বাংলাদেশ সময়ে। কোনো ঘর খালি রাখলে সেই রিপোর্টের জমার সময় নির্ধারিত থাকবে না। সময় পেরিয়েও এন্ট্রি ও সংশোধন করা যাবে।',
      'Times are in Bangladesh time. Leave a field blank to clear that deadline. Entries and corrections remain available after the deadline.')}>
    {node}
    {!zone ? <Empty>{L('সময় বদলানোর জন্য একটি অনুমোদিত জোন বেছে নিন।', 'Select a zone you can configure.')}</Empty>
      : q.error ? <p className="da-error" role="alert">{wfFriendly(q.error)}</p>
        : !policy ? q.loading ? <Loading /> : <Empty>{L('জোনের সময়সূচি পাওয়া যায়নি।', 'The zone’s deadlines are unavailable.')}</Empty>
          : <form onSubmit={e => { e.preventDefault(); void save() }}>
            <div className="hr-form" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
              {FIELDS.map(({ key, bn, en }) => <Field key={key} label={L(bn, en)}>
                <input type="time" value={value(key)} disabled={saving || !!viewAs} onChange={e => {
                  setError('')
                  setDraft({ ...draft, [key]: e.target.value })
                }} />
              </Field>)}
            </div>
            {error && <p className="da-error" role="alert">{error}</p>}
            {!viewAs && <button type="submit" disabled={!dirty || saving}>{saving ? L('সেভ হচ্ছে…', 'Saving…') : L('রিপোর্টের সময় সেভ করুন', 'Save report deadlines')}</button>}
          </form>}
  </Section>
}

export function OpsDeadlineSummary({ zone }: { zone: string }) {
  const { L } = usePrefs()
  const q = useLoad(() => wf.opsDeadlines(zone), [zone])
  if (q.error) return <p className="da-error" role="alert">{wfFriendly(q.error)}</p>
  const policy = q.data?.zone_id === zone ? q.data : null
  if (!policy) return null
  const scheduled = FIELDS.filter(({ key }) => policy[key])
  if (!scheduled.length) return <p className="muted">{L('রিপোর্টের জমার সময় এখনও সেট করা হয়নি।', 'Report deadlines have not been set.')}</p>

  return <div>
    <b>{L('জমার সময় (বাংলাদেশ সময়)', 'Deadlines (Bangladesh time)')}</b>
    <ul>{scheduled.map(({ key, bn, en }) => <li key={key}>{L(bn, en)} · {policy[key]}</li>)}</ul>
  </div>
}
