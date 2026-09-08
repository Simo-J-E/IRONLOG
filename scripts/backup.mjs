import { DatabaseSync, backup } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
const destination = resolve(process.argv[2] || `backups/ironlog-${new Date().toISOString().replaceAll(':', '-')}.sqlite`)
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
const db = new DatabaseSync(process.env.DATABASE_PATH || './data/ironlog.sqlite', { readOnly: true })
try { await backup(db, destination); console.log(`Backup saved to ${destination}`) } finally { db.close() }
