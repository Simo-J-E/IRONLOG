import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './account'
import { mergeGuestTrainingData, db, putRecord, removeRecord, saveWorkout, switchDatabase, timestamp, flushWrites } from './storage'
import { syncAccount } from './sync'
import type { Account, WorkoutLog } from './types'

vi.mock('./account', async original => {
  const actual = await original<typeof import('./account')>()
  return { ...actual, api: vi.fn() }
})
const request = vi.mocked(api)
const account: Account = { id: 'guest-merge-test-account', username: 'test', ranked: false }
const workout = (id: string, notes = ''): WorkoutLog => ({
  id, programId: 'chest-arms', workoutId: 'a', workoutName: 'Chest session',
  startedAt: '2026-01-01T10:00:00.000Z', finishedAt: '2026-01-01T11:00:00.000Z',
  updatedAt: timestamp(), notes,
  exercises: [{ exerciseId: 'bench-press', sets: [{ id: 'set-1', weightKg: 80, reps: 8, completed: true }] }],
})

beforeEach(async () => {
  request.mockReset()
  await switchDatabase(account.id); await db.delete()
  await switchDatabase(); await db.delete(); localStorage.clear(); await switchDatabase()
})
afterEach(async () => {
  await flushWrites()
  await switchDatabase(account.id); await db.delete()
  await switchDatabase(); await db.delete()
})

describe('automatic guest data merge', () => {
  it('adds local workouts and custom training records without overwriting cloud records', async () => {
    const local = workout('guest-workout')
    await saveWorkout(local)
    const program = { ...(await db.programs.get('chest-arms'))!, id: 'guest-program', name: 'Local plan', custom: true }
    const exercise = { ...(await db.exercises.get('bench-press'))!, id: 'guest-exercise', name: 'Local lift', custom: true }
    await putRecord('programs', program)
    await putRecord('exercises', exercise)
    await switchDatabase(account.id)
    const remote = workout('cloud-workout', 'from another device')
    await db.workouts.put(remote)
    await db.sync.put({ key: 'workouts:cloud-workout', collection: 'workouts', id: remote.id, revision: 1, mutationId: '', dirty: 0 })
    const total = await mergeGuestTrainingData(account.id)
    expect(total).toBe(4) // workout + plan + exercise + preferences
    expect((await db.workouts.toArray()).map(x => x.id).sort()).toEqual(['cloud-workout', 'guest-workout'])
    expect(await db.programs.get(program.id)).toEqual(program)
    expect(await db.exercises.get(exercise.id)).toEqual(exercise)
    expect((await db.sync.get('workouts:guest-workout'))?.dirty).toBe(1)
    expect(await mergeGuestTrainingData(account.id)).toBe(0)
    await removeRecord('workouts', 'guest-workout')
    // Reauth must never restore a training session the account deleted.
    await mergeGuestTrainingData(account.id)
    expect(await db.workouts.get('guest-workout')).toBeUndefined()
    await switchDatabase()
    expect(await db.workouts.get('guest-workout')).toEqual(local)
  })

  it('saves workout history from a second device into the same account automatically', async () => {
    await saveWorkout(workout('phone-workout'))
    await switchDatabase(account.id)
    expect(await mergeGuestTrainingData(account.id)).toBeGreaterThan(0)
    request.mockImplementation(async (_path, _method, input) => ({
      acknowledged: (input as { changes: { collection: string; id: string; mutationId: string }[] }).changes.map(c => ({ ...c, revision: 1 })),
      conflicts: [], records: [], cursor: 1, hasMore: false,
    }))
    await syncAccount(account, vi.fn())
    expect((await db.sync.get('workouts:phone-workout'))?.dirty).toBe(0)
    await switchDatabase()
    await db.delete(); await switchDatabase()
    await saveWorkout(workout('laptop-workout'))
    await switchDatabase(account.id)
    expect(await mergeGuestTrainingData(account.id)).toBeGreaterThan(0)
    await syncAccount(account, vi.fn())
    expect((await db.sync.get('workouts:laptop-workout'))?.dirty).toBe(0)
    expect((await db.workouts.toArray()).map(x => x.id).sort()).toEqual(['laptop-workout', 'phone-workout'])
  })

  it('avoids duplicating previously imported workouts when only updatedAt differs', async () => {
    const local = workout('same-workout', 'same data')
    await saveWorkout(local)
    await switchDatabase(account.id)
    await db.workouts.put({ ...local, updatedAt: timestamp() })
    expect(await mergeGuestTrainingData(account.id)).toBe(1) // only preferences are new
    expect(await db.workouts.count()).toBe(1)
    expect(await mergeGuestTrainingData(account.id)).toBe(0)
  })

  it('keeps both copies when a downloaded workout has the same ID but different data', async () => {
    await saveWorkout(workout('shared-id', 'device copy'))
    await switchDatabase(account.id)
    await db.workouts.put(workout('shared-id', 'server copy'))
    await db.sync.put({ key: 'workouts:shared-id', collection: 'workouts', id: 'shared-id', revision: 2, mutationId: '', dirty: 0 })
    await mergeGuestTrainingData(account.id)
    const records = await db.workouts.toArray()
    expect(records).toHaveLength(2)
    expect(records.map(record => record.notes).sort()).toEqual(['device copy', 'server copy'])
    expect(new Set(records.map(record => record.id)).size).toBe(2)
  })

  it('does not restore a workout previously deleted from this account', async () => {
    await saveWorkout(workout('deleted-id'))
    await switchDatabase(account.id)
    await db.sync.put({ key: 'workouts:deleted-id', collection: 'workouts', id: 'deleted-id', revision: 2, mutationId: 'deletion', dirty: 0 })
    await mergeGuestTrainingData(account.id)
    expect(await db.workouts.get('deleted-id')).toBeUndefined()
    await mergeGuestTrainingData(account.id)
    expect(await db.workouts.get('deleted-id')).toBeUndefined()
  })

  it('resolves a server-side ID collision by saving the imported session under a new ID', async () => {
    await saveWorkout(workout('shared-id', 'guest copy'))
    await switchDatabase(account.id)
    await mergeGuestTrainingData(account.id)
    const remote = { collection: 'workouts' as const, id: 'shared-id', revision: 1, data: workout('shared-id', 'server copy') }
    request.mockResolvedValueOnce({ acknowledged: [], conflicts: [remote], records: [remote], cursor: 1, hasMore: false })
      .mockImplementationOnce(async (_path, _method, input) => ({
        acknowledged: (input as { changes: { collection: string; id: string; mutationId: string }[] }).changes.map(c => ({ ...c, revision: 1 })),
        conflicts: [], records: [], cursor: 2, hasMore: false,
      }))
    await syncAccount(account, vi.fn())
    const records = await db.workouts.toArray()
    expect(records).toHaveLength(2)
    expect(records.map(record => record.notes).sort()).toEqual(['guest copy', 'server copy'])
    expect((await db.sync.toArray()).filter(x => x.dirty)).toHaveLength(0)
  })
})
