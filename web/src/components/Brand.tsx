import { useBranding } from '../lib/branding'
import { usePrefs } from '../lib/prefs'

/** The mark: the picture if one is set, otherwise the short name in a square. */
export function BrandMark({ size = 'small' }: { size?: 'small' | 'large' }) {
  const b = useBranding()
  const cls = size === 'small' ? 'brand-mark small' : 'brand-mark'
  if (b.logo) return <img className={`${cls} as-img`} src={b.logo} alt="" width={size === 'small' ? 34 : 48} height={size === 'small' ? 34 : 48} />
  return <span className={cls}>{b.short_name}</span>
}

/** The mark with the name beside it. */
export function BrandName({ size = 'small' }: { size?: 'small' | 'large' }) {
  const b = useBranding()
  const { lang } = usePrefs()
  return <><BrandMark size={size} /><span>{lang === 'bn' ? b.name_bn : b.company_name}</span></>
}

export function useBrandText() {
  const b = useBranding()
  const { lang } = usePrefs()
  return { name: lang === 'bn' ? b.name_bn : b.company_name, tagline: lang === 'bn' ? b.tagline.bn : b.tagline.en, b }
}
