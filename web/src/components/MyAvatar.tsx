// নিজের ছবি — the signed-in person's own face everywhere in the app, and the one place a staff member puts up their own photo.
// With no photo yet, a friendly default shows instead: a team member in the dark Steadfast hoodie with the green mark on the chest.
import { useEffect, useId, useRef, useState } from 'react'
import { docs, hrFriendly } from '../lib/hr'
import { hrReq } from '../lib/hrreq'
import { usePrefs } from '../lib/prefs'
import { shrinkImage } from '../lib/shrinkImage'
import { refreshMyPhoto, useMyPhoto } from '../lib/myPhoto'
import { Icon } from './Icon'

const HOODIE = '#2B2B2E', HOOD_IN = '#1C1C1E', GREEN = '#01BE72', SKIN = '#D9A27C', HAIR = '#1F1A17'

/** The Steadfast mark (green quarter disc split on the diagonal, the two corner pieces, the small tail), drawn in a 0..100 box.
 *  `cut` is the colour of the gaps — the cloth it is printed on. */
function Mark({ cut, corner = '#fff' }: { cut: string; corner?: string }) {
  return <g strokeLinejoin="round">
    {/* the two corner pieces: the square outside the larger circle */}
    <path d="M0 0H100V100A100.4 100.4 0 0 0 0 0Z" fill={corner} />
    <path d="M100 100A100.4 100.4 0 0 0 0 0" fill="none" stroke={cut} strokeWidth="19" />
    {/* the green quarter disc */}
    <path d="M0 100V9.4A90.6 90.6 0 0 1 90.6 100Z" fill={GREEN} stroke={GREEN} strokeWidth="2" />
    {/* the diagonal gap, corner to corner */}
    <path d="M-4 104L104 -4" stroke={cut} strokeWidth="9.4" />
    {/* the tail */}
    <path d="M-31.5 101.5H-1.5V131.5Z" fill={GREEN} stroke={GREEN} strokeWidth="2" />
  </g>
}

/** The default avatar: a person in the Steadfast hoodie. Square; round it with CSS. */
export function HoodieAvatar({ title }: { title?: string }) {
  const id = useId().replace(/:/g, '')
  return <svg className="hoodie-av" viewBox="0 0 120 120" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
    <defs>
      <clipPath id={`c${id}`}><circle cx="60" cy="60" r="60" /></clipPath>
      <linearGradient id={`b${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E9FBF2" /><stop offset="1" stopColor="#C9F1DD" /></linearGradient>
    </defs>
    <g clipPath={`url(#c${id})`}>
      <rect width="120" height="120" fill={`url(#b${id})`} />
      <g transform="translate(9 3) scale(.85)">
        {/* body of the hoodie */}
        <path d="M0 160C2 104 26 84 60 84S118 104 120 160Z" fill={HOODIE} />
        <path d="M22 160C22 130 20 112 14 104M98 160C98 130 100 112 106 104" stroke="#202023" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* the hood around the head */}
        <path d="M60 18C38 18 27 35 28 56C29 73 38 86 60 90C82 86 91 73 92 56C93 35 82 18 60 18Z" fill="#36363A" />
        <path d="M60 24C43 24 35 38 36 56C37 71 45 81 60 84C75 81 83 71 84 56C85 38 77 24 60 24Z" fill={HOOD_IN} />
        {/* neck and face */}
        <path d="M52 72H68V86C64 89 56 89 52 86Z" fill="#C48E6A" />
        <ellipse cx="60" cy="56" rx="17" ry="20" fill={SKIN} />
        <ellipse cx="43.5" cy="58" rx="2.6" ry="4" fill="#C9906D" />
        <ellipse cx="76.5" cy="58" rx="2.6" ry="4" fill="#C9906D" />
        {/* hair under the hood */}
        <path d="M43 52C42 38 50 32 60 32C71 32 79 38 77 52C74 45 68 41 60 42C53 42 47 45 43 52Z" fill={HAIR} />
        {/* face */}
        <path d="M50.5 51.5Q54 49.5 57 51.5M63 51.5Q66 49.5 69.5 51.5" stroke={HAIR} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <circle cx="54" cy="57" r="2.1" fill={HAIR} /><circle cx="66" cy="57" r="2.1" fill={HAIR} />
        <path d="M60 59.5V63.5" stroke="#B9805E" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M54.5 67Q60 71.5 65.5 67" stroke="#8A4B33" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* hood rim and drawstrings */}
        <path d="M36 56C37 71 45 81 60 84C75 81 83 71 84 56" fill="none" stroke="#45454A" strokeWidth="2.4" />
        <path d="M52 85L49 97M68 85L71 97" stroke="#E8E8EA" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="49" cy="98.5" r="1.7" fill="#E8E8EA" /><circle cx="71" cy="98.5" r="1.7" fill="#E8E8EA" />
        {/* the Steadfast mark on the chest */}
        <g transform="translate(55 101) scale(.22)"><Mark cut={HOODIE} /></g>
      </g>
    </g>
  </svg>
}

/** My face: my photo when there is one, otherwise the hoodie avatar. Fills its (round) box. */
export function MyFace({ photo, title }: { photo: string | null | undefined; title?: string }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [photo])
  return photo && !broken ? <img className="my-face" src={photo} alt={title ?? ''} onError={() => setBroken(true)} /> : <HoodieAvatar title={title} />
}

/** My avatar with a camera button: tap it to put up my own photo (camera or gallery). It saves at once and shows everywhere. */
export function MyAvatarUpload({ className = '', onDone }: { className?: string; onDone?: (msg: string) => void }) {
  const { L } = usePrefs()
  const photo = useMyPhoto()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const input = useRef<HTMLInputElement>(null)
  async function pick(f: File | undefined) {
    if (input.current) input.current.value = ''
    if (!f) return
    setBusy(true); setErr('')
    try {
      const me = await hrReq.myEmployee()
      if (!me) throw new Error(L('আপনার লগইনের সাথে কোনো কর্মী প্রোফাইল যুক্ত নেই — হাব ম্যানেজারকে বলুন।', 'No staff profile is linked to your login — tell your hub manager.'))
      await docs.upload(me.id, 'photo', await shrinkImage(f, 900))
      refreshMyPhoto()
      onDone?.(L('প্রোফাইলের ছবি জমা হয়েছে', 'Profile photo saved'))
    } catch (e) { setErr(e instanceof Error && !('code' in e) ? e.message : hrFriendly(e)) } finally { setBusy(false) }
  }
  return <span className={`my-av-up ${className}`}>
    <span className="my-av-face"><MyFace photo={photo} /></span>
    <label className="my-av-cam" aria-label={photo ? L('ছবি বদলান', 'Change photo') : L('নিজের ছবি দিন', 'Add your photo')}
      onClick={e => e.stopPropagation()}>
      {busy ? <span className="my-av-spin" aria-hidden="true" /> : <Icon name="camera" size={15} />}
      <input ref={input} type="file" accept="image/*" disabled={busy} onChange={e => void pick(e.target.files?.[0])} />
    </label>
    {err && <span className="my-av-err" role="alert">{err}</span>}
  </span>
}
