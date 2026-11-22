// Test-only stand-in for the Supabase REST API: answers the app's requests from the local throwaway
// PostgreSQL database, as the signed-in person, with the real RLS policies and functions.
import { createRequire } from 'node:module'
const pg = createRequire(new URL('../../web/', import.meta.url))('pg')
// Reads the usual PG* variables; the database name defaults to the throwaway demo database.
const pool = new pg.Pool({ database: process.env.PGDATABASE || 'xzm_demo', max: 4 })
pg.types.setTypeParser(1114, v => v); pg.types.setTypeParser(1184, v => v); pg.types.setTypeParser(1082, v => v)

export const unsupported = []
const q = s => '"' + String(s).replace(/"/g, '""') + '"'
const splitTop = (s, sep = ',') => { const out = []; let d = 0, cur = '', inq = false
  for (const ch of s) { if (ch === '"') inq = !inq; if (!inq && ch === '(') d++; if (!inq && ch === ')') d--
    if (ch === sep && d === 0 && !inq) { out.push(cur); cur = '' } else cur += ch }
  if (cur !== '') out.push(cur); return out }

let meta
async function loadMeta() {
  if (meta) return meta
  const fk = await pool.query(`select c.conrelid::regclass::text as t, c.confrelid::regclass::text as rt, c.conname,
      (select array_agg(a.attname::text order by k.o) from unnest(c.conkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n) as cols,
      (select array_agg(a.attname::text order by k.o) from unnest(c.confkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.n) as rcols
    from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace`)
  const procs = await pool.query(`select p.oid, p.proname, p.proretset, p.prorettype::regtype::text as ret, t.typtype,
      coalesce(p.proargnames::text[], array[]::text[]) as names, coalesce(p.proargmodes::text[], '{}') as modes,
      (select array_agg(format_type(x, null) order by o) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality u(x,o)) as types,
      p.pronargs, p.pronargdefaults
    from pg_proc p join pg_type t on t.oid=p.prorettype where p.pronamespace='public'::regnamespace`)
  const rels = await pool.query(`select relname from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','m','p')`)
  meta = { fk: fk.rows.map(r => ({ ...r, t: r.t.replace(/^public\./, ''), rt: r.rt.replace(/^public\./, '') })), procs: procs.rows, rels: new Set(rels.rows.map(r => r.relname)) }
  return meta
}

function cond(col, expr, params, alias) {
  let neg = false
  if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4) }
  const i = expr.indexOf('.'); const op = i < 0 ? expr : expr.slice(0, i); let val = i < 0 ? '' : expr.slice(i + 1)
  let c = col.includes('->') ? col.replace(/^([a-z_0-9]+)/, m => `${alias}.${q(m)}`).replace(/->>?([a-z_0-9]+)/gi, (m, k) => m.startsWith('->>') ? `->>'${k}'` : `->'${k}'`) : `${alias}.${q(col)}`
  const p = v => { params.push(v); return '$' + params.length }
  let out
  const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }
  if (ops[op]) out = `${c} ${ops[op]} ${p(val)}`
  else if (op === 'is') out = `${c} is ${/^(null|true|false|unknown)$/i.test(val) ? val : 'null'}`
  else if (op === 'in') { const items = splitTop(val.replace(/^\(|\)$/g, '')).map(s => s.replace(/^"|"$/g, '')); out = `${c}::text = any(${p(items)}::text[])` }
  else if (op === 'like' || op === 'ilike') out = `${c}::text ${op} ${p(val.replace(/\*/g, '%'))}`
  else if (op === 'cs') out = `${c} @> ${p(val)}`
  else if (op === 'cd') out = `${c} <@ ${p(val)}`
  else if (op === 'ov') out = `${c} && ${p(val)}`
  else throw Object.assign(new Error('filter op ' + op), { shim: true })
  return neg ? `not (${out})` : out
}
function logic(expr, params, alias, join) {
  const inner = expr.replace(/^\(|\)$/g, '')
  return '(' + splitTop(inner).map(part => {
    const m = /^(and|or)(\(.*\))$/.exec(part); if (m) return logic(m[2], params, alias, m[1])
    const i = part.indexOf('.'); return cond(part.slice(0, i), part.slice(i + 1), params, alias)
  }).join(` ${join} `) + ')'
}

