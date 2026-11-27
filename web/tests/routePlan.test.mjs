// Tests of the day's parcel plan arithmetic (lib/routePlanCore.ts): what one person can take, sharing whole parcels, the suggestion, the spread over routes.
// The suggestion decides who takes how many parcels, so its rules are pinned here. Run:  npm run test:plan
import test from 'node:test'
import assert from 'node:assert/strict'
import { capacityOf, capacityToday, isHere, share, spreadRoutes, suggestPlan } from '../src/lib/routePlanCore.ts'

const person = (id, over = {}) => ({
  id, code: id, name: `Rider ${id}`, post: 'Rider', active: true, rider: true, routes: [], fixed: null, helper: false, helper_max: null, pickup: false,
  acc: { days: 0, delivery: 0, pickup: 0 }, self: { days: 0, delivery: 0, returned: 0, pickup: 0 },
  presence: { state: 'present', source: 'attendance' }, done: { self: null, acc: null }, ...over })
const route = (id, over = {}) => ({ id, hub_id: 'h', zone_id: 'z', code: id, name: `Route ${id}`, note: null, color: null, shift: 'day', distance_km: null, road_km: null,
  road_minutes: null, stops_gps: 0, updated_at: '', stops: [], riders: [], avg_parcels: null, ...over })
const data = (people, routes, over = {}) => ({ date: '2026-11-26', today: '2026-11-26', hub: { id: 'h', code: 'H', name: 'Hub', zone_id: 'z', lat: null, lng: null },
  rules: { avg_days: 14, min_days: 3, over_pct: 120, near_km: 5, helper_max: 10, show_rider: true },
  load: { rider_parcels: 30, pickup_mode: 'same', pickup_weight: 2 }, can: {}, plan: null, hints: {}, people, routes, ...over })
const input = (over = {}) => ({ toDeliver: 0, routeParcels: {}, present: {}, pickups: {}, extra: [], ...over })
const sum = list => list.reduce((t, x) => t + x, 0)
const given = s => sum(Object.values(s.rows).map(r => r.parcels))

// ------------------------------------------------------------------ sharing whole parcels
test('share: parcels go by weight in whole numbers and nobody gets more than their room', () => {
  assert.deepEqual(share(10, [1, 1], [10, 10]), { got: [5, 5], left: 0 })
  assert.deepEqual(share(10, [1, 1], [3, 10]), { got: [3, 7], left: 0 }, 'a full person hands the rest on')
  assert.deepEqual(share(10, [1], [4]), { got: [4], left: 6 }, 'what does not fit comes back')
  assert.deepEqual(share(0, [1, 2], [5, 5]), { got: [0, 0], left: 0 })
  assert.deepEqual(share(7, [0, 1], [5, 5]), { got: [0, 5], left: 2 }, 'a person with no weight gets nothing')
})
test('share: never loses or invents a parcel', () => {
  for (const total of [1, 5, 13, 99, 250]) for (const w of [[1, 1, 1], [3, 1], [2, 5, 7, 1]]) {
    const room = w.map(x => x * 20)
    const s = share(total, w, room)
    assert.equal(sum(s.got) + s.left, total, `${total} over ${w}`)
    s.got.forEach((g, i) => assert.ok(g <= room[i]))
  }
})

