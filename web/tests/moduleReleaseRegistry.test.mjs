// Mandatory registration enforcement — a CI gate.
//
// Scans every supabase/migrations/*.sql file for `module_release_require('<id>', …)` calls
// and asserts that every <id> is a seeded entry in private.release_module (via moduleRegistry).
// A new guarded wrapper that references an unregistered module ID fails this test, so a
// follow-up migration that forgets to seed the module gets rejected at CI time.
//
// Standalone: imports only the pure moduleRelease.ts module and reads files from disk, so it
// runs under plain `node --experimental-strip-types --test` without requiring node_modules.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { moduleRegistry, routeModules } from '../src/lib/moduleRelease.ts'

const migrationsDir = new URL('../../supabase/migrations/', import.meta.url)
const migrationFiles = readdirSync(migrationsDir)
  .filter(name => name.endsWith('.sql'))
  .map(name => ({ name, text: readFileSync(new URL(name, migrationsDir), 'utf8') }))

// Collect every literal module id referenced by a `module_release_require('<id>', …)` call.
// Skip concatenated / interpolated calls (`module_release_require('nodi.action-' || p_feature)`)
// because we can't statically know the full id — a runtime assertion covers those.
const guardCallRe = /module_release_require\(\s*'([a-z0-9._-]+)'\s*(?:,|\))/g
const guardRefs = new Map()  // module id -> list of migration filenames
for (const file of migrationFiles) {
  for (const [, id] of file.text.matchAll(guardCallRe)) {
    if (!guardRefs.has(id)) guardRefs.set(id, [])
    guardRefs.get(id).push(file.name)
  }
}

test('every static module_release_require call targets a registered module', () => {
  assert.ok(guardRefs.size > 0, 'at least one guarded wrapper should exist')
  const missing = [...guardRefs.entries()].filter(([id]) => !Object.hasOwn(moduleRegistry, id))
  assert.deepEqual(missing, [], 'guard references to modules missing from moduleRegistry: ' + JSON.stringify(missing))
})

test('every routeModules module id resolves to a registered module', () => {
  const missing = [...new Set(Object.values(routeModules))]
    .filter(id => id !== 'core' && !Object.hasOwn(moduleRegistry, id))
  assert.deepEqual(missing, [], 'routeModules refer to unregistered modules: ' + JSON.stringify(missing))
})

test('every registered module except top-level has its parent also registered', () => {
  const orphans = Object.entries(moduleRegistry)
    .filter(([_, parent]) => parent !== null && !Object.hasOwn(moduleRegistry, parent))
    .map(([id, parent]) => `${id} → ${parent}`)
  assert.deepEqual(orphans, [], 'modules with missing parents: ' + JSON.stringify(orphans))
})

test('every registered module id matches the hierarchical format', () => {
  const idRe = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/
  const bad = Object.keys(moduleRegistry).filter(id => !idRe.test(id))
  assert.deepEqual(bad, [], 'module ids with invalid format: ' + JSON.stringify(bad))
})

test('every registered child id starts with its parent id plus a dot', () => {
  const wrongParent = Object.entries(moduleRegistry)
    .filter(([id, parent]) => parent !== null && !id.startsWith(parent + '.'))
    .map(([id, parent]) => `${id} → parent ${parent}`)
  assert.deepEqual(wrongParent, [], 'child-parent id mismatch (also enforced by DB check constraint): ' + JSON.stringify(wrongParent))
})
