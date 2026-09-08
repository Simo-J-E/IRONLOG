import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './account'
import { db, switchDatabase, saveWorkout, putRecord, timestamp, resolveConflict, exportAllData } from './storage'
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
  it('preserves both sides of a conflict until a choice is made and backs up the discarded version', async () => {
    const local = { ...draft(), notes: 'local copy' }; await saveWorkout(local)
    const remote = { collection: 'workouts' as const, id: 'w1', revision: 2, data: { ...local, notes: 'other device' } }
    request.mockResolvedValue({ acknowledged: [], conflicts: [remote], records: [remote], cursor: 2, hasMore: false })
    const report = vi.fn<(status: SyncStatus) => void>(); await syncAccount(account, report)
    expect((await db.workouts.get('w1'))?.notes).toBe('local copy')
    expect(report.mock.lastCall?.[0].state).toBe('conflict')
    expect(JSON.parse(await exportAllData()).unresolvedConflicts[0].conflict.data.notes).toBe('other device')
    await resolveConflict((await db.sync.get('workouts:w1'))!, false)
    expect((await db.workouts.get('w1'))?.notes).toBe('other device')
    expect(JSON.parse(await exportAllData()).conflictBackups[0].value.local.notes).toBe('local copy')
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
