// Offline check-in for riders: the pure part. A rider in a place without signal presses "I'm here"; the phone's location is read (GPS needs no internet),
// the check-in is kept on the phone with the time it was taken, and it is sent when the internet is back (route_checkin's p_at keeps that time).
// No imports and no browser objects here (the storage is passed in), so tests/routeOffline.test.mjs runs it. docs/ROUTE_MODULE.md has the whole picture.

/** Anything with get / set of one string: localStorage wrapped (see browserStore) or a fake in a test. */
export type Store = { get: (key: string) => string | null; set: (key: string, value: string) => void; remove: (key: string) => void }

export type PendingCheckin = { id: string; stop: string; lat: number; lng: number; accuracy: number | null; at: string; tries: number }
export type Rejected = { id: string; stop: string; at: string; reason: string }
export type Queue = { items: PendingCheckin[]; rejected: Rejected[] }
export type SendResult = { near: boolean; distance_m: number; radius_m: number; kept?: boolean }

/** The server accepts a check-in up to 48 hours old; the phone gives up a little earlier so it never sends one that is sure to be refused. */
export const MAX_AGE_MS = 47 * 3600 * 1000
export const MAX_ITEMS = 200
export const MAX_TRIES = 30

const queueKey = (user: string) => `xzm_checkins_${user}`
const mineKey = (user: string) => `xzm_myroute_${user}`

function parse<T>(raw: string | null): T | null { try { return raw ? JSON.parse(raw) as T : null } catch { return null } }
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

export function readQueue(store: Store, user: string): Queue {
  const q = parse<Partial<Queue>>(store.get(queueKey(user)))
  const items = Array.isArray(q?.items) ? q.items.filter(i => i && typeof i.id === 'string' && typeof i.stop === 'string' && num(i.lat) && num(i.lng) && typeof i.at === 'string' && !Number.isNaN(Date.parse(i.at))) : []
  return { items, rejected: Array.isArray(q?.rejected) ? q.rejected.filter(r => r && typeof r.id === 'string').slice(-20) : [] }
}
function writeQueue(store: Store, user: string, q: Queue) {
  if (!q.items.length && !q.rejected.length) store.remove(queueKey(user))
  else store.set(queueKey(user), JSON.stringify(q))
}

/** Keep a check-in on the phone. The same stop pressed twice before sending keeps both readings (oldest first); the server decides which stands (near stays near, the later one wins). */
export function enqueue(store: Store, user: string, c: { stop: string; lat: number; lng: number; accuracy: number | null; at?: string }, now = Date.now()): PendingCheckin {
  const at = c.at ?? new Date(now).toISOString()
  const q = readQueue(store, user)
  const item: PendingCheckin = { id: `${c.stop}@${at}`, stop: c.stop, lat: +c.lat.toFixed(7), lng: +c.lng.toFixed(7), accuracy: c.accuracy === null ? null : Math.round(c.accuracy), at, tries: 0 }
  if (!q.items.some(i => i.id === item.id)) q.items.push(item)
  q.items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  // never grow without limit: the oldest go first (a phone left offline for days is not a place to keep a pile)
  while (q.items.length > MAX_ITEMS) q.items.shift()
  writeQueue(store, user, q)
  return item
}

export const pendingStops = (q: Queue) => new Set(q.items.map(i => i.stop))
export const clearRejected = (store: Store, user: string) => { const q = readQueue(store, user); writeQueue(store, user, { items: q.items, rejected: [] }) }
export const clearAll = (store: Store, user: string) => { store.remove(queueKey(user)); store.remove(mineKey(user)) }

/** Wait for `p` at most `ms`: a weak signal can hang a request for minutes. The failure reads as "no internet" (classifyError → 'network'). The request itself is not cancelled. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p, new Promise<never>((_, bad) => { timer = setTimeout(() => bad(new TypeError('timed out')), ms) })]).finally(() => clearTimeout(timer))
}

export type ErrorKind =
  /** no internet (or the server did not answer): keep it, try again later, do not count it */
  | 'network'
  /** the login is no longer accepted: keep it, the person must sign in; nothing is lost */
  | 'auth'
  /** the server understood and said no (not on your route, check-in switched off, stop has no location …): it will never work, tell the person and drop it */
  | 'rejected'
  /** anything else (server busy, a function not there yet): keep it and count the try */
  | 'retry'

