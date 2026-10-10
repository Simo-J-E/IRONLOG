import Dexie, { type Table } from 'dexie'
import type { Collection, Exercise, Program, RemoteRecord, Settings, StoredRecord, SyncState, WorkoutLog } from './types'
import { exercises, programs } from './data'
import { collections, parseBackup, validateRecord } from './validation'
import { localDateKey } from './schedule'

export class IronlogDB extends Dexie {
  workouts!: Table<WorkoutLog, string>
  programs!: Table<Program, string>
  exercises!: Table<Exercise, string>
  settings!: Table<Settings, string>
  sync!: Table<SyncState, string>
  meta!: Table<{ key: string; value: unknown }, string>
  constructor(name = 'ironlog') {
    super(name)
    this.version(1).stores({ workouts: 'id, programId, workoutId, startedAt, finishedAt', programs: 'id, name, custom', exercises: 'id, name, custom', settings: 'id' })
    this.version(2).stores({ sync: 'key, dirty', meta: 'key' })
  }
}
export let db = new IronlogDB()
let writeQueue: Promise<unknown> = Promise.resolve()
let lastTimestamp = 0
export const timestamp = () => new Date(lastTimestamp = Math.max(Date.now(), lastTimestamp + 1)).toISOString()
export const changed = () => window.dispatchEvent(new Event('ironlog-local-change'))
export const table = (store: IronlogDB, c: Collection) => store.table<StoredRecord, string>(c)
const checkpointKey = (store: IronlogDB) => `ironlog:recovery:${store.name}`
const pendingSettingsKey = (store: IronlogDB) => `ironlog:pending-settings:${store.name}`

export async function switchDatabase(accountId?: string) {
  await flushWrites()
  const name = accountId ? `ironlog-account-${accountId}` : 'ironlog'
  if (db.name !== name) { db.close(); db = new IronlogDB(name) }
  await seedDatabase()
  await recoverWorkout()
}
export async function seedDatabase(store = db) {
  await store.open()
  let pendingSettings: Settings | undefined
  try {
    const raw = localStorage.getItem(pendingSettingsKey(store))
    const parsed: unknown = raw ? JSON.parse(raw) : undefined
    if (parsed && validateRecord('settings', parsed)) pendingSettings = parsed
  } catch { /* IndexedDB remains the source of truth when recovery data is unavailable. */ }
  await store.transaction('rw', store.programs, store.exercises, store.settings, async () => {
    for (const p of programs) {
      const saved = await store.programs.get(p.id)
      if (!saved || (!saved.custom && (saved.revision ?? 1) < (p.revision ?? 1))) await store.programs.put(p)
    }
    for (const e of exercises) if (!await store.exercises.get(e.id)) await store.exercises.put(e)
    const settings = await store.settings.get('settings')
    if (pendingSettings) await store.settings.put(pendingSettings)
    else if (!settings) await store.settings.put({ id: 'settings', language: navigator.language.toLowerCase().startsWith('fi') ? 'fi' : 'en', unit: 'kg', onboardingDone: false, activeProgramId: 'chest-arms', trainingDays: [1, 3, 5], autoRest: true, scheduleStartDate: localDateKey(new Date()) })
    else if (!settings.scheduleStartDate) await store.settings.put({ ...settings, scheduleStartDate: localDateKey(new Date()) })
  })
  if (pendingSettings) {
    try {
      const raw = localStorage.getItem(pendingSettingsKey(store))
      if (raw === JSON.stringify(pendingSettings)) localStorage.removeItem(pendingSettingsKey(store))
    } catch { /* Recovery data can be retried on the next start. */ }
  }
}
async function write(store: IronlogDB, collection: Collection, data: StoredRecord | null, id: string) {
  await store.transaction('rw', table(store, collection), store.sync, async () => {
    const key = `${collection}:${id}`
    const prev = await store.sync.get(key)
    if (data) await table(store, collection).put(data)
    else await table(store, collection).delete(id)
    await store.sync.put({ key, collection, id, revision: prev?.revision ?? 0, mutationId: crypto.randomUUID(), dirty: 1, conflict: prev?.conflict })
  })
  changed()
}
export function putRecord(collection: Collection, data: StoredRecord, store = db) {
  const snapshot = structuredClone(data)
  if (!validateRecord(collection, snapshot)) return Promise.reject(new Error('Please check the entered values. They could not be saved.'))
  const recovery = collection === 'settings' ? JSON.stringify(snapshot) : undefined
  if (recovery) {
    try { localStorage.setItem(pendingSettingsKey(store), recovery) } catch { /* IndexedDB may still save normally. */ }
  }
  const job = writeQueue.then(() => write(store, collection, snapshot, snapshot.id)).then(result => {
    if (recovery) {
      try { if (localStorage.getItem(pendingSettingsKey(store)) === recovery) localStorage.removeItem(pendingSettingsKey(store)) } catch { /* A stale recovery copy is harmless and validated on boot. */ }
    }
    return result
  })
  writeQueue = job.catch(() => undefined)
  return job
}
export async function removeRecord(collection: Collection, id: string) {
  const store = db
  const job = writeQueue.then(() => write(store, collection, null, id))
  writeQueue = job.catch(() => undefined)
  return job
}
export const flushWrites = () => writeQueue

