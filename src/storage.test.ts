import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db, switchDatabase, saveWorkout, recoverWorkout, timestamp, resumeIndex, remainingRest, checkpointWorkout, flushWrites, importAllData, exportAllData, removeRecord, putRecord } from './storage'
import { validateRecord } from './validation'
import type { WorkoutLog } from './types'

const log = (): WorkoutLog => ({ id: 'workout-1', programId: 'chest-arms', workoutId: 'a', workoutName: 'Training A', startedAt: '2026-01-01T12:00:00.000Z', updatedAt: timestamp(), progress: { exerciseIndex: 1, restEndsAt: Date.now() + 90000 }, exercises: [{ exerciseId: 'bench-press', sets: [{ id: 's1', weightKg: 80, reps: 8, completed: true }] }, { exerciseId: 'incline-db-press', sets: [{ id: 's2', weightKg: 22.5, weightInput: '22,5', inputUnit: 'kg', reps: 0, repsInput: '', completed: false }] }] })
beforeEach(async () => { await switchDatabase(); await db.delete(); localStorage.clear(); await switchDatabase() })
afterEach(async () => { vi.restoreAllMocks(); await flushWrites(); await db.delete() })

describe('workout durability', () => {
  it('writes the recovery copy synchronously and restores position, partial input and the timer after reopening', async () => {
    const draft = log()
    const saving = saveWorkout(draft)
    expect(JSON.parse(localStorage.getItem('ironlog:recovery:ironlog')!)).toEqual(draft)
    await saving
    db.close(); await db.open(); await recoverWorkout()
    const restored = (await db.workouts.get(draft.id))!
    expect(resumeIndex(restored)).toBe(1)
    expect(restored.exercises[1]!.sets[0]).toMatchObject({ weightKg: 22.5, weightInput: '22,5', repsInput: '' })
    expect(remainingRest(restored.progress?.restEndsAt, draft.progress!.restEndsAt! - 30000)).toBe(30)
    expect(remainingRest(restored.progress?.restEndsAt, draft.progress!.restEndsAt! + 1000)).toBe(0)
  })
  it('recovers an interrupted write over an older IndexedDB copy', async () => {
    const old = log(); await saveWorkout(old)
    const latest = { ...old, updatedAt: timestamp(), notes: 'Last edit before OS terminated the app' }
    checkpointWorkout(latest)
    db.close(); await db.open(); await recoverWorkout()
    expect(await db.workouts.get(old.id)).toEqual(latest)
    expect((await db.sync.get(`workouts:${old.id}`))?.dirty).toBe(1)
  })
  it('serializes rapid writes without an old update winning', async () => {
    const draft = log()
    await Promise.all(Array.from({ length: 20 }, (_, index) => saveWorkout({ ...draft, updatedAt: timestamp(), notes: `edit ${index}` })))
    expect((await db.workouts.get(draft.id))?.notes).toBe('edit 19')
  })
  it('keeps the recovery copy when IndexedDB fails and imports it after storage recovers', async () => {
    const draft = log()
    const failing = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    expect(await saveWorkout(draft)).toBe('recovery')
    failing.mockRestore()
    await recoverWorkout()
    expect(await db.workouts.get(draft.id)).toEqual(draft)
  })
  it('does not report a successful save if both storage methods fail', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable') })
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Unavailable', 'QuotaExceededError') })
    await expect(saveWorkout(log())).rejects.toThrow('Storage is unavailable')
  })
  it('retains multiple pending sessions when the database is unavailable', async () => {
    const failing = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    const finished = { ...log(), finishedAt: '2026-01-01T13:00:00.000Z' }
    await saveWorkout(finished)
    await saveWorkout({ ...log(), id: 'next-session' })
    failing.mockRestore()
    await recoverWorkout()
    expect(await db.workouts.count()).toBe(2)
    expect((await db.workouts.get(finished.id))?.finishedAt).toBe(finished.finishedAt)
  })
  it('exports the current workout even when all browser storage is unavailable', async () => {
    const active = log()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full') })
    db.close({ disableAutoOpen: true })
    const backup = JSON.parse(await exportAllData(active))
    expect(backup.partial).toBe(true)
    expect(backup.workouts).toEqual([active])
    await db.open()
  })
  it('keeps finished workouts finished and respects deletions despite stale recovery copies', async () => {
    const draft = log(); await saveWorkout(draft)
    const finished = { ...draft, finishedAt: '2026-01-01T13:00:00.000Z', updatedAt: timestamp() }
    await putRecord('workouts', finished); checkpointWorkout(draft); await recoverWorkout()
    expect((await db.workouts.get(draft.id))?.finishedAt).toBe(finished.finishedAt)
    await removeRecord('workouts', draft.id); await recoverWorkout()
    expect(await db.workouts.get(draft.id)).toBeUndefined()
  })
  it('retains legacy v1 data on upgrade and finds the first incomplete exercise', async () => {
    await db.delete()
    const legacy = new Dexie('ironlog')
    legacy.version(1).stores({ workouts: 'id, programId, workoutId, startedAt, finishedAt', programs: 'id, name, custom', exercises: 'id, name, custom', settings: 'id' })
    const draft = log(); delete draft.progress; delete draft.updatedAt
    await legacy.table('workouts').put(draft); legacy.close()
    await switchDatabase()
    expect(resumeIndex((await db.workouts.get(draft.id))!)).toBe(1)
    expect(await db.workouts.count()).toBe(1)
  })
  it('validates imports before mutation and merges backups without deleting unrelated history', async () => {
    const draft = log(); await saveWorkout(draft)
    const exported = JSON.parse(await exportAllData())
    exported.workouts[0].exercises[0].sets[0].weightKg = -20
    await expect(importAllData(JSON.stringify(exported))).rejects.toThrow('Invalid workouts')
    expect((await db.workouts.get(draft.id))?.exercises[0]!.sets[0]!.weightKg).toBe(80)
    exported.workouts = [{ ...draft, id: 'imported' }]
    await importAllData(JSON.stringify(exported))
    expect(await db.workouts.count()).toBe(2)
    for (const record of await db.programs.toArray()) expect(validateRecord('programs', record)).toBe(true)
  })
  it('isolates guest and account data, including their recovery copies', async () => {
    const guest = log(); await saveWorkout(guest)
    await switchDatabase('account-a'); expect(await db.workouts.count()).toBe(0)
    await saveWorkout({ ...guest, notes: 'A only' })
    await switchDatabase('account-b'); expect(await db.workouts.count()).toBe(0)
    await saveWorkout({ ...guest, notes: 'B only' })
    await switchDatabase('account-a'); expect((await db.workouts.get(guest.id))?.notes).toBe('A only'); await db.delete()
    await switchDatabase('account-b'); await db.delete()
    await switchDatabase(); expect((await db.workouts.get(guest.id))?.notes).toBeUndefined()
    expect(await db.workouts.count()).toBe(1)
  })
})
