/** IRONLOG Cloudflare Worker + D1 API. Does not require a running computer. */
import { collections, validateRecord } from '../src/validation.ts'

const fail = (status, message) => Object.assign(new Error(message), { status })
const publicUser = row => ({ id: row.id, username: row.username, ranked: !!row.ranked })
const passwordValid = p => typeof p === 'string' && p.length >= 12 && p.length <= 128
const enc = new TextEncoder()
const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('')
const randomHex = count => hex(crypto.getRandomValues(new Uint8Array(count)))
const sha = async text => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)))
const ITERATIONS = 210_000
async function derivePassword(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' }, base, 256))
}
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}
async function body(req, max = 2_000_000) {
  if (!req.headers.get('Content-Type')?.startsWith('application/json')) throw fail(415, 'JSON is required.')
  const size = Number(req.headers.get('Content-Length'))
  if (size > max) throw fail(413, 'Request is too large.')
  const text = await req.text()
  if (text.length > max) throw fail(413, 'Request is too large.')
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value }
  catch { throw fail(400, 'Invalid JSON.') }
}
async function limit(db, key, maximum, periodMs) {
  const now = Date.now()
  const value = await db.prepare(`INSERT INTO rate_limits (key,hits,reset_at) VALUES (?,1,?)
  ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN reset_at <= ? THEN 1 ELSE hits+1 END,
  reset_at=CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END RETURNING hits`).bind(key, now + periodMs, now, now).first('hits')
  if (value > maximum) throw fail(429, 'Too many requests. Try again later.')
}
async function currentUser(req, db) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('Authorization') ?? '')
  if (!match) return null
  return await db.prepare('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires_at>?')
    .bind(await sha(match[1]), Date.now()).first()
}
async function openSession(db, userId) {
  const token = randomHex(32)
  await db.prepare('INSERT INTO sessions (hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(await sha(token), userId, Date.now() + 30 * 86400000).run()
  return token
}
const remote = row => ({ collection: row.collection, id: row.id, revision: row.revision, data: row.data === null ? null : JSON.parse(row.data) })
const response = (obj, status = 200) => Response.json(obj, { status, headers: { 'Cache-Control': 'no-store' } })

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN ?? '').split(',').map(s => s.trim()).filter(Boolean)
}
async function handle(req, env) {
  if (!env.DB) throw fail(503, 'D1 database is not bound to the Worker.')
  const pathname = new URL(req.url).pathname
  const method = req.method
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local'
  if (pathname === '/api/health' && method === 'GET') {
    await env.DB.prepare('SELECT 1').first()
    return response({ service: 'ironlog', version: 3, database: 'ok' })
  }
  if (!pathname.startsWith('/api/')) throw fail(404, 'API route not found.')
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw fail(405, 'Method not allowed.')
  await limit(env.DB, `api:${ip}`, 600, 60_000)
  if (method !== 'GET' && req.headers.get('X-Ironlog-Client') !== '1') throw fail(403, 'Invalid client request.')
  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = await currentUser(req, env.DB)
    return response({ user: user ? publicUser(user) : null })
  }
  if (['/api/auth/register', '/api/auth/login'].includes(pathname) && method === 'POST') {
    await limit(env.DB, `auth:${ip}`, 20, 15 * 60_000)
    const input = await body(req, 4096)
    if (typeof input.username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(input.username) || !passwordValid(input.password)) throw fail(400, 'Use a 3–24 character username and a 12–128 character password.')
    const username = input.username.toLowerCase()
    let user = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first()
    if (pathname.endsWith('/register')) {
      await limit(env.DB, `register:${ip}`, 5, 60 * 60_000)
      if (user) throw fail(409, 'That username is already taken.')
      const salt = randomHex(32)
      const hash = await derivePassword(input.password, salt)
      const id = crypto.randomUUID()
      try {
        await env.DB.prepare('INSERT INTO users (id,username,salt,password_hash,ranked,created_at) VALUES(?,?,?,?,?,?)')
          .bind(id, username, salt, hash, input.ranked === true ? 1 : 0, Date.now()).run()
      } catch (err) { if (String(err).includes('UNIQUE')) throw fail(409, 'That username is already taken.'); throw err }
      user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first()
    } else {
      const hash = await derivePassword(input.password, user?.salt ?? 'ironlog-no-such-user')
      if (!user || !constantTimeEqual(hash, user.password_hash)) throw fail(401, 'Incorrect username or password.')
    }
    const token = await openSession(env.DB, user.id)
    return response({ user: publicUser(user), token })
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('Authorization') ?? '')
    if (match) await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await sha(match[1])).run()
    return response({ ok: true })
  }
  const user = await currentUser(req, env.DB)
  if (!user) throw fail(401, 'Sign in to sync your workouts.')
  if (pathname === '/api/account' && method === 'PATCH') {
    const input = await body(req, 1024)
    if (typeof input.ranked !== 'boolean') throw fail(400, 'Choose whether to appear in rankings.')
    await env.DB.prepare('UPDATE users SET ranked=? WHERE id=?').bind(input.ranked ? 1 : 0, user.id).run()
    return response({ user: { ...publicUser(user), ranked: input.ranked } })
  }
  if (pathname === '/api/account' && method === 'DELETE') {
    await limit(env.DB, `delete:${ip}`, 5, 15 * 60_000)
    const input = await body(req, 4096)
    if (!passwordValid(input.password) || !constantTimeEqual(await derivePassword(input.password, user.salt), user.password_hash)) throw fail(401, 'Incorrect password.')
    await env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.id).run()
    return response({ ok: true })
  }
  if (pathname === '/api/sync' && method === 'POST') {
    const input = await body(req)
    if (input.accountId !== user.id) throw fail(409, 'The signed-in account changed.')
    if (!Array.isArray(input.changes) || input.changes.length > 25 || !Number.isSafeInteger(input.cursor) || input.cursor < 0) throw fail(400, 'Invalid sync request.')
    for (const c of input.changes) {
      if (!c || !collections.includes(c.collection) || typeof c.id !== 'string' || c.id.length < 1 || c.id.length > 200 || !Number.isSafeInteger(c.revision) || c.revision < 0 || typeof c.mutationId !== 'string' || c.mutationId.length < 1 || c.mutationId.length > 100 || (c.data !== null && (!validateRecord(c.collection, c.data) || c.data.id !== c.id || JSON.stringify(c.data).length > 250000))) throw fail(400, 'Invalid record. Existing data was not changed.')
      if (c.collection === 'workouts' && c.data?.finishedAt && Date.parse(c.data.finishedAt) > Date.now() + 300000) throw fail(400, 'Workout completion date is in the future.')
    }
    const acknowledged = [], conflicts = []
    let count = await env.DB.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id=?').bind(user.id).first('n')
    for (const c of input.changes) {
      const old = await env.DB.prepare('SELECT * FROM records WHERE user_id=? AND collection=? AND id=?').bind(user.id, c.collection, c.id).first()
      if (old?.mutation_id === c.mutationId) { acknowledged.push({ collection: c.collection, id: c.id, revision: old.revision, mutationId: c.mutationId }); continue }
      if ((old?.revision ?? 0) !== c.revision) { conflicts.push(old ? remote(old) : { collection: c.collection, id: c.id, revision: 0, data: null }); continue }
      if (!old && ++count > 10000) throw fail(413, 'Account limit is 10,000 records. Export your data before removing old records.')
      let workingSets = 0, bench = 0, workoutCount = 0
      if (c.collection === 'workouts' && c.data?.finishedAt) {
        for (const e of c.data.exercises) for (const s of e.sets) if (s.completed && !s.warmup && s.reps > 0) {
          workingSets++
          if (e.exerciseId === 'bench-press' && s.reps <= 12) bench = Math.max(bench, s.weightKg * (1 + s.reps / 30))
        }
        if (workingSets) workoutCount = 1
      }
      const score = workoutCount ? 100 + 10 * Math.min(30, workingSets) : 0
      const data = c.data === null ? null : JSON.stringify(c.data)
      // D1 batch is transactional; conditional update enforces revision even when two devices race.
      const statements = [env.DB.prepare('UPDATE sequence_counter SET value=value+1 WHERE id=1 RETURNING value')]
      if (old) {
        statements.push(env.DB.prepare(`UPDATE records SET revision=revision+1, mutation_id=?, data=?, sequence=(SELECT value FROM sequence_counter WHERE id=1), score=?, workout_count=?, working_sets=?, bench=?
          WHERE user_id=? AND collection=? AND id=? AND revision=?`).bind(c.mutationId, data, score, workoutCount, workingSets, bench, user.id, c.collection, c.id, c.revision))
      } else {
        statements.push(env.DB.prepare(`INSERT INTO records (user_id,collection,id,revision,mutation_id,data,sequence,score,workout_count,working_sets,bench)
          VALUES (?,?,?,1,?, ?, (SELECT value FROM sequence_counter WHERE id=1),?,?,?,?) ON CONFLICT(user_id,collection,id) DO NOTHING`)
          .bind(user.id, c.collection, c.id, c.mutationId, data, score, workoutCount, workingSets, bench))
      }
      const result = await env.DB.batch(statements)
      if (result[1].meta.changes === 0) {
        const changed = await env.DB.prepare('SELECT * FROM records WHERE user_id=? AND collection=? AND id=?').bind(user.id, c.collection, c.id).first()
        conflicts.push(changed ? remote(changed) : { collection: c.collection, id: c.id, revision: 0, data: null })
      } else acknowledged.push({ collection: c.collection, id: c.id, revision: c.revision + 1, mutationId: c.mutationId })
    }
    const rows = (await env.DB.prepare('SELECT * FROM records WHERE user_id=? AND sequence>? ORDER BY sequence LIMIT 200').bind(user.id, input.cursor).all()).results
    return response({ acknowledged, conflicts, records: rows.map(remote), cursor: rows.at(-1)?.sequence ?? input.cursor, hasMore: rows.length === 200 })
  }
  if (pathname === '/api/rankings' && method === 'GET') {
    const cte = `WITH scores AS (SELECT u.id,u.username,COALESCE(SUM(r.score),0) AS points,COALESCE(SUM(r.workout_count),0) AS workouts,COALESCE(SUM(r.working_sets),0) AS sets,COALESCE(MAX(r.bench),0) AS bench FROM users u LEFT JOIN records r ON r.user_id=u.id WHERE u.ranked=1 GROUP BY u.id), ranked AS (SELECT *,DENSE_RANK() OVER(ORDER BY points DESC) AS rank FROM scores)`
    const entries = (await env.DB.prepare(`${cte} SELECT * FROM ranked ORDER BY points DESC,username ASC LIMIT 100`).all()).results
    const me = user.ranked ? await env.DB.prepare(`${cte} SELECT * FROM ranked WHERE id=?`).bind(user.id).first() : null
    return response({ entries, me, updatedAt: new Date().toISOString() })
  }
  throw fail(404, 'API route not found.')
}
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin')
    const origins = allowedOrigins(env)
    const allowed = Boolean(origin && origins.includes(origin))
    const headers = new Headers({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin', 'Cache-Control': 'no-store' })
    if (allowed) {
      headers.set('Access-Control-Allow-Origin', origin)
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Ironlog-Client')
      headers.set('Access-Control-Max-Age', '7200')
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers })
    if (origin && !allowed) return response({ error: 'This website is not allowed to access the API.' }, 403)
    try {
      const res = await handle(req, env)
      for (const [key, value] of headers) res.headers.set(key, value)
      return res
    } catch (err) {
      if (!err.status) console.error('IRONLOG Worker failure:', err)
      const res = response({ error: err.status ? err.message : 'Server error. Your local copy is still available.' }, err.status ?? 500)
      for (const [key, value] of headers) res.headers.set(key, value)
      return res
    }
  }
}
