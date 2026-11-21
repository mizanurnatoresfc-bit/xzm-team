import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { docs, hr, hrFriendly, MISSING } from '../lib/hr'
import { hrReq } from '../lib/hrreq'
import { usePrefs } from '../lib/prefs'
import { useLoad, useToast } from './accounts/ui'
import { ProfileFill } from './hr/ProfileFill'
import { refreshMyPhoto } from '../lib/myPhoto'
import { shrinkImage } from '../lib/shrinkImage'

/**
 * আমার প্রোফাইল পূর্ণ করুন — a staff member completes their own profile: how full it is, what is still missing,
 * one form for the details, and one tap each for the photo and the NID images (camera or gallery). Everything saves at once.
 */
const PICS: Array<[type: string, bn: string, en: string]> = [['photo', 'নিজের ছবি', 'Your photo'], ['nid_front', 'এনআইডি — সামনে', 'NID — front'], ['nid_back', 'এনআইডি — পেছনে', 'NID — back']]

export function MyProfileComplete() {
  const { L, n } = usePrefs()
  const { toast, node } = useToast()
  const me = useLoad(() => hrReq.myEmployee(), [])
  const id = me.data?.id ?? ''
  const gap = useLoad(() => id ? hr.myProfileGap(id) : Promise.resolve(null), [id])
  const files = useLoad(() => id ? docs.list(id) : Promise.resolve([]), [id])
  const [form, setForm] = useState(false)
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const g = gap.data
  const pct = g ? Math.round(100 * (g.total_checks - g.missing.length) / Math.max(1, g.total_checks)) : null
  const has = (t: string) => (files.data ?? []).some(d => d.doc_type === t)
  async function upload(type: string, f: File | undefined) {
    if (!f || !id) return
    setBusy(type); setErr('')
    try { await docs.upload(id, type, await shrinkImage(f, type === 'photo' ? 900 : 1600)); if (type === 'photo') refreshMyPhoto(); await Promise.all([files.reload(), gap.reload()]); toast(L('ছবি জমা হয়েছে', 'Uploaded')) }
    catch (e) { setErr(hrFriendly(e)) } finally { setBusy('') }
  }
  return <AppShell title={L('আমার প্রোফাইল পূর্ণ করুন', 'Complete my profile')} subtitle={L('যা দেবেন সাথে সাথে সেভ হবে', 'Everything saves at once')}>
    <div className="sd mpc">{node}
      {me.loading && !me.data ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p>
      : !me.data ? <p className="notice">{L('আপনার লগইনের সাথে কোনো কর্মী প্রোফাইল যুক্ত নেই — হাব ম্যানেজারকে বলুন।', 'No staff profile is linked to your login — tell your hub manager.')}</p>
      : <>
        <section className="panel mpc-head">
          <div className="mpc-ring" style={{ ['--p' as string]: `${pct ?? 0}` }}><b>{pct === null ? '—' : `${n(pct)}%`}</b></div>
          <div><h2 style={{ margin: 0 }}>{me.data.full_name}</h2>
            <p className="muted" style={{ margin: 0 }}>{pct === 100 ? L('আপনার প্রোফাইল পুরোপুরি পূর্ণ — ধন্যবাদ!', 'Your profile is complete — thank you!')
              : g ? L(`আরও ${n(g.missing.length)}টি তথ্য বাকি`, `${g.missing.length} things left`) : ''}</p></div>
        </section>
        {g && g.missing.length > 0 && <section className="panel"><h2>{L('যা বাকি', 'Still missing')}</h2>
          <div className="mpc-miss">{g.missing.map(k => <span key={k}>{MISSING[k] ?? k.replace(/^(field|document):/, '')}</span>)}</div></section>}

        <button type="button" className="sp-cta mpc-cta" onClick={() => setForm(true)}><Icon name="edit" size={20} />{L('আমার তথ্য লিখুন', 'Fill in my details')}</button>
        <p className="muted small" style={{ margin: '0 4px' }}>{L('মোবাইল, জরুরি যোগাযোগ, রক্তের গ্রুপ, জন্মতারিখ, এনআইডি নম্বর, বাবা-মায়ের নাম, ঠিকানা — যা জানেন লিখুন, ফাঁকা ঘর আগের তথ্য মুছবে না।',
          'Mobile, emergency contact, blood group, date of birth, NID, parents, address — fill what you know; an empty box never removes what is on file.')}</p>

        <h2 className="sd-h">{L('ছবি ও এনআইডি', 'Photo & NID')}</h2>
        <div className="mpc-pics">{PICS.map(([t, b, e]) => <label key={t} className={`mpc-pic${has(t) ? ' done' : ''}`}>
          <span className="i"><Icon name={has(t) ? 'check' : 'upload'} size={22} /></span>
          <b>{L(b, e)}</b><small>{busy === t ? L('জমা হচ্ছে…', 'Uploading…') : has(t) ? L('জমা আছে — বদলাতে আবার দিন', 'On file — tap to replace') : L('ক্যামেরা বা গ্যালারি থেকে দিন', 'Camera or gallery')}</small>
          <input type="file" accept="image/*" disabled={!!busy} onChange={e => void upload(t, e.target.files?.[0])} /></label>)}</div>
        {err && <p className="da-error" role="alert">{err}</p>}
        <p className="muted small" style={{ margin: '0 4px' }}><Link to="/app/me">{L('← আমার প্রোফাইলে ফিরুন', '← Back to my profile')}</Link></p>
      </>}
    </div>
    {form && id && <ProfileFill employee={id} onClose={() => setForm(false)} onDone={m => { setForm(false); toast(m); void gap.reload() }} />}
  </AppShell>
}
