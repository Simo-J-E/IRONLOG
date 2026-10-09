import { backup } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** Create a consistent copy of the LIVE SQLite database (including WAL data).
 * Backup files live on the persistent volume, but MUST also be copied off-server.
 */
export async function snapshotDatabase(db, directory, keep = 28) {
  if (!Number.isSafeInteger(keep) || keep < 1 || keep > 365) throw new Error('Invalid backup retention count.')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const name = `ironlog-${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(4).toString('hex')}.sqlite`
  const destination = join(directory, name)
  try {
    await backup(db, destination)
    await chmod(destination, 0o600)
  } catch (error) {
    await rm(destination, { force: true }).catch(() => {})
    throw error
  }
  const old = (await readdir(directory)).filter(file => /^ironlog-\d{4}-\d{2}-\d{2}T.*-[a-f0-9]{8}\.sqlite$/.test(file)).sort().reverse().slice(keep)
  for (const file of old) await rm(join(directory, file))
  return destination
}
