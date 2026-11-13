import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'

export type Lang = 'bn' | 'en'
export type Theme = 'light' | 'dark' | 'system'
type Prefs = { lang: Lang; theme: Theme; setLang: (l: Lang) => void; setTheme: (t: Theme) => void; L: (bn: string, en: string) => string; n: (v: number | string) => string }

const read = (k: string, d: string) => { try { return localStorage.getItem('xzm_' + k) ?? d } catch { return d } }
const write = (k: string, v: string) => { try { localStorage.setItem('xzm_' + k, v) } catch { /* private mode */ } }
const Ctx = createContext<Prefs | null>(null)

/** Language (বাংলা / English) and light/dark theme, remembered on this device. */
export function PrefsProvider({ children }: PropsWithChildren) {
  const [lang, setLangS] = useState<Lang>(() => (read('lang', 'bn') === 'en' ? 'en' : 'bn'))
  const [theme, setThemeS] = useState<Theme>(() => { const t = read('theme', 'system'); return t === 'dark' || t === 'light' ? t : 'system' })
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  useEffect(() => { if (theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme) }, [theme])
  const setLang = useCallback((l: Lang) => { setLangS(l); write('lang', l) }, [])
  const setTheme = useCallback((t: Theme) => { setThemeS(t); write('theme', t) }, [])
  const value = useMemo<Prefs>(() => ({
    lang, theme, setLang, setTheme,
    L: (bn, en) => lang === 'bn' ? bn : en,
    n: v => lang === 'bn' ? String(v).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[+d]) : String(v),
  }), [lang, theme, setLang, setTheme])
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