// select list -> SQL json object expression for one row of `alias` (relation `rel`)
function selectExpr(sel, rel, alias, m, depth = 0, joins = []) {
  if (!sel || sel === '*') return `to_jsonb(${alias})`
  const parts = []
  for (let item of splitTop(sel)) {
    item = item.trim(); if (!item) continue
    const em = /^(?:([a-z_0-9]+):)?([a-z_0-9]+)(?:!([a-z_0-9]+))?(?:!(inner|left))?\((.*)\)$/i.exec(item)
    if (em) {
      let [, al, name, hint, mode, cols] = em
      if (hint === 'inner' || hint === 'left') { mode = hint; hint = null }
      const key = al || name, a2 = `e${depth}_${parts.length}`
      let fk = m.fk.find(f => f.t === rel && f.rt === name && (!hint || f.conname === hint || f.cols.includes(hint)))
      if (fk) { // to-one
        const on = fk.cols.map((c, i) => `${a2}.${q(fk.rcols[i])} = ${alias}.${q(c)}`).join(' and ')
        parts.push(`jsonb_build_object('${key}', (select ${selectExpr(cols, name, a2, m, depth + 1)} from public.${q(name)} ${a2} where ${on}))`)
        if (mode === 'inner') joins.push({ name, key, on: a => fk.cols.map((c, i) => `${a}.${q(fk.rcols[i])} = ${alias}.${q(c)}`).join(' and ') })
        continue
      }
      fk = m.fk.find(f => f.rt === rel && f.t === name && (!hint || f.conname === hint || f.cols.includes(hint)))
      if (fk) { // to-many
        const on = fk.cols.map((c, i) => `${a2}.${q(c)} = ${alias}.${q(fk.rcols[i])}`).join(' and ')
        parts.push(`jsonb_build_object('${key}', (select coalesce(jsonb_agg(${selectExpr(cols, name, a2, m, depth + 1)}), '[]'::jsonb) from public.${q(name)} ${a2} where ${on}))`)
        continue
      }
      throw Object.assign(new Error(`embed ${rel} -> ${name}`), { shim: true })
    }
    if (item === '*') { parts.push(`to_jsonb(${alias})`); continue }
    const cm = /^(?:([a-z_0-9]+):)?([a-z_0-9]+)((?:->>?[a-z_0-9]+)*)(?:::([a-z0-9_]+))?$/i.exec(item)
    if (!cm) throw Object.assign(new Error('select item ' + item), { shim: true })
    const [, al, col, path, cast] = cm
    let e = `${alias}.${q(col)}` + path.replace(/->>?([a-z_0-9]+)/gi, (mm, k) => mm.startsWith('->>') ? `->>'${k}'` : `->'${k}'`)
    if (cast) e = `(${e})::${cast}`
    const key = al || (path ? path.split(/->>?/).pop() : col)
    parts.push(`jsonb_build_object('${key}', ${e})`)
  }
  return parts.length ? parts.join(' || ') : `'{}'::jsonb`
}

function argCall(proc, args) {
  const params = [], bits = []
  const inIdx = proc.names.map((n, i) => ({ n, i })).filter(x => !proc.modes.length || ['i', 'b', 'v'].includes(proc.modes[x.i]))
  for (const [k, v] of Object.entries(args)) {
    const hit = inIdx.find(x => x.n === k); if (!hit) return null
    const type = proc.types[hit.i]
    let val = v
    if (v !== null && /^jsonb?$/.test(type)) val = JSON.stringify(v)
    else if (v !== null && typeof v === 'object' && !Array.isArray(v)) val = JSON.stringify(v)
    else if (Array.isArray(v) && /^jsonb?\[\]$/.test(type)) val = v.map(x => JSON.stringify(x))
    else if (Array.isArray(v) && !type.endsWith('[]')) val = JSON.stringify(v)
    params.push(val); bits.push(`${q(k)} => $${params.length}::${type}`)
  }
  const required = inIdx.slice(0, proc.pronargs - proc.pronargdefaults).map(x => x.n)
  if (required.some(n => !(n in args))) return null
  return { sql: `public.${q(proc.proname)}(${bits.join(', ')})`, params }
}

