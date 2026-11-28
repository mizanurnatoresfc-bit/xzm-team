import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { moduleForAddress, moduleRegistry, routeModules } from '../src/lib/moduleRelease.ts'
import { linkAllowed, pageState } from '../src/lib/navAccess.ts'

test('every declared route and configurable function has a database registry entry', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map(([, path]) => path)
  assert.equal(new Set(routes).size, routes.length)
  assert.ok(routes.length >= 102)
  for (const path of routes) assert.ok(Object.hasOwn(routeModules, path), path)
  const migrations = new URL('../../supabase/migrations/', import.meta.url)
  const seeds = readdirSync(migrations)
    .filter(name => name.includes('module_release'))
    .map(name => readFileSync(new URL(name, migrations), 'utf8')).join('\n')
  for (const [id, parent] of Object.entries(moduleRegistry)) {
    assert.ok(seeds.includes(`('${id}', ${parent ? `'${parent}'` : 'null'})`), id)
    if (parent) assert.ok(Object.hasOwn(moduleRegistry, parent), parent)
  }
  for (const id of Object.values(routeModules)) assert.ok(id === 'core' || Object.hasOwn(moduleRegistry, id), id)
})

test('exact routes, nested routes, and legacy aliases share the expected release scope', () => {
  assert.equal(moduleForAddress('/app/hub/pickup'), 'hub.pickup')
  assert.equal(moduleForAddress('/app/accounts/daily/abc/main/'), 'accounts.daily.id.main')
  assert.equal(moduleForAddress('/APP/VEHICLES/mine'), 'fleet.mine')
  assert.equal(moduleForAddress('/app/vehicles/historical/abc'), 'fleet')
  assert.equal(moduleForAddress('/app/routes/plan'), moduleForAddress('/app/routes?tab=plan'))
  assert.equal(moduleForAddress('/app/sorting/routes'), moduleForAddress('/app/routes?tab=sorting'))
  assert.equal(moduleForAddress('/app/module-control'), 'core')
})

test('release decisions can only restrict role permissions and menu visibility', () => {
  const access = { can: p => p === 'da.sheet.view', menu: ['/app/accounts/daily'], releaseAllowed: () => true }
  const path = '/app/accounts/daily'
  assert.equal(pageState(path, access), 'open')
  assert.equal(pageState(path, { ...access, can: () => false }), 'no-permission')
  assert.equal(pageState(path, { ...access, menu: [] }), 'not-listed')
  assert.equal(pageState(path, { ...access, releaseAllowed: () => false }), 'release-unavailable')
  assert.equal(linkAllowed(path, { ...access, releaseAllowed: () => false }), false)
})
