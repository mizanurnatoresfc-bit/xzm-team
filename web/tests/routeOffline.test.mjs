// Tests of the offline check-in queue (lib/routeOffline.ts): keeping check-ins on the phone, sending them in order, what is dropped and what waits.
// and what the phone keeps so the app opens without internet (lib/authOffline.ts). Run:  npm run test:checkin
import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_AGE_MS, MAX_ITEMS, MAX_TRIES, classifyError, clearAll, enqueue, flush, pendingStops, readMine, readQueue, saveMine } from '../src/lib/routeOffline.ts'
import { clearAuthSnapshot, readAuthSnapshot, readStoredSession, saveAuthSnapshot, storedSessionKey } from '../src/lib/authOffline.ts'

const memoryStore = () => { const m = new Map(); return { get: k => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: k => void m.delete(k), m } }
const T0 = Date.parse('2026-11-27T04:00:00Z')
const at = min => new Date(T0 + min * 60000).toISOString()
const add = (store, stop, min, over = {}) => enqueue(store, 'u1', { stop, lat: 24.364, lng: 88.629, accuracy: 12, at: at(min), ...over }, T0)
const ok = { near: true, distance_m: 20, radius_m: 150 }
const pgErr = (message, code = '') => Object.assign(new Error(message), { code })

test('a check-in is kept with the time it was taken, oldest first, per user', () => {
  const s = memoryStore()
  add(s, 'b', 30); add(s, 'a', 10)
  assert.deepEqual(readQueue(s, 'u1').items.map(i => [i.stop, i.at]), [['a', at(10)], ['b', at(30)]])
  assert.equal(readQueue(s, 'u2').items.length, 0, 'another login on the same phone sees none')
  assert.deepEqual([...pendingStops(readQueue(s, 'u1'))].sort(), ['a', 'b'])
})
test('the same reading kept twice is one entry; two readings of one stop are both kept', () => {
  const s = memoryStore()
  add(s, 'a', 10); add(s, 'a', 10)
  assert.equal(readQueue(s, 'u1').items.length, 1)
  add(s, 'a', 20)
  assert.equal(readQueue(s, 'u1').items.length, 2)
})
test('the queue cannot grow without limit: the oldest go first', () => {
  const s = memoryStore()
  for (let i = 0; i < MAX_ITEMS + 5; i++) add(s, `s${i}`, i)
  const q = readQueue(s, 'u1').items
  assert.equal(q.length, MAX_ITEMS)
  assert.equal(q[0].stop, 's5')
})
test('a damaged or foreign value in storage is ignored, not a crash', () => {
  const s = memoryStore()
  s.set('xzm_checkins_u1', '{not json')
  assert.deepEqual(readQueue(s, 'u1'), { items: [], rejected: [] })
  s.set('xzm_checkins_u1', JSON.stringify({ items: [{ id: 'x' }, { id: 'a@1', stop: 'a', lat: 1, lng: 2, at: 'nonsense' }, null, 7], rejected: 'no' }))
  assert.deepEqual(readQueue(s, 'u1'), { items: [], rejected: [] })
})

