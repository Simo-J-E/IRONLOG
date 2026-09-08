import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdirSync, statSync, readFileSync } from 'node:fs'
import { dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collections, validateRecord } from '../src/validation.ts'

const derive = promisify(scrypt)
const sha = value => createHash('sha256').update(value).digest('hex')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicUser = row => ({ id: row.id, username: row.username, ranked: !!row.ranked })
const fail = (status, message) => Object.assign(new Error(message), { status })
const passwordValid = p => typeof p === 'string' && p.length >= 12 && p.length <= 128
const SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
let hashing = 0
async function passwordHash(password, salt) {
  if (hashing >= 2) throw fail(429, 'Please try again in a few seconds.')
  hashing++
  try { return await derive(password, salt, 64, SCRYPT) } finally { hashing-- }
}

export function createApp({ databasePath = resolve(ROOT, 'data/ironlog.sqlite'), publicOrigin = '', production = false, staticDir = resolve(ROOT, 'dist'), authLimit = 20 } = {}) {
  if (production && (!publicOrigin || new URL(publicOrigin).protocol !== 'https:')) throw new Error('Set PUBLIC_ORIGIN to your HTTPS website URL in production.')
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error('PUBLIC_ORIGIN must be an origin without a trailing slash or path.')
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(databasePath)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, ranked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, collection TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, mutation_id TEXT NOT NULL, data TEXT, sequence INTEGER NOT NULL, score INTEGER NOT NULL DEFAULT 0, workout_count INTEGER NOT NULL DEFAULT 0, working_sets INTEGER NOT NULL DEFAULT 0, bench REAL NOT NULL DEFAULT 0, PRIMARY KEY(user_id,collection,id));
    CREATE INDEX IF NOT EXISTS records_pull ON records(user_id,sequence);
    CREATE TABLE IF NOT EXISTS sequence_counter (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
    INSERT OR IGNORE INTO sequence_counter VALUES(1,0);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    PRAGMA user_version=1;`)
  const cookieName = production ? '__Host-ironlog' : 'ironlog_session'
  const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${production ? '; Secure' : ''}`
  function limit(key, maximum, windowMs) {
    const now = Date.now()
    db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').run(now)
    db.prepare('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1').run(key, now + windowMs)
    const row = db.prepare('SELECT hits FROM rate_limits WHERE key=?').get(key)
    if (row.hits > maximum) throw fail(429, 'Too many requests. Please try again later.')
  }
  function getUser(req) {
    const token = (req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
    return db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires_at>?').get(sha(token), Date.now()) ?? null
  }
  function session(userId, res) {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
    const token = randomBytes(32).toString('hex')
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token), userId, Date.now() + 30 * 86400000)
    res.setHeader('Set-Cookie', cookie(token, 30 * 86400))
  }
  function revoke(req, res) {
    const token = (req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    if (token) db.prepare('DELETE FROM sessions WHERE hash=?').run(sha(token))
    res.setHeader('Set-Cookie', cookie('', 0))
  }
  async function body(req, max = 2_000_000) {
    if (!String(req.headers['content-type']).startsWith('application/json')) throw fail(415, 'JSON is required.')
    let size = 0
    const chunks = []
    for await (const chunk of req) { size += chunk.length; if (size > max) throw fail(413, 'Request is too large.'); chunks.push(chunk) }
    try { const parsed = JSON.parse(Buffer.concat(chunks).toString()); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error(); return parsed } catch { throw fail(400, 'Invalid JSON.') }
  }
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)) }
  const remote = row => ({ collection: row.collection, id: row.id, revision: row.revision, data: row.data ? JSON.parse(row.data) : null })

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname
      if (!pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'Method not allowed.')
        let path = decodeURIComponent(pathname)
        if (path === '/') path = '/index.html'
        const file = resolve(staticDir, `.${path}`)
        if (!file.startsWith(resolve(staticDir) + '/') || path.split('/').some(p => p.startsWith('.'))) throw fail(404, 'Not found.')
        let content
        try { if (!statSync(file).isFile()) throw Error(); content = readFileSync(file) } catch { throw fail(404, 'Not found. Build the frontend with npm run build.') }
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' }
        res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' })
        return res.end(req.method === 'HEAD' ? undefined : content)
      }
      const ip = req.socket.remoteAddress ?? 'unknown'
      limit(`api:${ip}`, 600, 60000)
      if (!['GET', 'HEAD'].includes(req.method)) {
        const expected = publicOrigin || `http://${req.headers.host}`
        if (req.headers['x-ironlog-client'] !== '1' || req.headers.origin !== expected) throw fail(403, 'Request origin is not allowed.')
      }
      if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { service: 'ironlog', version: 2 })
      if (pathname === '/api/auth/me' && req.method === 'GET') { const signedIn = getUser(req); return json(res, 200, { user: signedIn ? publicUser(signedIn) : null }) }
      if (['/api/auth/register', '/api/auth/login'].includes(pathname) && req.method === 'POST') {
        limit(`auth:${ip}`, authLimit, 15 * 60000)
        const input = await body(req, 4096)
        if (typeof input.username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(input.username) || !passwordValid(input.password)) throw fail(400, 'Use a 3–24 character username (letters, numbers, underscore) and a 12–128 character password.')
        const username = input.username.toLowerCase()
        let user = db.prepare('SELECT * FROM users WHERE username=?').get(username)
        if (pathname.endsWith('register')) {
          limit(`register:${ip}`, 5, 3600000)
          if (user) throw fail(409, 'That username is already taken.')
          const salt = randomBytes(32).toString('hex')
          const hash = await passwordHash(input.password, salt)
          const id = randomUUID()
          try { db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id, username, salt, hash.toString('hex'), input.ranked === true ? 1 : 0, Date.now()) } catch (err) { if (String(err).includes('UNIQUE')) throw fail(409, 'That username is already taken.'); throw err }
          user = db.prepare('SELECT * FROM users WHERE id=?').get(id)
        } else {
          const hash = await passwordHash(input.password, user?.salt ?? 'ironlog-nonexistent-account-padding')
          const expected = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64)
          if (!timingSafeEqual(hash, expected) || !user) throw fail(401, 'Incorrect username or password.')
        }
        session(user.id, res)
        return json(res, 200, { user: publicUser(user) })
      }
      if (pathname === '/api/auth/logout' && req.method === 'POST') { revoke(req, res); return json(res, 200, { ok: true }) }
      const user = getUser(req)
      if (!user) throw fail(401, 'Sign in to sync your saved workouts.')
      if (pathname === '/api/account' && req.method === 'PATCH') {
        const input = await body(req, 1024)
        if (typeof input.ranked !== 'boolean') throw fail(400, 'Choose whether to appear in rankings.')
        db.prepare('UPDATE users SET ranked=? WHERE id=?').run(input.ranked ? 1 : 0, user.id)
        return json(res, 200, { user: { ...publicUser(user), ranked: input.ranked } })
      }
      if (pathname === '/api/account' && req.method === 'DELETE') {
        limit(`delete:${ip}`, 5, 15 * 60000)
        const input = await body(req, 4096)
        if (!passwordValid(input.password) || !timingSafeEqual(await passwordHash(input.password, user.salt), Buffer.from(user.password_hash, 'hex'))) throw fail(401, 'Incorrect password.')
        db.prepare('DELETE FROM users WHERE id=?').run(user.id)
        revoke(req, res)
        return json(res, 200, { ok: true })
      }
      if (pathname === '/api/sync' && req.method === 'POST') {
        const input = await body(req)
        if (input.accountId !== user.id) throw fail(409, 'The signed-in account changed. Sign in again before syncing.')
        if (!Array.isArray(input.changes) || input.changes.length > 25 || !Number.isSafeInteger(input.cursor) || input.cursor < 0) throw fail(400, 'Invalid sync request.')
        for (const c of input.changes) {
          if (!c || !collections.includes(c.collection) || typeof c.id !== 'string' || c.id.length < 1 || c.id.length > 200 || !Number.isSafeInteger(c.revision) || c.revision < 0 || typeof c.mutationId !== 'string' || c.mutationId.length < 1 || c.mutationId.length > 100 || (c.data !== null && (!validateRecord(c.collection, c.data) || c.data.id !== c.id || JSON.stringify(c.data).length > 250000))) throw fail(400, 'Invalid record. Existing data was not changed.')
          if (c.collection === 'workouts' && c.data?.finishedAt && Date.parse(c.data.finishedAt) > Date.now() + 300000) throw fail(400, 'Workout completion date is in the future.')
        }
        const acknowledged = [], conflicts = []
        db.exec('BEGIN IMMEDIATE')
        try {
          const count = db.prepare('SELECT count(*) AS n FROM records WHERE user_id=?').get(user.id).n
          if (count + input.changes.filter(c => !db.prepare('SELECT 1 FROM records WHERE user_id=? AND collection=? AND id=?').get(user.id, c.collection, c.id)).length > 10000) throw fail(413, 'Account limit is 10,000 records. Export a backup before removing old data.')
          for (const c of input.changes) {
            const old = db.prepare('SELECT * FROM records WHERE user_id=? AND collection=? AND id=?').get(user.id, c.collection, c.id)
            if (old?.mutation_id === c.mutationId) { acknowledged.push({ ...remote(old), mutationId: c.mutationId }); continue }
            if ((old?.revision ?? 0) !== c.revision) { conflicts.push(old ? remote(old) : { collection: c.collection, id: c.id, revision: 0, data: null }); continue }
            let workingSets = 0, bench = 0, workoutCount = 0
            if (c.collection === 'workouts' && c.data?.finishedAt) {
              for (const e of c.data.exercises) for (const s of e.sets) if (s.completed && !s.warmup && s.reps > 0) { workingSets++; if (e.exerciseId === 'bench-press' && s.reps <= 12) bench = Math.max(bench, s.weightKg * (1 + s.reps / 30)) }
              if (workingSets) workoutCount = 1
            }
            const score = workoutCount ? 100 + 10 * Math.min(30, workingSets) : 0
            const seq = db.prepare('UPDATE sequence_counter SET value=value+1 WHERE id=1 RETURNING value').get().value
            const revision = (old?.revision ?? 0) + 1
            db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,collection,id) DO UPDATE SET revision=excluded.revision,mutation_id=excluded.mutation_id,data=excluded.data,sequence=excluded.sequence,score=excluded.score,workout_count=excluded.workout_count,working_sets=excluded.working_sets,bench=excluded.bench').run(user.id, c.collection, c.id, revision, c.mutationId, c.data === null ? null : JSON.stringify(c.data), seq, score, workoutCount, workingSets, bench)
            acknowledged.push({ collection: c.collection, id: c.id, revision, mutationId: c.mutationId })
          }
          db.exec('COMMIT')
        } catch (err) { db.exec('ROLLBACK'); throw err }
        const rows = db.prepare('SELECT * FROM records WHERE user_id=? AND sequence>? ORDER BY sequence LIMIT 200').all(user.id, input.cursor)
        return json(res, 200, { acknowledged, conflicts, records: rows.map(remote), cursor: rows.at(-1)?.sequence ?? input.cursor, hasMore: rows.length === 200 })
      }
      if (pathname === '/api/rankings' && req.method === 'GET') {
        const ranked = db.prepare(`WITH scores AS (SELECT u.id,u.username,COALESCE(SUM(r.score),0) AS points,COALESCE(SUM(r.workout_count),0) AS workouts,COALESCE(SUM(r.working_sets),0) AS sets,COALESCE(MAX(r.bench),0) AS bench FROM users u LEFT JOIN records r ON r.user_id=u.id WHERE u.ranked=1 GROUP BY u.id), ranked AS (SELECT *,DENSE_RANK() OVER(ORDER BY points DESC) AS rank FROM scores) SELECT * FROM ranked ORDER BY points DESC,username ASC LIMIT 100`).all()
        const mine = user.ranked ? db.prepare(`WITH scores AS (SELECT u.id,u.username,COALESCE(SUM(r.score),0) AS points,COALESCE(SUM(r.workout_count),0) AS workouts,COALESCE(SUM(r.working_sets),0) AS sets,COALESCE(MAX(r.bench),0) AS bench FROM users u LEFT JOIN records r ON r.user_id=u.id WHERE u.ranked=1 GROUP BY u.id), ranked AS (SELECT *,DENSE_RANK() OVER(ORDER BY points DESC) AS rank FROM scores) SELECT * FROM ranked WHERE id=?`).get(user.id) : null
        return json(res, 200, { entries: ranked, me: mine, updatedAt: new Date().toISOString() })
      }
      throw fail(404, 'API route not found.')
    } catch (err) {
      if (!err.status) console.error('IRONLOG request failed:', err.message)
      if (!res.headersSent) json(res, err.status ?? 500, { error: err.status ? err.message : 'Server error. Your device copy is still available.' })
      else res.end()
    }
  })
  server.requestTimeout = 30000
  server.headersTimeout = 10000
  return { server, db, close: () => new Promise(resolveClose => server.close(() => { db.close(); resolveClose() })) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp({ databasePath: process.env.DATABASE_PATH || undefined, publicOrigin: process.env.PUBLIC_ORIGIN || '', production: process.env.NODE_ENV === 'production' })
  const port = Number(process.env.PORT || 3001)
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`IRONLOG listening on port ${port}`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0) })
}
