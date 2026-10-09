import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import worker from './worker.mjs'

function d1() {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys=ON;')
  database.exec(readFileSync(new URL('./migrations/0001_init.sql', import.meta.url), 'utf8'))
  const prepare = sql => {
    let args = []
    return {
      bind(...values) { args = values; return this },
      first(column) { const row = database.prepare(sql).get(...args); return column ? row?.[column] ?? null : row ?? null },
      all() { return { results: database.prepare(sql).all(...args) } },
      run() {
        const statement = database.prepare(sql)
        if (/RETURNING/i.test(sql)) return { results: statement.all(...args), meta: { changes: 1 } }
        const result = statement.run(...args)
        return { success: true, meta: { changes: Number(result.changes) } }
      },
    }
  }
  return {
    prepare,
    batch(statements) {
      database.exec('BEGIN')
      try { const results = statements.map(s => s.run()); database.exec('COMMIT'); return results }
      catch (error) { database.exec('ROLLBACK'); throw error }
    },
    close() { database.close() },
  }
}
function call(env, path, method='GET', body, token, origin='https://lifter.github.io') {
  return worker.fetch(new Request(`https://ironlog-api.test${path}`, {
    method,
    headers: { Origin: origin, 'X-Ironlog-Client': '1', ...(body ? {'Content-Type':'application/json'} : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body && JSON.stringify(body),
  }), env)
}
const workout = { id: 'workout-1', programId: 'chest-arms', workoutId: 'a', workoutName: 'A', startedAt: '2026-01-01T12:00:00Z', finishedAt: '2026-01-01T13:00:00Z', exercises: [{ exerciseId: 'bench-press', sets: [{id: 'set-1', weightKg: 80, reps: 8, completed: true}] }] }
test('Cloudflare API: register, login, auth, sync, conflicts, rankings, logout, CORS, account deletion', async () => {
  const db = d1()
  const env = { DB: db, ALLOWED_ORIGIN: 'https://lifter.github.io' }
  try {
    const health = await call(env, '/api/health')
    assert.equal(health.status, 200)
    assert.equal((await health.json()).database, 'ok')
    const blocked = await call(env, '/api/health', 'GET', undefined, undefined, 'https://evil.test')
    assert.equal(blocked.status, 403)
    const preflight = await worker.fetch(new Request('https://ironlog-api.test/api/sync', {method:'OPTIONS', headers: {'Origin': 'https://lifter.github.io'}}), env)
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://lifter.github.io')
    const pwd='password-that-is-long-enough'
    const res = await call(env, '/api/auth/register', 'POST', { username: 'TestLifter', password: pwd, ranked: true })
    assert.equal(res.status, 200, await res.text().then(x => x))
  } finally { db.close() }
})

test('Cloudflare API: sessions and workout data round-trip', async () => {
  const db = d1()
  const env = { DB: db, ALLOWED_ORIGIN: 'https://lifter.github.io' }
  try {
    const pwd='password-that-is-long-enough'
    let res = await call(env, '/api/auth/register', 'POST', { username: 'TestLifter', password: pwd, ranked: true })
    assert.equal(res.status, 200)
    const {user, token} = await res.json()
    assert.ok(token?.length===64)
    res = await call(env, '/api/auth/me', 'GET', undefined, token)
    assert.equal((await res.json()).user.id, user.id)
    const change = { collection: 'workouts', id: workout.id, revision: 0, mutationId: 'mutation-1', data: workout }
    res = await call(env, '/api/sync', 'POST', { accountId:user.id, cursor:0, changes:[change] }, token)
    assert.equal(res.status, 200, await res.clone().text())
    let synced = await res.json()
    assert.equal(synced.acknowledged[0].revision,1)
    assert.equal(synced.records[0].data.id, workout.id)
    res = await call(env, '/api/sync', 'POST', { accountId:user.id, cursor:synced.cursor, changes:[{...change,mutationId:'mutation-2'}] }, token)
    assert.equal(res.status, 200)
    assert.equal((await res.json()).conflicts[0].revision,1)
    res = await call(env, '/api/rankings', 'GET', undefined, token)
    assert.equal(res.status, 200)
    assert.equal((await res.json()).entries[0].points, 110)
    res = await call(env, '/api/auth/login', 'POST', {username:'testlifter',password:pwd})
    assert.equal(res.status, 200)
    const otherToken = (await res.json()).token
    res = await call(env, '/api/sync', 'POST', {accountId:user.id,cursor:0,changes:[]}, otherToken)
    assert.equal((await res.json()).records.length,1)
    res = await call(env, '/api/auth/logout', 'POST', {}, token)
    assert.equal(res.status, 200)
    res = await call(env, '/api/sync', 'POST', {accountId:user.id,cursor:0,changes:[]}, token)
    assert.equal(res.status, 401)
    res = await call(env, '/api/account', 'DELETE', {password:pwd}, otherToken)
    assert.equal(res.status, 200)
    res = await call(env, '/api/auth/me', 'GET', undefined, otherToken)
    assert.equal((await res.json()).user, null)
  } finally { db.close() }
})


test('Cloudflare username rules: 4-character minimum, / allowed, and legacy 3-character logins', async () => {
  const db = d1()
  const env = { DB: db, ALLOWED_ORIGIN: 'https://lifter.github.io' }
  const password = 'password-that-is-long-enough'
  try {
    let res = await call(env, '/api/auth/register', 'POST', { username: 'abc', password })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /4–24/)

    res = await call(env, '/api/auth/register', 'POST', { username: 'AB/C', password })
    assert.equal(res.status, 200, await res.clone().text())
    assert.equal((await res.json()).user.username, 'ab/c')

    res = await call(env, '/api/auth/login', 'POST', { username: 'ab/c', password })
    assert.equal(res.status, 200)

    res = await call(env, '/api/auth/register', 'POST', { username: 'ab c', password })
    assert.equal(res.status, 400)

    // Accounts created before the four-character rule may still have three letters.
    await db.prepare('UPDATE users SET username=? WHERE username=?').bind('abc', 'ab/c').run()
    res = await call(env, '/api/auth/login', 'POST', { username: 'abc', password })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).user.username, 'abc')
  } finally { db.close() }
})