test('flush sends everything oldest first and empties the queue', async () => {
  const s = memoryStore(); add(s, 'b', 30); add(s, 'a', 10)
  const order = []
  const r = await flush(s, 'u1', async c => { order.push(c.stop); return ok }, undefined, T0)
  assert.deepEqual(order, ['a', 'b'])
  assert.deepEqual([r.sent, r.left, r.stopped, r.rejected.length], [2, 0, null, 0])
  assert.equal(s.m.size, 0, 'nothing left in storage')
})
test('flush hands over the time the reading was taken', async () => {
  const s = memoryStore(); add(s, 'a', 10, { accuracy: 8.4 })
  let seen
  await flush(s, 'u1', async c => { seen = c; return ok }, undefined, T0)
  assert.deepEqual([seen.at, seen.stop, seen.lat, seen.lng, seen.accuracy], [at(10), 'a', 24.364, 88.629, 8])
})
test('no internet: it stops at once, keeps everything in order and does not count a try', async () => {
  const s = memoryStore(); add(s, 'a', 10); add(s, 'b', 20); add(s, 'c', 30)
  let calls = 0
  const r = await flush(s, 'u1', async () => { calls++; throw new TypeError('Failed to fetch') }, undefined, T0)
  assert.equal(calls, 1, 'does not hammer a dead connection')
  assert.deepEqual([r.sent, r.left, r.stopped], [0, 3, 'network'])
  assert.deepEqual(readQueue(s, 'u1').items.map(i => [i.stop, i.tries]), [['a', 0], ['b', 0], ['c', 0]])
})
test('the connection drops half way: what went is gone, the rest waits', async () => {
  const s = memoryStore(); add(s, 'a', 10); add(s, 'b', 20); add(s, 'c', 30)
  let n = 0
  const r = await flush(s, 'u1', async () => { if (++n === 2) throw pgErr('TypeError: Failed to fetch'); return ok }, undefined, T0)
  assert.deepEqual([r.sent, r.left, r.stopped], [1, 2, 'network'])
  assert.deepEqual(readQueue(s, 'u1').items.map(i => i.stop), ['b', 'c'])
})
test('the server saying no drops that check-in with the reason, and the others still go', async () => {
  const s = memoryStore(); add(s, 'a', 10); add(s, 'b', 20)
  const r = await flush(s, 'u1', async c => { if (c.stop === 'a') throw pgErr('This stop is not on your route.', '42501'); return ok }, e => `NO: ${e.message}`, T0)
  assert.deepEqual([r.sent, r.left, r.stopped], [1, 0, null])
  assert.deepEqual(r.rejected.map(x => [x.stop, x.reason]), [['a', 'NO: This stop is not on your route.']])
  assert.equal(readQueue(s, 'u1').rejected.length, 1, 'the refusal is remembered so the person can be told')
})
test('an expired login keeps everything: nothing is lost because the person must sign in again', async () => {
  const s = memoryStore(); add(s, 'a', 10); add(s, 'b', 20)
  const r = await flush(s, 'u1', async () => { throw pgErr('JWT expired', 'PGRST301') }, undefined, T0)
  assert.deepEqual([r.sent, r.left, r.stopped], [0, 2, 'auth'])
})
test('a check-in older than the server accepts is dropped without asking', async () => {
  const s = memoryStore(); add(s, 'old', 0); add(s, 'new', 60 * 24 * 2 - 10)
  const later = T0 + MAX_AGE_MS + 5 * 60000
  let asked = []
  const r = await flush(s, 'u1', async c => { asked.push(c.stop); return ok }, undefined, later)
  assert.deepEqual(asked, ['new'])
  assert.deepEqual(r.rejected.map(x => [x.stop, x.reason]), [['old', 'tooold']])
})
test('an unknown server error is tried again later, and given up after many tries', async () => {
  const s = memoryStore(); add(s, 'a', 10)
  for (let i = 0; i < MAX_TRIES - 1; i++) {
    const r = await flush(s, 'u1', async () => { throw pgErr('boom', '57014') }, undefined, T0)
    assert.equal(r.left, 1)
  }
  assert.equal(readQueue(s, 'u1').items[0].tries, MAX_TRIES - 1)
  const last = await flush(s, 'u1', async () => { throw pgErr('boom', '57014') }, undefined, T0)
  assert.deepEqual([last.left, last.rejected.length], [0, 1])
})
test('the function not being in the database yet is waiting, not failing', async () => {
  const s = memoryStore(); add(s, 'a', 10)
  for (let i = 0; i < MAX_TRIES + 3; i++) await flush(s, 'u1', async () => { throw pgErr('Could not find the function public.route_checkin(...) in the schema cache', 'PGRST202') }, undefined, T0)
  assert.deepEqual(readQueue(s, 'u1').items.map(i => [i.stop, i.tries]), [['a', 0]], 'still there, no try used up')
})
test('two flushes at once share one run (no check-in is sent twice)', async () => {
  const s = memoryStore(); add(s, 'a', 10); add(s, 'b', 20)
  let calls = 0
  const send = async () => { calls++; await new Promise(r => setTimeout(r, 15)); return ok }
  const [x, y] = await Promise.all([flush(s, 'u1', send, undefined, T0), flush(s, 'u1', send, undefined, T0)])
  assert.equal(calls, 2)
  assert.equal(x, y)
})
test('a check-in added while sending is not lost', async () => {
  const s = memoryStore(); add(s, 'a', 10)
  const r = await flush(s, 'u1', async () => { add(s, 'late', 50); return ok }, undefined, T0)
  assert.equal(r.sent, 1)
  assert.deepEqual(readQueue(s, 'u1').items.map(i => i.stop), ['late'])
})

