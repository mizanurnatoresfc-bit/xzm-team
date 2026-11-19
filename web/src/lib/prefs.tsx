import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'

export type Lang = 'bn' | 'en'
export type Theme = 'light' | 'dark' | 'system'
/** Text size for this device: m = normal (follows the phone/browser setting), then bigger steps. */
export type TextSize = 'm' | 'l' | 'xl' | 'xxl'
export const TEXT_SIZES: Array<{ key: TextSize; pct: number; bn: string; en: string }> = [
  { key: 'm', pct: 100, bn: 'স্বাভাবিক', en: 'Normal' }, { key: 'l', pct: 112.5, bn: 'বড়', en: 'Large' },
  { key: 'xl', pct: 125, bn: 'আরও বড়', en: 'Larger' }, { key: 'xxl', pct: 137.5, bn: 'সবচেয়ে বড়', en: 'Largest' },
]
/** 'system' follows the phone/PC setting; 'more' = stronger contrast; 'reduce' = less animation. */
export type Contrast = 'system' | 'more'
export type Motion = 'system' | 'reduce'
/** Bangla typefaces the person can choose from (Google Fonts). The first one ships with the page. */
export const FONTS = [
  { key: 'hind', family: 'Hind Siliguri', label: 'হিন্দ শিলিগুড়ি', css: '' },
  { key: 'noto', family: 'Noto Sans Bengali', label: 'নোটো সান্স বাংলা', css: 'Noto+Sans+Bengali:wght@400;500;600;700' },
  { key: 'anek', family: 'Anek Bangla', label: 'অনেক বাংলা', css: 'Anek+Bangla:wght@400;500;600;700' },
  { key: 'baloo', family: 'Baloo Da 2', label: 'বালু দা', css: 'Baloo+Da+2:wght@400;500;600;700' },
  { key: 'tiro', family: 'Tiro Bangla', label: 'তিরো বাংলা (বইয়ের মতো)', css: 'Tiro+Bangla' },
] as const
export type FontKey = typeof FONTS[number]['key']
const okFont = (v: string): FontKey => FONTS.find(f => f.key === v)?.key ?? 'hind'
function applyFont(key: FontKey) {
  const f = FONTS.find(x => x.key === key) ?? FONTS[0]
  const root = document.documentElement
  if (f.key === 'hind') { root.style.removeProperty('--font-body'); root.style.removeProperty('--font-display'); return }
  const id = 'xzm-font-' + f.key
  if (!document.getElementById(id)) {
    const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet'
    l.href = `https://fonts.googleapis.com/css2?family=${f.css}&display=swap`
    document.head.appendChild(l)
  }
  // Hind Siliguri stays as the fallback, so text is readable while (or if) the new font does not load.
  root.style.setProperty('--font-body', `"Inter","${f.family}","Hind Siliguri",system-ui,"Segoe UI",Roboto,sans-serif`)
  root.style.setProperty('--font-display', `"${f.family}","Hind Siliguri","Inter",system-ui,sans-serif`)
}

type Prefs = { lang: Lang; theme: Theme; font: FontKey; setLang: (l: Lang) => void; setTheme: (t: Theme) => void; setFont: (f: FontKey) => void
  textSize: TextSize; contrast: Contrast; motion: Motion; setTextSize: (t: TextSize) => void; setContrast: (c: Contrast) => void; setMotion: (m: Motion) => void; L: (bn: string, en: string) => string; n: (v: number | string) => string }

const read = (k: string, d: string) => { try { return localStorage.getItem('xzm_' + k) ?? d } catch { return d } }
const write = (k: string, v: string) => { try { localStorage.setItem('xzm_' + k, v) } catch { /* private mode */ } }
const Ctx = createContext<Prefs | null>(null)

/** Put one setting on <html> as data-<name>, or remove it when it is the default. */
function mark(name: string, value: string, dflt: string) {
  const root = document.documentElement
  if (value === dflt) root.removeAttribute('data-' + name); else root.setAttribute('data-' + name, value)
}

/** Language (বাংলা / English), light/dark theme, font and the accessibility choices (text size, contrast, motion), remembered on this device. */
export function PrefsProvider({ children }: PropsWithChildren) {
  const [lang, setLangS] = useState<Lang>(() => (read('lang', 'bn') === 'en' ? 'en' : 'bn'))
  const [theme, setThemeS] = useState<Theme>(() => { const t = read('theme', 'system'); return t === 'dark' || t === 'light' ? t : 'system' })
  const [font, setFontS] = useState<FontKey>(() => okFont(read('font', 'hind')))
  useEffect(() => { applyFont(font) }, [font])
  const setFont = useCallback((f: FontKey) => { setFontS(f); write('font', f) }, [])
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  useEffect(() => { if (theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme) }, [theme])
  const [textSize, setTextSizeS] = useState<TextSize>(() => { const v = read('text', 'm'); return TEXT_SIZES.some(t => t.key === v) ? v as TextSize : 'm' })
  const [contrast, setContrastS] = useState<Contrast>(() => (read('contrast', 'system') === 'more' ? 'more' : 'system'))
  const [motion, setMotionS] = useState<Motion>(() => (read('motion', 'system') === 'reduce' ? 'reduce' : 'system'))
  useEffect(() => { mark('text', textSize, 'm') }, [textSize])
  useEffect(() => { mark('contrast', contrast, 'system') }, [contrast])
  useEffect(() => { mark('motion', motion, 'system') }, [motion])
  const setTextSize = useCallback((t: TextSize) => { setTextSizeS(t); write('text', t) }, [])
  const setContrast = useCallback((c: Contrast) => { setContrastS(c); write('contrast', c) }, [])
  const setMotion = useCallback((m: Motion) => { setMotionS(m); write('motion', m) }, [])
  const setLang = useCallback((l: Lang) => { setLangS(l); write('lang', l) }, [])
  const setTheme = useCallback((t: Theme) => { setThemeS(t); write('theme', t) }, [])
  const value = useMemo<Prefs>(() => ({
    lang, theme, font, setLang, setTheme, setFont, textSize, contrast, motion, setTextSize, setContrast, setMotion,
    L: (bn, en) => lang === 'bn' ? bn : en,
    n: v => lang === 'bn' ? String(v).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[+d]) : String(v),
  }), [lang, theme, font, setLang, setTheme, setFont, textSize, contrast, motion, setTextSize, setContrast, setMotion])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePrefs() {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePrefs must be used inside PrefsProvider')
  return v
}

/** Is the page currently dark (explicit choice or system setting)? */
export function isDark(theme: Theme) {
  return theme === 'dark' || (theme === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
}
