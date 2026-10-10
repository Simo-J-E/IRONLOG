import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './account'
import { db, switchDatabase, saveWorkout, putRecord, timestamp, exportAllData, removeRecord } from './storage'
import { syncAccount, type SyncStatus } from './sync'
import type { Account, WorkoutLog } from './types'
vi.mock('./account', async original => { const actual = await original<typeof import('./account')>(); return { ...actual, api: vi.fn() } })
const request = vi.mocked(api)
const account: Account = { id: 'account-sync', username: 'lifter', ranked: false }
const draft = (): WorkoutLog => ({ id: 'w1', programId: 'chest-arms', workoutId: 'a', workoutName: 'A', startedAt: '2026-01-01T12:00:00Z', updatedAt: timestamp(), exercises: [{ exerciseId: 'bench-press', sets: [{ id: 's1', weightKg: 80, reps: 8, completed: false }] }] })
beforeEach(async () => { localStorage.clear(); await switchDatabase(account.id); await db.delete(); await switchDatabase(account.id); request.mockReset() })
afterEach(async () => { await db.delete() })

describe('account sync', () => {
  it('keeps offline edits queued and retries them successfully when the connection returns', async () => {
    const log = draft(); await saveWorkout(log)
    request.mockRejectedValueOnce(new TypeError('Offline'))
    const report = vi.fn<(status: SyncStatus) => void>()
    await syncAccount(account, report)
    expect(report.mock.lastCall?.[0].state).toBe('offline')
    expect((await db.sync.get('workouts:w1'))?.dirty).toBe(1)
    request.mockImplementationOnce(async (_path, _method, body) => {
      const input = body as { changes: { mutationId: string }[] }
      return { acknowledged: [{ collection: 'workouts', id: 'w1', revision: 1, mutationId: input.changes[0]!.mutationId }], conflicts: [], records: [], cursor: 1, hasMore: false }
    })
    await syncAccount(account, report)
    expect(report.mock.lastCall?.[0].state).toBe('synced')
    expect((await db.sync.get('workouts:w1'))?.dirty).toBe(0)
  })
  it('does not clear an edit made while an older version is uploading', async () => {
    const log = draft(); await saveWorkout(log)
    request.mockImplementationOnce(async (_path, _method, body) => {
      const input = body as { changes: { mutationId: string }[] }
      await saveWorkout({ ...log, updatedAt: timestamp(), notes: 'typed while uploading' })
      return { acknowledged: [{ collection: 'workouts', id: 'w1', revision: 1, mutationId: input.changes[0]!.mutationId }], conflicts: [], records: [{ collection: 'workouts', id: 'w1', revision: 1, data: log }], cursor: 1, hasMore: false }
    }).mockImplementationOnce(async (_path, _method, body) => {
      const input = body as { changes: { mutationId: string; revision: number; data: WorkoutLog }[] }
      expect(input.changes[0]!.revision).toBe(1)
      expect(input.changes[0]!.data.notes).toBe('typed while uploading')
      return { acknowledged: [{ collection: 'workouts', id: 'w1', revision: 2, mutationId: input.changes[0]!.mutationId }], conflicts: [], records: [], cursor: 2, hasMore: false }
    })
    await syncAccount(account, vi.fn())
    expect((await db.workouts.get('w1'))?.notes).toBe('typed while uploading')
    expect((await db.sync.get('workouts:w1'))?.dirty).toBe(0)
  })
  it('merges simultaneous edits as separate workouts without interrupting the user', async () => {
    const local = { ...draft(), notes: 'local copy' }; await saveWorkout(local)
    const remote = { collection: 'workouts' as const, id: 'w1', revision: 2, data: { ...local, notes: 'other device' } }
    request.mockResolvedValueOnce({ acknowledged: [], conflicts: [remote], records: [remote], cursor: 2, hasMore: false })
      .mockImplementation(async (_path, _method, body) => {
        const changes = (body as { changes: { collection: string; id: string; mutationId: string }[] }).changes
        return { acknowledged: changes.map(c => ({ ...c, revision: 1 })), conflicts: [], records: [], cursor: 3, hasMore: false }
      })
    const report = vi.fn<(status: SyncStatus) => void>(); await syncAccount(account, report)
    expect(report.mock.lastCall?.[0].state).toBe('synced')
    expect(report.mock.lastCall?.[0].conflicts).toHaveLength(0)
    const copies = await db.workouts.toArray()
    expect(copies.map(x => x.notes).sort()).toEqual(['local copy', 'other device'])
    expect(new Set(copies.map(x => x.id)).size).toBe(2)
    expect((await db.sync.toArray()).filter(x => x.dirty)).toHaveLength(0)
    expect(JSON.parse(await exportAllData()).conflictBackups[0].value.local.notes).toBe('local copy')
  })
  it('auto-clears old exercise conflicts from previous versions on next sync', async () => {
    const exercise = (await db.exercises.get('bench-press'))!
    const local = { ...exercise, instructions: ['local exercise instructions'] }
    const remote = { collection: 'exercises' as const, id: exercise.id, revision: 5, data: exercise }
    await putRecord('exercises', local)
    await db.sync.update('exercises:bench-press', { conflict: remote })
    request.mockResolvedValue({ acknowledged: [], conflicts: [], records: [remote], cursor: 10, hasMore: false })
    const report = vi.fn<(status: SyncStatus) => void>(); await syncAccount(account, report)
    expect(report.mock.lastCall?.[0].state).toBe('synced')
    expect((await db.exercises.get(exercise.id))?.instructions).toEqual(exercise.instructions)
    expect((await db.sync.get('exercises:bench-press'))?.conflict).toBeUndefined()
    expect((await db.exercises.toArray()).filter(x => x.id !== exercise.id && x.name === exercise.name)).toHaveLength(0)
    expect(JSON.parse(await exportAllData()).conflictBackups[0].value.local.instructions).toEqual(local.instructions)
  })
  it('auto-resolves a fresh collision on a built-in exercise without making duplicate exercises', async () => {
    const original = (await db.exercises.get('bench-press'))!
    await putRecord('exercises', { ...original, instructions: ['offline change'] })
    const remote = { collection: 'exercises' as const, id: original.id, revision: 3, data: original }
    request.mockResolvedValue({ acknowledged: [], conflicts: [remote], records: [remote], cursor: 3, hasMore: false })
    const report = vi.fn<(status: SyncStatus) => void>(); await syncAccount(account, report)
    expect(report.mock.lastCall?.[0].state).toBe('synced')
    expect((await db.exercises.get(original.id))?.instructions).toEqual(original.instructions)
    expect(await db.exercises.count()).toBeGreaterThan(0)
    expect((await db.sync.toArray()).filter(x => x.conflict)).toHaveLength(0)
  })
  it('keeps a custom program from each device when both changed the same ID', async () => {
    const original = (await db.programs.get('chest-arms'))!
    const local = { ...original, id: 'custom-program', name: 'Phone plan', custom: true }
    await putRecord('programs', local)
    const remote = { collection: 'programs' as const, id: local.id, revision: 1, data: { ...local, name: 'Laptop plan' } }
    request.mockResolvedValueOnce({ acknowledged: [], conflicts: [remote], records: [], cursor: 1, hasMore: false })
      .mockImplementation(async (_path, _method, body) => ({
        acknowledged: (body as { changes: { collection: string; id: string; mutationId: string }[] }).changes.map(c => ({ ...c, revision: 1 })),
        conflicts: [], records: [], cursor: 2, hasMore: false,
      }))
    await syncAccount(account, vi.fn())
    const plans = (await db.programs.toArray()).filter(x => x.name.endsWith('plan'))
    expect(plans.map(x => x.name).sort()).toEqual(['Laptop plan', 'Phone plan'])
    expect(new Set(plans.map(x => x.id)).size).toBe(2)
  })
  it('keeps a local deletion queued after the remote version changes', async () => {
    const local = { ...draft(), notes: 'to be deleted' }
    await saveWorkout(local)
    await removeRecord('workouts', local.id)
    const remote = { collection: 'workouts' as const, id: local.id, revision: 3, data: { ...local, notes: 'edited elsewhere' } }
    request.mockResolvedValueOnce({ acknowledged: [], conflicts: [remote], records: [], cursor: 3, hasMore: false })
      .mockImplementationOnce(async (_path, _method, body) => {
        const change = (body as { changes: { data: unknown; revision: number; mutationId: string }[] }).changes[0]!
        expect(change.data).toBeNull()
        expect(change.revision).toBe(3)
        return { acknowledged: [{ collection: 'workouts', id: 'w1', revision: 4, mutationId: change.mutationId }], conflicts: [], records: [], cursor: 4, hasMore: false }
      })
    await syncAccount(account, vi.fn())
    expect(await db.workouts.get(local.id)).toBeUndefined()
    expect((await db.sync.get('workouts:w1'))?.dirty).toBe(0)
    expect(JSON.parse(await exportAllData()).conflictBackups[0].value.remote.data.notes).toBe('edited elsewhere')
  })
  it('downloads a draft and ignores attempts to sync the current database into another account', async () => {
    const remote = { collection: 'workouts', id: 'w1', revision: 1, data: draft() }
    request.mockResolvedValue({ acknowledged: [], conflicts: [], records: [remote], cursor: 1, hasMore: false })
    await syncAccount(account, vi.fn()); expect(await db.workouts.get('w1')).toEqual(remote.data)
    request.mockClear(); await syncAccount({ ...account, id: 'other-account' }, vi.fn()); expect(request).not.toHaveBeenCalled()
  })
  it('keeps the device copy when authentication expires', async () => {
    const log = draft(); await putRecord('workouts', log)
    request.mockRejectedValue(new ApiError('Sign in again', 401))
    const report = vi.fn<(status: SyncStatus) => void>(); await syncAccount(account, report)
    expect(report.mock.lastCall?.[0].state).toBe('error'); expect(await db.workouts.get('w1')).toEqual(log)
  })
})