// A small write-ahead journal survives termination before IndexedDB commits.
const pendingPrefix = (store: IronlogDB) => `ironlog:pending:${store.name}:`
const committedKey = (store: IronlogDB) => `ironlog:committed:${store.name}`
const stamp = (log: WorkoutLog) => `${log.id}|${log.updatedAt ?? log.startedAt}`
export function checkpointWorkout(log: WorkoutLog, store = db) {
  const raw = JSON.stringify(log)
  let saved = false
  try { localStorage.setItem(pendingPrefix(store) + log.id, raw); saved = true } catch { /* Try the secondary copy. */ }
  try { localStorage.setItem(checkpointKey(store), raw); saved = true } catch { /* The journal may still be saved. */ }
  return saved
}
function markCommitted(log: WorkoutLog, store: IronlogDB) {
  try {
    const key = pendingPrefix(store) + log.id
    if (localStorage.getItem(key) === JSON.stringify(log)) localStorage.removeItem(key)
    if (localStorage.getItem(checkpointKey(store)) === JSON.stringify(log)) localStorage.setItem(committedKey(store), stamp(log))
  } catch { /* IndexedDB already committed; recovery can safely repeat the write. */ }
}
export function clearRecovery(store = db) {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(pendingPrefix(store)) || key === checkpointKey(store) || key === committedKey(store)) localStorage.removeItem(key)
  } catch { /* No browser storage available. */ }
}
function recoveryCopies(store: IronlogDB) {
  const candidates: { log: WorkoutLog; pending: boolean; committed: boolean }[] = []
  try {
    for (const key of Object.keys(localStorage).filter(k => k.startsWith(pendingPrefix(store)) || k === checkpointKey(store))) {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key)!)
        if (validateRecord('workouts', value)) {
          const log = value as WorkoutLog
          candidates.push({ log, pending: key !== checkpointKey(store), committed: localStorage.getItem(committedKey(store)) === stamp(log) })
        }
      } catch { /* Keep malformed recovery bytes untouched. */ }
    }
  } catch { /* IndexedDB can still supply data. */ }
  return candidates.sort((a,b) => (a.log.updatedAt ?? a.log.startedAt).localeCompare(b.log.updatedAt ?? b.log.startedAt))
}
export async function saveWorkout(log: WorkoutLog) {
  if (!validateRecord('workouts', log)) throw new Error('Please check the workout values. They could not be saved.')
  const store = db
  const backupSaved = checkpointWorkout(log, store)
  try { await putRecord('workouts', log, store); markCommitted(log, store); return 'saved' as const }
  catch { if (backupSaved) { changed(); return 'recovery' as const }; throw new Error('Storage is unavailable. Export your data before closing the app.') }
}
export async function recoverWorkout(store = db) {
  for (const { log, committed } of recoveryCopies(store)) {
    const current = await store.workouts.get(log.id)
    const state = await store.sync.get(`workouts:${log.id}`)
    if ((!current && !state) || (current && !committed && (log.updatedAt ?? log.startedAt) > (current.updatedAt ?? current.finishedAt ?? current.startedAt) && (!current.finishedAt || log.finishedAt))) await putRecord('workouts', log, store)
    markCommitted(log, store)
  }
}
export function resumeIndex(log: WorkoutLog) {
  const firstIncomplete = log.exercises.findIndex(e => e.sets.some(s => !s.completed))
  return Math.max(0, Math.min(log.exercises.length - 1, log.progress?.exerciseIndex ?? (firstIncomplete < 0 ? log.exercises.length - 1 : firstIncomplete)))
}
export const remainingRest = (deadline: number | null | undefined, now = Date.now()) => Math.max(0, Math.ceil(((deadline ?? 0) - now) / 1000))

