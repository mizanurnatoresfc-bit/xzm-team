import type { Place } from './routes'

const words = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()

export function routePdfAreaMatcher(places: Place[]) {
  const names = new Map<string, Set<string>>()
  for (const place of places) {
    for (const alias of [place.name, place.name_bn]) {
      const key = words(alias ?? '')
      if (key.length < 3) continue
      const ids = names.get(key) ?? new Set<string>()
      ids.add(place.id); names.set(key, ids)
    }
  }
  const aliases = [...names].map(([name, ids]) => ({ name, ids, compact: name.replace(/ /g, '') }))
  return function match(text: string) {
    const normalized = words(text)
    const whole = ' ' + normalized + ' '
    const compact = normalized.replace(/ /g, '')
    let best = 0
    const matches = new Set<string>()
    for (const alias of aliases) {
      const size = alias.compact.length
      if (size < best) continue
      const exact = whole.includes(' ' + alias.name + ' ')
      // Mobile PDFs can insert spaces inside Bangla place names.
      const joined = size >= 5 && /[\u0980-\u09ff]/.test(alias.name) && compact.includes(alias.compact)
      if (!exact && !joined) continue
      if (size > best) { matches.clear(); best = size }
      for (const id of alias.ids) matches.add(id)
    }
    return matches
  }
}
