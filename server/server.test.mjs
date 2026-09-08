import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from './index.mjs'

const origin = 'http://ironlog.test'
let app, base, directory
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'ironlog-test-'))
  app = createApp({ databasePath: join(directory, 'data.sqlite'), publicOrigin: origin })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${app.server.address().port}`
})
afterEach(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }) })
function client() {
  let cookie = '', user
  return {
    get user() { return user },
    async request(path, method = 'GET', data, headers = {}) {
      const res = await fetch(`${base}/api${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Ironlog-Client': '1', Cookie: cookie, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) })
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0]
      const body = await res.json()
      if (body.user) user = body.user
      return { status: res.status, body, headers: res.headers }
    },
    async register(username, ranked = false) { const r = await this.request('/auth/register', 'POST', { username, password: 'Long unique test password!', ranked }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r },
    async sync(changes = [], cursor = 0) { return this.request('/sync', 'POST', { accountId: user.id, cursor, changes }) }
  }
}
const workout = (id = 'workout') => ({ id, programId: 'p', workoutId: 'w', workoutName: 'A', startedAt: '2026-01-01T12:00:00Z', finishedAt: '2026-01-01T13:00:00Z', exercises: [{ exerciseId: 'bench-press', sets: [{ id: 'a', weightKg: 80, reps: 8, completed: true }, { id: 'b', weightKg: 20, reps: 10, completed: true, warmup: true }, { id: 'c', weightKg: 120, reps: 2, completed: false }] }] })
const change = (data, revision = 0, mutationId = 'mutation-1') => ({ collection: 'workouts', id: data?.id ?? 'workout', revision, mutationId, data })

test('accounts use hashed passwords and HttpOnly sessions, reject wrong passwords and block cross-origin mutations', async () => {
  const alice = client(); const registered = await alice.register('alice')
  assert.match(registered.headers.get('set-cookie'), /HttpOnly/)
  assert.match(registered.headers.get('set-cookie'), /SameSite=Lax/)
  const stored = app.db.prepare('SELECT * FROM users').get()
  assert.equal(stored.username, 'alice'); assert.notEqual(stored.password_hash, 'Long unique test password!'); assert.equal(stored.password_hash.length, 128)
  assert.equal((await alice.request('/account', 'PATCH', { ranked: true }, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await alice.request('/account', 'PATCH', { ranked: true }, { 'X-Ironlog-Client': '' })).status, 403)
  assert.equal((await client().request('/sync', 'POST', { accountId: stored.id, cursor: 0, changes: [] })).status, 401)
  assert.equal((await client().request('/auth/login', 'POST', { username: 'alice', password: 'Incorrect long password!' })).status, 401)
  await alice.request('/auth/logout', 'POST', {})
  assert.equal((await alice.request('/auth/me')).body.user, null)
})
test('retries do not double count rankings, and only completed working sets qualify', async () => {
  const alice = client(); await alice.register('alice', true)
  const draft = workout('draft'); delete draft.finishedAt
  const changes = [change(workout()), change(draft)]
  assert.equal((await alice.sync(changes)).status, 200)
  assert.equal((await alice.sync(changes)).status, 200)
  const ranks = (await alice.request('/rankings')).body
  assert.equal(ranks.me.points, 110); assert.equal(ranks.me.workouts, 1); assert.equal(ranks.me.sets, 1); assert.equal(ranks.me.rank, 1)
  assert.ok(Math.abs(ranks.me.bench - 101.33333) < 0.01)
  await alice.sync([change(null, 1, 'delete-workout')])
  assert.equal((await alice.request('/rankings')).body.me.points, 0)
})
test('account records are isolated and ranking participation is optional', async () => {
  const alice = client(), bob = client(); await alice.register('alice', true); await bob.register('bob')
  await alice.sync([change(workout())])
  assert.deepEqual((await bob.sync()).body.records, [])
  assert.equal((await bob.request('/sync', 'POST', { accountId: alice.user.id, cursor: 0, changes: [] })).status, 409)
  assert.equal((await bob.request('/rankings')).body.entries.length, 1)
  assert.equal((await bob.request('/rankings')).body.me, null)
  await bob.request('/account', 'PATCH', { ranked: true }); await bob.sync([change(workout())])
  const entries = (await bob.request('/rankings')).body.entries
  assert.equal(entries.length, 2); assert.equal(entries[0].rank, entries[1].rank)
  await alice.request('/account', 'PATCH', { ranked: false })
  assert.equal((await bob.request('/rankings')).body.entries.length, 1)
})
test('stale device revisions are rejected with the saved remote version, and invalid batches are atomic', async () => {
  const alice = client(); await alice.register('alice')
  await alice.sync([change(workout())])
  const newer = { ...workout(), notes: 'newest device copy' }
  await alice.sync([change(newer, 1, 'newer')])
  const stale = await alice.sync([change({ ...workout(), notes: 'stale device' }, 1, 'stale')])
  assert.equal(stale.body.conflicts[0].revision, 2); assert.equal(stale.body.conflicts[0].data.notes, 'newest device copy')
  const invalid = workout('invalid'); invalid.exercises[0].sets[0].reps = -1
  assert.equal((await alice.sync([change(workout('valid')), change(invalid)])).status, 400)
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM records').get().n, 1)
})
test('SQLite records and sessions survive a backend restart, and account deletion removes server data', async () => {
  const alice = client(); await alice.register('alice', true); await alice.sync([change(workout())])
  await app.close()
  app = createApp({ databasePath: join(directory, 'data.sqlite'), publicOrigin: origin })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${app.server.address().port}`
  assert.equal((await alice.request('/auth/me')).body.user.username, 'alice')
  assert.equal((await alice.sync()).body.records.length, 1)
  assert.equal((await alice.request('/account', 'DELETE', { password: 'Long unique test password!' })).status, 200)
  for (const table of ['users', 'records', 'sessions']) assert.equal(app.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0)
})
test('production requires HTTPS and authentication attempts are rate limited', async () => {
  assert.throws(() => createApp({ production: true, databasePath: ':memory:' }), /PUBLIC_ORIGIN/)
  const production = createApp({ production: true, publicOrigin: 'https://ironlog.example.com', databasePath: ':memory:' }); production.db.close()
  app.db.prepare('INSERT INTO rate_limits VALUES(?,?,?)').run('auth:127.0.0.1', 20, Date.now() + 60000)
  const response = await client().request('/auth/login', 'POST', { username: 'nobody', password: 'Long unique test password!' })
  assert.equal(response.status, 429)
})