export async function exportAllData(active?: WorkoutLog | null) {
  await flushWrites()
  const fallback = { workouts: [], programs, exercises, settings: [{ id: 'settings', language: 'en', unit: 'kg', onboardingDone: true, activeProgramId: 'chest-arms', trainingDays: [1,3,5], autoRest: true }] }
  const data: Record<string, unknown> = { version: 2, exportedAt: new Date().toISOString(), partial: false }
  for (const c of collections) {
    try { data[c] = await table(db, c).toArray() }
    catch { data[c] = fallback[c]; data.partial = true }
  }
  const logs = new Map((data.workouts as WorkoutLog[]).map(log => [log.id, log]))
  for (const { log, pending, committed } of recoveryCopies(db)) {
    const current = logs.get(log.id)
    const state = await db.sync.get(`workouts:${log.id}`).catch(() => undefined)
    if ((!current && !state) || (pending && !committed && (!current?.finishedAt || log.finishedAt))) logs.set(log.id, log)
  }
  if (active && validateRecord('workouts', active)) logs.set(active.id, active)
  data.workouts = [...logs.values()]
  data.unresolvedConflicts = (await db.sync.toArray().catch(() => [])).filter(x => x.conflict)
  data.conflictBackups = (await db.meta.toArray().catch(() => [])).filter(x => x.key.startsWith('conflict-backup:'))
  return JSON.stringify(data, null, 2)
}
export async function importAllData(json: string) {
  const data = parseBackup(json)
  await flushWrites()
  const store = db
  await store.transaction('rw', [...collections.map(c => table(store, c)), store.sync], async () => {
    for (const c of collections) for (const value of data[c]) {
      if (c === 'workouts') (value as WorkoutLog).updatedAt = timestamp()
      await write(store, c, value, value.id)
    }
  })
  changed()
}
/** Workouts imported by an older IRONLOG version have a fresh updatedAt. */
function sameTrainingRecord(a: StoredRecord, b: StoredRecord) {
  const comparable = (value: StoredRecord) => 'startedAt' in value ? { ...value, updatedAt: undefined } : value
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b))
}

/**
 * Attach training saved before sign-in to the account on this device.
 * A per-account import journal makes the operation repeatable without
 * resurrecting workouts that were subsequently deleted from the account.
 * The guest database remains untouched as an offline backup.
 */
export async function mergeGuestTrainingData(accountId: string): Promise<number> {
  const store = db
  if (store.name !== `ironlog-account-${accountId}`) return 0
  await flushWrites()
  const guest = new IronlogDB('ironlog')
  try {
    await guest.open()
    await recoverWorkout(guest)
    await flushWrites()
    const [workouts, guestPrograms, guestExercises, guestSettings] = await Promise.all([
      guest.workouts.toArray(), guest.programs.toArray(), guest.exercises.toArray(), guest.settings.get('settings'),
    ])
    // These are training records only; account settings cannot be assigned a new ID.
    const sources: { collection: Exclude<Collection, 'settings'>; record: Exclude<StoredRecord, Settings> }[] = [
      ...workouts.map(record => ({ collection: 'workouts' as const, record })),
      ...guestPrograms.filter(record => record.custom).map(record => ({ collection: 'programs' as const, record })),
      ...guestExercises.filter(record => record.custom).map(record => ({ collection: 'exercises' as const, record })),
    ]
    let imported = 0
    await store.transaction('rw', [...collections.map(c => table(store, c)), store.sync, store.meta], async () => {
      for (const { collection, record } of sources) {
        // Do not import bad/partial recovery data into a good account.
        if (!validateRecord(collection, record)) continue
        const importKey = `guest-import:${collection}:${record.id}`
        if (await store.meta.get(importKey)) continue
        const previous = await table(store, collection).get(record.id)
        // A sync tombstone means this account already deleted the record.
        // Don't silently resurrect it from a stale guest copy.
        if (!previous && await store.sync.get(`${collection}:${record.id}`)) {
          await store.meta.put({ key: importKey, value: record.id })
          continue
        }
        // Distinct versions of the same ID must never overwrite one another.
        const identical = previous && sameTrainingRecord(previous, record)
        const target = previous && !identical ? { ...structuredClone(record), id: crypto.randomUUID() } : structuredClone(record)
        if (!previous || !identical) {
          const key = `${collection}:${target.id}`
          await table(store, collection).put(target)
          await store.sync.put({ key, collection, id: target.id, revision: 0, mutationId: crypto.randomUUID(), dirty: 1 })
          await store.meta.put({ key: `guest-imported-record:${key}`, value: record.id })
          imported++
        }
        await store.meta.put({ key: importKey, value: target.id })
      }
      // Apply guest preferences only to a new account that has never synced
      // settings. Another device's account settings should take precedence.
      if (guestSettings && validateRecord('settings', guestSettings) && !await store.meta.get('guest-import:settings:settings')) {
        if (!await store.sync.get('settings:settings')) {
          await table(store, 'settings').put(guestSettings)
          await store.sync.put({ key: 'settings:settings', collection: 'settings', id: 'settings', revision: 0, mutationId: crypto.randomUUID(), dirty: 1 })
          await store.meta.put({ key: 'guest-imported-record:settings:settings', value: 'settings' })
          imported++
        }
        await store.meta.put({ key: 'guest-import:settings:settings', value: 'settings' })
      }
    })
    if (imported) changed()
    return imported
  } finally {
    guest.close()
  }
}