test('what kind of failure is it?', () => {
  assert.equal(classifyError(new TypeError('Failed to fetch')), 'network')
  assert.equal(classifyError(pgErr('TypeError: NetworkError when attempting to fetch resource.')), 'network')
  assert.equal(classifyError(pgErr('Load failed')), 'network')
  assert.equal(classifyError(Object.assign(new Error('x'), { name: 'AbortError' })), 'network')
  assert.equal(classifyError(pgErr('JWT expired', 'PGRST301')), 'auth')
  assert.equal(classifyError(Object.assign(new Error('x'), { status: 401 })), 'auth')
  for (const code of ['42501', 'P0001', 'P0002', '22023']) assert.equal(classifyError(pgErr('no', code)), 'rejected', code)
  assert.equal(classifyError(pgErr('Route check-in is switched off for this zone.', 'P0001')), 'rejected')
  assert.equal(classifyError(pgErr('server busy', '53300')), 'retry')
  assert.equal(classifyError('plain text'), 'retry')
  assert.equal(classifyError(null), 'retry')
})

test('the route is kept for the next time there is no signal, per user', () => {
  const s = memoryStore()
  assert.equal(readMine(s, 'u1'), null)
  saveMine(s, 'u1', { routes: [{ id: 'r1' }] }, T0)
  assert.deepEqual(readMine(s, 'u1'), { saved_at: at(0), data: { routes: [{ id: 'r1' }] } })
  assert.equal(readMine(s, 'u2'), null)
  add(s, 'a', 10); clearAll(s, 'u1')
  assert.deepEqual([readMine(s, 'u1'), readQueue(s, 'u1').items.length], [null, 0], 'signing out clears both')
  s.set('xzm_myroute_u1', 'garbage')
  assert.equal(readMine(s, 'u1'), null)
})

// ------------------------------------------------------------------ opening the app with no internet
test('permissions are kept per person and read back; garbage is ignored', () => {
  const s = memoryStore()
  assert.equal(readAuthSnapshot(s, 'u1'), null)
  saveAuthSnapshot(s, 'u1', { grants: [{ permission_code: 'ops.route_visit.create' }], mustChange: false, menu: ['/app/staff'] }, T0)
  assert.deepEqual(readAuthSnapshot(s, 'u1'), { saved_at: at(0), grants: [{ permission_code: 'ops.route_visit.create' }], mustChange: false, menu: ['/app/staff'] })
  assert.equal(readAuthSnapshot(s, 'u2'), null, 'not shared with another login')
  s.set('xzm_auth_u1', '{"grants":"no"}'); assert.equal(readAuthSnapshot(s, 'u1'), null)
  s.set('xzm_auth_u1', 'garbage'); assert.equal(readAuthSnapshot(s, 'u1'), null)
  saveAuthSnapshot(s, 'u1', { grants: [], mustChange: true, menu: undefined }, T0)
  clearAuthSnapshot(s, 'u1'); assert.equal(readAuthSnapshot(s, 'u1'), null, 'signing out forgets them')
})
test('the stored login is found under the library\'s own key, and only a real-looking one is used', () => {
  const url = 'https://abcdwxyz.supabase.co'
  assert.equal(storedSessionKey(url), 'sb-abcdwxyz-auth-token')
  assert.equal(storedSessionKey('not a url'), '')
  const s = memoryStore()
  assert.equal(readStoredSession(s, url), null)
  s.set('sb-abcdwxyz-auth-token', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'u1' } }))
  assert.equal(readStoredSession(s, url).user.id, 'u1', 'even with an access token that has run out')
  s.set('sb-abcdwxyz-auth-token', JSON.stringify({ access_token: 'a', user: { id: 'u1' } })); assert.equal(readStoredSession(s, url), null, 'no refresh token: not a login')
  s.set('sb-abcdwxyz-auth-token', JSON.stringify({ refresh_token: 'r', user: {} })); assert.equal(readStoredSession(s, url), null, 'no person')
  s.set('sb-abcdwxyz-auth-token', '{oops'); assert.equal(readStoredSession(s, url), null)
  assert.equal(readStoredSession(s, ''), null)
})
