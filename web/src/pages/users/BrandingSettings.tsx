import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Field, useLoad, useToast } from '../accounts/ui'
import { usePrefs } from '../../lib/prefs'
import { brandingFriendly, DEFAULT_BRANDING, forgetBranding, loadBranding, saveBranding, type Branding } from '../../lib/branding'

const MAX_BYTES = 262144
const TYPES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']

/** The default mark: a square with the short name, drawn as a picture. */
function markFrom(short: string, primary: string, dark: string) {
  const t = (short || 'X').slice(0, 3).toUpperCase()
  const size = t.length === 1 ? 30 : t.length === 2 ? 22 : 17
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>`
    + `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${primary}'/><stop offset='1' stop-color='${dark}'/></linearGradient></defs>`
    + `<rect width='64' height='64' rx='15' fill='url(%23g)'/>`
    + `<text x='32' y='32' text-anchor='middle' dominant-baseline='central' fill='white' font-family='Inter,Arial,sans-serif' font-weight='700' font-size='${size}'>${t}</text></svg>`
  return 'data:image/svg+xml,' + svg.replace(/#/g, '%23').replace(/\s{2,}/g, ' ')
}

/** Name, mark, pictures and colour — everything people see before anything else. */
export function BrandingSettings() {
  const { can } = useAuth()
  const { L } = usePrefs()
  const { toast, node } = useToast()
  const allowed = can('system.settings.configure')
  const loaded = useLoad(() => loadBranding(), [])
  const [d, setD] = useState<Branding | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (loaded.data) setD(loaded.data) }, [loaded.data])
  const logoRef = useRef<HTMLInputElement>(null)
  const iconRef = useRef<HTMLInputElement>(null)

  async function pick(file: File | undefined, where: 'logo' | 'favicon') {
    setErr('')
    if (!file || !d) return
    if (!TYPES.includes(file.type)) return setErr(L('শুধু SVG, PNG, JPEG বা WebP ছবি দেওয়া যাবে।', 'Only SVG, PNG, JPEG or WebP pictures can be used.'))
    if (file.size > MAX_BYTES * 0.7) return setErr(L('ছবিটি অনেক বড় — ১৮০ কিলোবাইটের মধ্যে রাখুন।', 'That picture is too large — keep it under 180 KB.'))
    const url = await new Promise<string>((res, rej) => {
      const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('read')); r.readAsDataURL(file)
    })
    if (url.length > MAX_BYTES) return setErr(L('ছবিটি অনেক বড় — ছোট করে আবার দিন।', 'That picture is too large — shrink it and try again.'))
    if (/<script|javascript:|on\w+=/i.test(decodeURIComponent(url.slice(0, 20000)))) {
      return setErr(L('এই ছবির ভেতরে এমন কিছু আছে যা চলতে পারে — অন্য ছবি দিন।', 'That picture carries something that can run — use another one.'))
    }
    setD({ ...d, [where]: url })
  }

  async function save() {
    if (!d) return
    setErr(''); setBusy(true)
    try {
      await saveBranding({
        company_name: d.company_name.trim() || DEFAULT_BRANDING.company_name,
        name_bn: d.name_bn.trim() || d.company_name.trim(),
        short_name: (d.short_name.trim() || 'X').slice(0, 3),
        tagline: { bn: d.tagline.bn.trim(), en: d.tagline.en.trim() },
        system_title: d.system_title.trim() || d.company_name.trim(),
        logo: d.logo, favicon: d.favicon ?? d.logo,
        theme: { primary: d.theme.primary, primaryDark: d.theme.primaryDark },
      })
      forgetBranding(d)
      toast(L('সেভ হয়েছে — নাম ও লোগো সবখানে বসেছে', 'Saved — the name and mark are now everywhere'))
    } catch (e) { setErr(brandingFriendly(e)) } finally { setBusy(false) }
  }

  const preview = d?.logo ?? (d ? markFrom(d.short_name, d.theme.primary, d.theme.primaryDark) : '')

  return <AppShell title={L('নাম, লোগো ও রঙ', 'Name, logo and colour')}
    subtitle={L('এই সিস্টেমের নাম, মার্ক, ট্যাব আইকন আর মূল রঙ — লগইন পেজ থেকে শুরু করে সবখানে এগুলোই দেখা যাবে।',
      'The name, the mark, the tab icon and the main colour — these are what shows everywhere, starting with the login page.')}
    actions={allowed && d ? <button disabled={busy} onClick={() => void save()}>{busy ? L('সেভ হচ্ছে…', 'Saving…') : L('সেভ করুন', 'Save')}</button> : null}>
    {node}
    {!allowed && <p className="notice">{L('এই পাতা বদলানোর অনুমতি আপনার নেই।', 'You are not allowed to change this page.')}</p>}
    {loaded.error ? <p className="da-error">{brandingFriendly(loaded.error)}</p> : null}
    {!d ? <p className="muted">{L('লোড হচ্ছে…', 'Loading…')}</p> : <>
      <section className="panel">
        <h2>{L('নাম', 'Name')}</h2>
        <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label={L('নাম (ইংরেজি)', 'Name (English)')}><input value={d.company_name} disabled={!allowed} onChange={e => setD({ ...d, company_name: e.target.value })} /></Field>
          <Field label={L('নাম (বাংলা)', 'Name (Bangla)')}><input value={d.name_bn} disabled={!allowed} onChange={e => setD({ ...d, name_bn: e.target.value })} /></Field>
          <Field label={L('ছোট মার্ক', 'Short mark')} hint={L('লোগো না থাকলে এই অক্ষরগুলো বসবে (৩টির মধ্যে)', 'Used when there is no picture (up to 3 letters)')}>
            <input value={d.short_name} maxLength={3} disabled={!allowed} onChange={e => setD({ ...d, short_name: e.target.value })} /></Field>
          <Field label={L('ব্রাউজার ট্যাবের নাম', 'Browser tab title')}><input value={d.system_title} disabled={!allowed} onChange={e => setD({ ...d, system_title: e.target.value })} /></Field>
          <Field wide label={L('এক লাইনের পরিচয় (বাংলা)', 'One line about it (Bangla)')}>
            <input value={d.tagline.bn} disabled={!allowed} onChange={e => setD({ ...d, tagline: { ...d.tagline, bn: e.target.value } })} /></Field>
          <Field wide label={L('এক লাইনের পরিচয় (ইংরেজি)', 'One line about it (English)')}>
            <input value={d.tagline.en} disabled={!allowed} onChange={e => setD({ ...d, tagline: { ...d.tagline, en: e.target.value } })} /></Field>
        </div>
      </section>

      <section className="panel">
        <h2>{L('লোগো ও ট্যাব আইকন', 'Logo and tab icon')}</h2>
        <p className="muted small">{L('SVG, PNG, JPEG বা WebP — ১৮০ কিলোবাইটের মধ্যে। বর্গাকার ছবি সবচেয়ে ভালো বসে। ছবি না দিলে ছোট মার্কের অক্ষরগুলো দিয়ে একটা মার্ক বানিয়ে নেওয়া হবে।',
          'SVG, PNG, JPEG or WebP, under 180 KB. A square picture sits best. With no picture, a mark is drawn from the short letters.')}</p>
        <div className="brand-row">
          <div className="brand-prev">
            <img src={preview} alt="" width={96} height={96} />
            <span className="muted small">{L('লোগো', 'Logo')}</span>
          </div>
          <div className="brand-prev">
            <img src={d.favicon ?? preview} alt="" width={32} height={32} />
            <img src={d.favicon ?? preview} alt="" width={16} height={16} />
            <span className="muted small">{L('ট্যাব আইকন', 'Tab icon')}</span>
          </div>
          <div className="brand-prev" style={{ background: d.theme.primary }}>
            <span style={{ color: '#fff', fontWeight: 700 }}>{L('মূল রঙ', 'Main colour')}</span>
          </div>
        </div>
        {allowed && <div className="row" style={{ flexWrap: 'wrap', marginTop: 10 }}>
          <input ref={logoRef} type="file" accept={TYPES.join(',')} hidden onChange={e => void pick(e.target.files?.[0], 'logo')} />
          <input ref={iconRef} type="file" accept={TYPES.join(',')} hidden onChange={e => void pick(e.target.files?.[0], 'favicon')} />
          <button className="secondary" onClick={() => logoRef.current?.click()}><Icon name="upload" size={16} />{L('লোগো দিন', 'Choose a logo')}</button>
          <button className="secondary" onClick={() => iconRef.current?.click()}><Icon name="upload" size={16} />{L('ট্যাব আইকন দিন', 'Choose a tab icon')}</button>
          <button className="secondary" onClick={() => setD({ ...d, logo: markFrom(d.short_name, d.theme.primary, d.theme.primaryDark), favicon: null })}>
            {L('অক্ষর দিয়ে মার্ক বানান', 'Draw one from the letters')}</button>
          <button className="secondary" onClick={() => setD({ ...d, logo: null, favicon: null })}>{L('ছবি সরান', 'Remove the pictures')}</button>
        </div>}
        <div className="hr-form" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
          <Field label={L('মূল রঙ', 'Main colour')}><input type="color" value={d.theme.primary} disabled={!allowed}
            onChange={e => setD({ ...d, theme: { ...d.theme, primary: e.target.value } })} /></Field>
          <Field label={L('গাঢ় রঙ', 'Darker shade')}><input type="color" value={d.theme.primaryDark} disabled={!allowed}
            onChange={e => setD({ ...d, theme: { ...d.theme, primaryDark: e.target.value } })} /></Field>
        </div>
        {err && <p className="da-error">{err}</p>}
        {allowed && <p className="muted small">{L('মনে রাখবেন: ফোনের অ্যাপের আইকন এখান থেকে বদলায় না — সেটা অ্যাপ বানানোর সময় বসে।',
          'One thing to know: the phone app’s own icon does not change from here — that one is set when the app is built.')}</p>}
      </section>
    </>}
  </AppShell>
}