/** Resolve server ID collisions from guest imports without losing either copy. */
export async function reconcileGuestImportConflict(store: IronlogDB, remote: RemoteRecord): Promise<boolean> {
  const key = `${remote.collection}:${remote.id}`
  const source = await store.meta.get(`guest-imported-record:${key}`)
  const state = await store.sync.get(key)
  if (typeof source?.value !== 'string' || !state?.dirty || state.revision !== 0) return false
  const local = await table(store, remote.collection).get(remote.id)
  if (!local) return false
  if (remote.collection === 'settings') {
    // Settings cannot be duplicated because they have a fixed ID. Preserve
    // guest settings for export, and accept existing cloud settings instead.
    await store.meta.put({ key: `conflict-backup:${crypto.randomUUID()}`, value: { savedAt: timestamp(), local, remote } })
    await store.sync.delete(key)
    await store.meta.delete(`guest-imported-record:${key}`)
    await applyRemote(store, remote)
    return true
  }
  if (remote.data && sameTrainingRecord(remote.data, local)) {
    await store.sync.delete(key)
    await store.meta.delete(`guest-imported-record:${key}`)
    await applyRemote(store, remote)
    return true
  }
  // Settings has a fixed 'settings' ID and was handled above. Never
  // create a random-ID settings object while resolving training conflicts.
  if ('language' in local) return false
  const newId = crypto.randomUUID()
  const moved = { ...local, id: newId }
  await table(store, remote.collection).put(moved)
  const movedKey = `${remote.collection}:${newId}`
  await store.sync.put({ key: movedKey, collection: remote.collection, id: newId, revision: 0, mutationId: crypto.randomUUID(), dirty: 1 })
  await store.meta.put({ key: `guest-import:${remote.collection}:${source.value}`, value: newId })
  await store.meta.put({ key: `guest-imported-record:${movedKey}`, value: source.value })
  await table(store, remote.collection).delete(remote.id)
  await store.sync.delete(key)
  await store.meta.delete(`guest-imported-record:${key}`)
  await applyRemote(store, remote)
  return true
}

export async function deleteAllData() {
  await flushWrites()
  const store = db
  await store.transaction('rw', [...collections.map(c => table(store, c)), store.sync, store.meta], async () => {
    for (const c of collections) for (const record of await table(store, c).toArray()) await write(store, c, null, record.id)
    await store.meta.clear()
  })
  clearRecovery(store)
  await seedDatabase()
  changed()
}
export async function requestPersistentStorage() {
  try { return await navigator.storage?.persist?.() ?? false } catch { return false }
}
export async function resolveConflict(state: SyncState, keepLocal: boolean) {
  if (!state.conflict) return
  await db.transaction('rw', table(db, state.collection), db.sync, db.meta, async () => {
    const local = await table(db, state.collection).get(state.id)
    await db.meta.put({ key: `conflict-backup:${crypto.randomUUID()}`, value: { savedAt: timestamp(), local, remote: state.conflict } })
    if (!keepLocal) {
      if (state.conflict!.data) await table(db, state.collection).put(state.conflict!.data)
      else await table(db, state.collection).delete(state.id)
      if (state.collection === 'workouts') {
        try { localStorage.removeItem(pendingPrefix(db) + state.id); const raw = localStorage.getItem(checkpointKey(db)); if (raw && JSON.parse(raw).id === state.id) localStorage.removeItem(checkpointKey(db)) } catch { /* Optional. */ }
      }
    }
    await db.sync.put({ ...state, revision: state.conflict!.revision, mutationId: crypto.randomUUID(), dirty: keepLocal ? 1 : 0, conflict: undefined })
  })
  changed()
  window.dispatchEvent(new Event('ironlog-conflict-resolved'))
}
export async function applyRemote(store: IronlogDB, remote: RemoteRecord) {
  const key = `${remote.collection}:${remote.id}`
  const current = await store.sync.get(key)
  if (current?.dirty || (current && current.revision >= remote.revision)) return
  if (remote.data) await table(store, remote.collection).put(remote.data)
  else await table(store, remote.collection).delete(remote.id)
  await store.sync.put({ key, collection: remote.collection, id: remote.id, revision: remote.revision, mutationId: '', dirty: 0 })
}