// ------------------------------------------------------------------ what one person can take
test('capacityOf: the typed number wins, then the sent accounts, then the own reports, then the hub average', () => {
  const d = data([], [])
  assert.deepEqual([capacityOf(person('a', { fixed: 40 }), d).base, capacityOf(person('a', { fixed: 40 }), d).source], [40, 'fixed'])
  const acc = person('a', { acc: { days: 4, delivery: 120, pickup: 8 }, self: { days: 4, delivery: 80, returned: 0, pickup: 0 } })
  assert.deepEqual([capacityOf(acc, d).base, capacityOf(acc, d).source, capacityOf(acc, d).usualPickups], [30, 'accounts', 2])
  const self = person('a', { acc: { days: 1, delivery: 90, pickup: 0 }, self: { days: 4, delivery: 80, returned: 0, pickup: 0 } })
  assert.deepEqual([capacityOf(self, d).base, capacityOf(self, d).source], [20, 'self'], 'too few account days: own reports are used')
  assert.deepEqual([capacityOf(person('a'), d).base, capacityOf(person('a'), d).source], [30, 'hub'])
  assert.deepEqual([capacityOf(person('a'), data([], [], { load: { ...d.load, rider_parcels: null } })).source], [null], 'nothing known: no capacity')
})
test('capacityOf: a helper takes the helper limit (or their own)', () => {
  const d = data([], [])
  assert.equal(capacityOf(person('h', { rider: false, helper: true }), d).base, 10)
  assert.equal(capacityOf(person('h', { rider: false, helper: true, helper_max: 6 }), d).base, 6)
})
test('capacityToday: pickups above the usual ones take room, never below zero', () => {
  const load = { rider_parcels: 30, pickup_mode: 'same', pickup_weight: 2 }
  const c = { base: 30, source: 'hub', usualPickups: 1, rate: null }
  assert.equal(capacityToday(c, 1, load), 30, 'the usual number of pickups costs nothing extra')
  assert.equal(capacityToday(c, 4, load), 24, 'three more pickups = six fewer deliveries')
  assert.equal(capacityToday(c, 100, load), 0)
  assert.equal(capacityToday({ ...c, base: null }, 0, load), null)
})
test('isHere: what was typed wins; nothing marked counts as here', () => {
  assert.equal(isHere(person('a', { presence: { state: 'absent', source: 'attendance' } }), null), false)
  assert.equal(isHere(person('a', { presence: { state: 'absent', source: 'attendance' } }), true), true)
  assert.equal(isHere(person('a', { presence: { state: null, source: null } }), null), true)
})

