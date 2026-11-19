// Input masks: the box shows a fixed format while the person types (01711-000000), and the form
// keeps only the plain characters (01711000000). In a pattern, 9 = a digit, A = a letter,
// * = a digit or letter; anything else is a separator that is filled in automatically.
import { toLatinDigits } from './validate'

export const masks = {
  /** Bangladesh mobile: 01711-000000 */
  mobile: '99999-999999',
  /** Date typed by hand: 19/11/2026 */
  date: '99/99/9999',
  /** NID: 10, 13 or 17 digits, shown in groups of 3–4 */
  nid: '9999 9999 9999 99999',
} as const

const slot = (c: string) => c === '9' || c === 'A' || c === '*'
const fits = (p: string, ch: string) => p === '9' ? /\d/.test(ch) : p === 'A' ? /[A-Za-z]/.test(ch) : /[A-Za-z0-9]/.test(ch)

/** Only the characters that go into the slots, from whatever was typed or pasted (Bangla digits too). */
export function unmask(raw: string, pattern: string): string {
  const max = [...pattern].filter(slot).length
  const allowsLetters = /[A*]/.test(pattern)
  return toLatinDigits(raw).replace(allowsLetters ? /[^A-Za-z0-9]/g : /\D/g, '').slice(0, max)
}

/** Plain characters laid into the pattern. Separators appear only once the next slot is reached. */
export function applyMask(plain: string, pattern: string): string {
  let out = '', i = 0
  for (const p of pattern) {
    if (slot(p)) { while (i < plain.length && !fits(p, plain[i])) i++ }
    if (i >= plain.length) break
    out += slot(p) ? plain[i++] : p
  }
  return out
}

/** Where the caret belongs in the masked text after `n` plain characters. */
export function caretAfter(masked: string, n: number, pattern: string): number {
  if (n <= 0) return 0
  let seen = 0
  for (let k = 0; k < masked.length; k++) { if (slot(pattern[k] ?? '9')) seen++; if (seen === n) return k + 1 }
  return masked.length
}