async function run(userId, fn) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    const claims = userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' }
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    await c.query(`set local role ${userId ? 'authenticated' : 'anon'}`)
    const out = await fn(c)
    await c.query('commit')
    return out
  } catch (e) { await c.query('rollback').catch(() => {}); throw e } finally { c.release() }
}

/** method, full URL, headers (lower-case keys), body string, signed-in user id (or null) */
export async function rest(method, url, headers, body, userId) {
  const m = await loadMeta()
  const u = new URL(url), path = u.pathname.replace(/^.*\/rest\/v1\//, '')
  const prefer = headers.prefer || '', wantObject = (headers.accept || '').includes('vnd.pgrst.object')
  const params = []
  const sp = [...u.searchParams.entries()]
  const get = k => u.searchParams.get(k)
  const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
  try {
    let source, rel, isRpc = false, proc = null, payload = body ? JSON.parse(body) : null
    if (path.startsWith('rpc/')) {
      isRpc = true
      const name = path.slice(4)
      const cands = m.procs.filter(p => p.proname === name)
      if (!cands.length) return { status: 404, json: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } }
      const args = method === 'GET' ? Object.fromEntries(sp.filter(([k]) => !reserved.has(k))) : (payload || {})
      let call = null
      for (const p of cands) { call = argCall(p, args); if (call) { proc = p; break } }
      if (!call) return { status: 404, json: { code: 'PGRST202', message: `Could not find the function public.${name}(${Object.keys(args).join(', ')}) in the schema cache` } }
      params.push(...call.params)
      if (proc.ret === 'void') { await run(userId, c => c.query(`select ${call.sql}`, params)); return { status: 204, json: null } }
      if (!proc.proretset) {
        const r = await run(userId, c => c.query(`select to_jsonb(${call.sql}) as j`, params))
        return { status: 200, json: r.rows[0].j }
      }
      source = `${call.sql}`; rel = proc.ret.replace(/^public\./, '').replace(/^SETOF /i, '')
    } else {
      rel = path
      if (!m.rels.has(rel)) return { status: 404, json: { code: 'PGRST205', message: `Could not find the table 'public.${rel}' in the schema cache` } }
      source = `public.${q(rel)}`
    }
    const where = [], joins = []
    if (!isRpc || method === 'POST' && proc) {
      for (const [k, v] of sp) {
        if (reserved.has(k)) continue
        if (isRpc && method === 'GET') continue
        if (k === 'or' || k === 'and') { where.push(logic(v, params, 't', k)); continue }
        if (k.includes('.')) { // filter on an embedded relation (only !inner matters)
          const [er, ec] = k.split('.'); joins.push({ pending: true, er, ec, v }); continue }
        where.push(cond(k, v, params, 't'))
      }
    }
    const sel = get('select')
    const innerJoins = []
    const scalarSet = isRpc && proc.typtype !== 'c' && proc.ret !== 'record'
    const rowExpr = scalarSet ? 'to_jsonb(t)' : selectExpr(sel, rel, 't', m, 0, innerJoins)
    for (const j of joins) {
      const ij = innerJoins.find(x => x.key === j.er || x.name === j.er); if (!ij) throw Object.assign(new Error('embedded filter ' + j.er), { shim: true })
      where.push(`exists (select 1 from public.${q(ij.name)} jx where ${ij.on('jx')} and ${cond(j.ec, j.v, params, 'jx')})`)
    }
    for (const ij of innerJoins) where.push(`exists (select 1 from public.${q(ij.name)} jx where ${ij.on('jx')})`)
    const w = where.length ? ' where ' + where.join(' and ') : ''
    let order = ''
    if (get('order')) order = ' order by ' + splitTop(get('order')).map(o => { const [c, ...mods] = o.split('.'); if (c.includes('(')) throw Object.assign(new Error('embedded order'), { shim: true })
      return `t.${q(c)}${mods.includes('desc') ? ' desc' : ''}${mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : ''}` }).join(', ')
    let lim = ''
    if (get('limit')) lim += ` limit ${Number(get('limit'))}`
    if (get('offset')) lim += ` offset ${Number(get('offset'))}`
    if (headers.range && !get('limit')) { const rm = /(\d+)-(\d+)/.exec(headers.range); if (rm) lim = ` limit ${rm[2] - rm[1] + 1} offset ${rm[1]}` }

    if (method === 'GET' || method === 'HEAD' || isRpc) {
      const r = await run(userId, async c => {
        const rows = (await c.query(`select ${rowExpr} as j from ${source} t${w}${order}${lim}`, params)).rows.map(x => x.j)
        let total = null
        if (prefer.includes('count=')) total = Number((await c.query(`select count(*) n from ${source} t${w}`, params)).rows[0].n)
        return { rows, total }
      })
      const hdr = { 'content-range': `${r.rows.length ? `0-${r.rows.length - 1}` : '*'}/${r.total ?? '*'}` }
      if (wantObject) { if (r.rows.length !== 1) return { status: 406, json: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${r.rows.length} rows` }, headers: hdr }
        return { status: 200, json: r.rows[0], headers: hdr } }
      return { status: method === 'HEAD' ? 200 : 200, json: method === 'HEAD' ? null : r.rows, headers: hdr }
    }
    const ret = prefer.includes('return=representation')
    const returning = ` returning ${selectExpr(sel, rel, 't', m)} as j`
    let sql
    if (method === 'POST') {
      const rowsIn = Array.isArray(payload) ? payload : [payload]
      const cols = [...new Set(rowsIn.flatMap(r => Object.keys(r)))]
      params.length = 0; params.push(JSON.stringify(rowsIn))
      let conflict = ''
      if (prefer.includes('resolution=merge-duplicates')) conflict = ` on conflict (${(get('on_conflict') || 'id').split(',').map(q).join(',')}) do update set ${cols.map(c => `${q(c)} = excluded.${q(c)}`).join(', ')}`
      else if (prefer.includes('resolution=ignore-duplicates')) conflict = ' on conflict do nothing'
      sql = cols.length ? `insert into public.${q(rel)} as t (${cols.map(q).join(', ')}) select ${cols.map(q).join(', ')} from jsonb_populate_recordset(null::public.${q(rel)}, $1::jsonb)${conflict}${returning}`
        : `insert into public.${q(rel)} as t default values${returning}`
    } else if (method === 'PATCH') {
      const cols = Object.keys(payload); params.push(JSON.stringify(payload))
      sql = `update public.${q(rel)} t set ${cols.map(c => `${q(c)} = x.${q(c)}`).join(', ')} from jsonb_populate_record(null::public.${q(rel)}, $${params.length}::jsonb) x${w}${returning}`
    } else if (method === 'DELETE') sql = `delete from public.${q(rel)} t${w}${returning}`
    else throw Object.assign(new Error('method ' + method), { shim: true })
    const r = await run(userId, c => c.query(sql, params))
    const rows = r.rows.map(x => x.j)
    if (!ret) return { status: method === 'POST' ? 201 : 204, json: null }
    if (wantObject) { if (rows.length !== 1) return { status: 406, json: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }; return { status: 200, json: rows[0] } }
    return { status: method === 'POST' ? 201 : 200, json: rows }
  } catch (e) {
    if (e.shim) { unsupported.push(`${method} ${u.pathname}${u.search} :: ${e.message}`); return { status: 501, json: { code: 'SHIM', message: 'test shim: ' + e.message } } }
    const status = e.code === '42501' ? 403 : e.code === '23505' ? 409 : e.code === '42883' || e.code === '42703' || e.code === '42P01' ? 400 : 400
    return { status, json: { code: e.code || 'XX000', message: e.message, details: e.detail || null, hint: e.hint || null }, pgError: true }
  }
}
export const sql = (text, params) => pool.query(text, params)
export const end = () => pool.end()