// ------------------------------------------------------------------ the suggestion
test('suggestPlan: a route goes to its riders by what each can take', () => {
  const a = person('a', { routes: ['r1'], fixed: 30 }), b = person('b', { routes: ['r1'], fixed: 10 })
  const s = suggestPlan(data([a, b], [route('r1')]), input({ toDeliver: 40, routeParcels: { r1: 40 } }))
  assert.deepEqual([s.rows.a.parcels, s.rows.b.parcels, s.unassigned], [30, 10, 0])
  assert.equal(s.tips.length, 0, 'nothing to warn about')
})
test('suggestPlan: an absent rider\'s part goes first to the rider of the same route who has room, then up to the overload limit', () => {
  const a = person('a', { routes: ['r1'], fixed: 30 }), b = person('b', { routes: ['r1'], fixed: 30 })
  const s = suggestPlan(data([a, b], [route('r1')]), input({ toDeliver: 60, routeParcels: { r1: 60 }, present: { a: false } }))
  assert.equal(s.rows.a.parcels, 0, 'the absent rider gets nothing')
  assert.equal(s.rows.b.parcels, 36, '30 normal + 6 up to 120 %')
  assert.equal(s.unassigned, 24, 'the rest is left for tomorrow')
  assert.ok(s.tips.some(t => t.kind === 'cover' && t.absent === 'Rider a'))
  assert.deepEqual(s.tips.find(t => t.kind === 'unassigned'), { kind: 'unassigned', parcels: 24, riders: 1 }, '24 parcels = one more rider at 30 a day')
})
test('suggestPlan: a rider without a route covers for the absent one before anyone is stretched', () => {
  const a = person('a', { routes: ['r1'], fixed: 30 }), b = person('b', { routes: ['r1'], fixed: 30 }), free = person('c', { fixed: 30 })
  const s = suggestPlan(data([a, b, free], [route('r1')]), input({ toDeliver: 60, routeParcels: { r1: 60 }, present: { a: false } }))
  assert.deepEqual([s.rows.a.parcels, s.rows.b.parcels, s.rows.c.parcels, s.unassigned], [0, 30, 30, 0])
  const cover = s.tips.find(t => t.kind === 'cover')
  assert.deepEqual(cover.to.map(x => [x.name, x.parcels, x.how]), [['Rider c', 30, 'free']])
  assert.deepEqual(s.rows.c.detail, [{ route_id: 'r1', parcels: 30, for: 'a' }], 'the line says whose parcels they are')
})
test('suggestPlan: a helper takes parcels when no rider has room', () => {
  const a = person('a', { routes: ['r1'], fixed: 30 })
  const h = person('h', { rider: false, helper: true, helper_max: 8 })
  const s = suggestPlan(data([a, h], [route('r1')]), input({ toDeliver: 38, routeParcels: { r1: 38 } }))
  assert.deepEqual([s.rows.a.parcels, s.rows.h.parcels, s.unassigned], [30, 8, 0])
  assert.equal(s.rows.h.kind, 'helper')
})
test('suggestPlan: a route nobody rides is reported and its parcels still find a person', () => {
  const free = person('c', { fixed: 30 })
  const s = suggestPlan(data([free], [route('r9')]), input({ toDeliver: 12, routeParcels: { r9: 12 } }))
  assert.ok(s.tips.some(t => t.kind === 'routeless' && /r9/.test(t.route)))
  assert.deepEqual([s.rows.c.parcels, s.unassigned], [12, 0])
})
test('suggestPlan: parcels not on any route are reported, and people without a known capacity are named', () => {
  const a = person('a', { routes: ['r1'], fixed: 50 })
  const s = suggestPlan(data([a], [route('r1')]), input({ toDeliver: 50, routeParcels: { r1: 20 } }))
  assert.deepEqual(s.tips.find(t => t.kind === 'noroute'), { kind: 'noroute', parcels: 30 })
  assert.equal(s.rows.a.parcels, 50, 'the rider still takes them')
  const none = suggestPlan(data([person('n', { routes: ['r1'] })], [route('r1')], { load: { rider_parcels: null, pickup_mode: 'same', pickup_weight: 2 } }), input({ toDeliver: 5, routeParcels: { r1: 5 } }))
  assert.deepEqual(none.tips.find(t => t.kind === 'nocap').names, ['Rider n'])
})
test('suggestPlan: attendance not marked is flagged, and counts as here', () => {
  const a = person('a', { routes: ['r1'], fixed: 30, presence: { state: null, source: null } })
  const s = suggestPlan(data([a], [route('r1')]), input({ toDeliver: 30, routeParcels: { r1: 30 } }))
  assert.equal(s.rows.a.parcels, 30)
  assert.deepEqual(s.tips.find(t => t.kind === 'unknown').names, ['Rider a'])
})
test('suggestPlan: not a single parcel is lost or invented (given + left = to deliver)', () => {
  let seed = 7
  const rnd = n => { seed = (seed * 48271) % 2147483647; return seed % n }
  for (let round = 0; round < 60; round++) {
    const routes = [route('r1'), route('r2'), route('r3')]
    const people = Array.from({ length: 2 + rnd(5) }, (_, i) => person(`p${i}`, {
      routes: rnd(4) === 0 ? [] : [`r${1 + rnd(3)}`], fixed: rnd(3) === 0 ? null : 5 + rnd(40),
      rider: rnd(5) !== 0, helper: rnd(4) === 0, presence: { state: rnd(3) === 0 ? 'absent' : 'present', source: 'attendance' } }))
    const routeParcels = Object.fromEntries(routes.map(r => [r.id, rnd(80)]))
    const total = sum(Object.values(routeParcels)) + rnd(20)
    const s = suggestPlan(data(people, routes), input({ toDeliver: total, routeParcels }))
    assert.equal(given(s) + s.unassigned, total, `round ${round}`)
    for (const p of people) assert.ok(s.rows[p.id] === undefined || s.rows[p.id].parcels >= 0)
    for (const r of Object.values(s.rows)) assert.equal(sum(r.detail.map(x => x.parcels)), r.parcels, 'a person\'s parts add up to their parcels')
  }
})

// ------------------------------------------------------------------ the spread over routes
test('spreadRoutes: today\'s parcels follow the routes\' usual size and add up', () => {
  const d = data([], [route('r1', { avg_parcels: 60 }), route('r2', { avg_parcels: 20 })])
  assert.deepEqual(spreadRoutes(d, 80), { r1: 60, r2: 20 })
  const s = spreadRoutes(d, 50)
  assert.equal(s.r1 + s.r2, 50)
  assert.ok(s.r1 > s.r2)
})
test('spreadRoutes: without typed averages the riders\' capacity is the weight; with nothing known it gives nothing', () => {
  const d = data([person('a', { routes: ['r1'], fixed: 30 }), person('b', { routes: ['r2'], fixed: 10 })], [route('r1'), route('r2')])
  assert.deepEqual(spreadRoutes(d, 40), { r1: 30, r2: 10 })
  assert.deepEqual(spreadRoutes(data([], [route('r1')]), 40), {})
})
