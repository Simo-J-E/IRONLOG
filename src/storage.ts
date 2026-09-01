import Dexie, { type Table } from 'dexie'
import type { Exercise, Program, Settings, WorkoutLog } from './types'
import { exercises, programs } from './data'

class IronlogDB extends Dexie {
  workouts!: Table<WorkoutLog, string>
  programs!: Table<Program, string>
  exercises!: Table<Exercise, string>
  settings!: Table<Settings, string>

  constructor() {
    super('ironlog')
    this.version(1).stores({
      workouts: 'id, programId, workoutId, startedAt, finishedAt',
      programs: 'id, name, custom',
      exercises: 'id, name, custom',
      settings: 'id'
    })
  }
}

export const db = new IronlogDB()

export async function seedDatabase() {
  if (await db.programs.count() === 0) await db.programs.bulkPut(programs)
  if (await db.exercises.count() === 0) await db.exercises.bulkPut(exercises)
  if (!(await db.settings.get('settings'))) {
    const browserFi = navigator.language.toLowerCase().startsWith('fi')
    await db.settings.put({ id:'settings', language:browserFi ? 'fi':'en', unit:'kg', onboardingDone:false, activeProgramId:'chest-arms', trainingDays:[1,3,5], autoRest:true })
  }
}

export async function exportAllData() {
  return JSON.stringify({
    version:1,
    exportedAt:new Date().toISOString(),
    settings: await db.settings.toArray(),
    programs: await db.programs.toArray(),
    exercises: await db.exercises.toArray(),
    workouts: await db.workouts.toArray()
  }, null, 2)
}

export async function importAllData(json: string) {
  const parsed = JSON.parse(json) as { settings?: Settings[]; programs?: Program[]; exercises?: Exercise[]; workouts?: WorkoutLog[] }
  await db.transaction('rw', db.settings, db.programs, db.exercises, db.workouts, async () => {
    if (parsed.settings) { await db.settings.clear(); await db.settings.bulkPut(parsed.settings) }
    if (parsed.programs) { await db.programs.clear(); await db.programs.bulkPut(parsed.programs) }
    if (parsed.exercises) { await db.exercises.clear(); await db.exercises.bulkPut(parsed.exercises) }
    if (parsed.workouts) { await db.workouts.clear(); await db.workouts.bulkPut(parsed.workouts) }
  })
}

export async function deleteAllData() {
  await Promise.all([db.workouts.clear(), db.programs.clear(), db.exercises.clear(), db.settings.clear()])
  await seedDatabase()
}