/** What kind of failure is this? Works on a PostgREST error, a RouteError, a TypeError from fetch, or plain text. */
export function classifyError(e: unknown): ErrorKind {
  const err = e as { message?: unknown; code?: unknown; status?: unknown; name?: unknown } | null
  const msg = String(err && typeof err === 'object' && 'message' in err ? err.message : e ?? '')
  const code = String(err && typeof err === 'object' && 'code' in err ? err.code ?? '' : '')
  const status = Number(err && typeof err === 'object' && 'status' in err ? err.status : 0)
  if (status === 401 || /^PGRST30[0-9]$/.test(code) || /\bJWT\b|jwt expired|invalid token|not authenticated/i.test(msg)) return 'auth'
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|ECONN|ENOTFOUND|ERR_INTERNET|ERR_NETWORK/i.test(msg) || err?.name === 'AbortError' || err?.name === 'TimeoutError'
      || (e instanceof TypeError && code === '')) return 'network'
  // the database said no on purpose: not authorised / not found / a rule (P0001) / a value out of range
  // the new function is not in the database yet (the site was published before the migration): wait, do not use up the tries
  if (code === 'PGRST202' || /could not find the function/i.test(msg)) return 'network'
  if (['42501', 'P0001', 'P0002', '22023'].includes(code)) return 'rejected'
  return 'retry'
}

export type FlushResult = {
  sent: number; rejected: Rejected[]; left: number
  /** why it stopped before the end: no internet, or the login needs renewing (null = it went through the whole list) */
  stopped: 'network' | 'auth' | null
}
const inflight = new Map<string, Promise<FlushResult>>()

/**
 * Send the saved check-ins, oldest first. Stops at the first failure that means "not now" (no internet, login expired) so the order is kept;
 * a refusal by the server is recorded in `rejected` and dropped. Two calls at once (the "online" event and a timer) share one run.
 * `send` calls route_checkin with the saved time; `describe` turns a refusal into the sentence shown to the person.
 */
export function flush(store: Store, user: string, send: (c: PendingCheckin) => Promise<SendResult>, describe: (e: unknown) => string = e => String((e as Error)?.message ?? e), now = Date.now()): Promise<FlushResult> {
  const running = inflight.get(user)
  if (running) return running
  const run = (async (): Promise<FlushResult> => {
    let sent = 0, stopped: FlushResult['stopped'] = null
    const rejected: Rejected[] = []
    const q = readQueue(store, user)
    const keep: PendingCheckin[] = []
    const reject = (i: PendingCheckin, reason: string) => rejected.push({ id: i.id, stop: i.stop, at: i.at, reason })
    for (let n = 0; n < q.items.length; n++) {
      const item = q.items[n]
      if (stopped) { keep.push(item); continue }
      if (now - Date.parse(item.at) > MAX_AGE_MS) { reject(item, 'tooold'); continue }
      try { await send(item); sent++ } catch (e) {
        const kind = classifyError(e)
        if (kind === 'network' || kind === 'auth') { stopped = kind; keep.push(item); continue }
        if (kind === 'rejected') { reject(item, describe(e)); continue }
        if (item.tries + 1 >= MAX_TRIES) { reject(item, describe(e)); continue }
        keep.push({ ...item, tries: item.tries + 1 })
      }
    }
    // read again: a check-in added while we were sending must not be lost
    const latest = readQueue(store, user)
    const sentIds = new Set(q.items.map(i => i.id))
    const added = latest.items.filter(i => !sentIds.has(i.id))
    const left = [...keep, ...added].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    writeQueue(store, user, { items: left, rejected: [...latest.rejected, ...rejected].slice(-20) })
    return { sent, rejected, left: left.length, stopped }
  })().finally(() => inflight.delete(user))
  inflight.set(user, run)
  return run
}

// ------------------------------------------------------------------ the route itself, kept for the next time there is no signal
export type CachedMine<T> = { saved_at: string; data: T }
export function saveMine<T>(store: Store, user: string, data: T, now = Date.now()) {
  try { store.set(mineKey(user), JSON.stringify({ saved_at: new Date(now).toISOString(), data } satisfies CachedMine<T>)) } catch { /* storage full: the route just is not kept */ }
}
export function readMine<T>(store: Store, user: string): CachedMine<T> | null {
  const c = parse<CachedMine<T>>(store.get(mineKey(user)))
  return c && typeof c.saved_at === 'string' && c.data ? c : null
}

/** The browser's localStorage as a Store: never throws (private windows, full storage), and keeps working in memory for the session when it cannot save. */
export function browserStore(): Store {
  const memory = new Map<string, string>()
  const ls = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
  return {
    get: k => { try { return ls()?.getItem(k) ?? memory.get(k) ?? null } catch { return memory.get(k) ?? null } },
    set: (k, v) => { memory.set(k, v); try { ls()?.setItem(k, v) } catch { /* kept in memory only */ } },
    remove: k => { memory.delete(k); try { ls()?.removeItem(k) } catch { /* nothing */ } },
  }
}
