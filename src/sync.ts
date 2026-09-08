import { api, ApiError } from './account'
import { applyRemote, db, flushWrites, recoverWorkout, table } from './storage'
import { collections, validateRecord } from './validation'
import type { Account, RemoteRecord, SyncState } from './types'

export interface SyncStatus { state: 'local' | 'syncing' | 'synced' | 'offline' | 'error' | 'conflict'; message: string; pending: number; conflicts: SyncState[] }
export const localStatus: SyncStatus = { state: 'local', message: 'Saved on this device', pending: 0, conflicts: [] }
interface SyncResponse {
  acknowledged: { collection: RemoteRecord['collection']; id: string; revision: number; mutationId: string }[]
  conflicts: RemoteRecord[]
  records: RemoteRecord[]
  cursor: number
  hasMore: boolean
}
let inFlight: Promise<void> | null = null
export function syncAccount(account: Account, report: (status: SyncStatus) => void) {
  if (inFlight) return inFlight
  inFlight = performSync(account, report).finally(() => { inFlight = null })
  return inFlight
}
export const waitForSync = async () => { await inFlight }
async function performSync(account: Account, report: (status: SyncStatus) => void) {
  const store = db
  if (store.name !== `ironlog-account-${account.id}`) return
  let pending = 0
  let conflicts: SyncState[] = []
  try {
    await flushWrites()
    await recoverWorkout(store)
    if (!navigator.onLine) throw new Error('offline')
    report({ state: 'syncing', message: 'Syncing…', pending, conflicts })
    let more = true
    // Bound one pass. Further records resume on the next local edit/reconnect/interval.
    for (let pass = 0; more && pass < 20; pass++) {
      if (store !== db) return
      const changes = await store.transaction('r', [...collections.map(c => table(store, c)), store.sync], async () => {
        const dirty = (await store.sync.where('dirty').equals(1).toArray()).filter(s => !s.conflict).slice(0, 25)
        return Promise.all(dirty.map(async s => ({ collection: s.collection, id: s.id, revision: s.revision, mutationId: s.mutationId, data: await table(store, s.collection).get(s.id) ?? null })))
      })
      const cursor = Number((await store.meta.get('cursor'))?.value ?? 0)
      const result = await api<SyncResponse>('/sync', 'POST', { accountId: account.id, cursor, changes })
      if (store !== db) return
      for (const record of [...result.records, ...result.conflicts]) if (!collections.includes(record.collection) || (record.data !== null && !validateRecord(record.collection, record.data))) throw new Error('The server returned invalid data. Your device copy was kept.')
      await store.transaction('rw', [...collections.map(c => table(store, c)), store.sync, store.meta], async () => {
        for (const ack of result.acknowledged) {
          const key = `${ack.collection}:${ack.id}`
          const latest = await store.sync.get(key)
          if (latest) await store.sync.put({ ...latest, revision: ack.revision, dirty: latest.mutationId === ack.mutationId ? 0 : 1, conflict: undefined })
        }
        for (const remote of result.conflicts) {
          const state = await store.sync.get(`${remote.collection}:${remote.id}`)
          if (state) await store.sync.put({ ...state, conflict: remote })
        }
        for (const remote of result.records) await applyRemote(store, remote)
        await store.meta.put({ key: 'cursor', value: result.cursor })
      })
      const states = await store.sync.where('dirty').equals(1).toArray()
      conflicts = states.filter(s => s.conflict)
      pending = states.length
      more = result.hasMore || states.some(s => !s.conflict)
    }
    report({ state: conflicts.length ? 'conflict' : pending ? 'syncing' : 'synced', message: conflicts.length ? 'Choose which version to keep' : pending ? 'More changes waiting to sync' : 'Synced to your account', pending, conflicts })
    window.dispatchEvent(new Event('ironlog-remote-change'))
  } catch (err) {
    if (store !== db) return
    pending = await store.sync.where('dirty').equals(1).count().catch(() => 0)
    report({ state: err instanceof ApiError ? 'error' : 'offline', message: err instanceof ApiError ? err.message : 'Saved on this device. Sync will retry when connected.', pending, conflicts })
  }
}
