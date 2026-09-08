import type { Collection, StoredRecord } from './types'

export const collections: Collection[] = ['workouts', 'programs', 'exercises', 'settings']
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max
const num = (v: unknown, max: number, min = 0) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const integer = (v: unknown, max: number, min = 0) => num(v, max, min) && Number.isInteger(v)
const date = (v: unknown) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v))
const strings = (v: unknown, max = 50) => Array.isArray(v) && v.length <= max && v.every(x => str(x, 2000))
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v)
const plan = (v: unknown) => object(v) && str(v.id) && str(v.name) && Array.isArray(v.exercises) && v.exercises.length > 0 && v.exercises.length <= 100 && v.exercises.every(e => object(e) && str(e.exerciseId) && integer(e.sets, 100, 1) && integer(e.repMin, 1000, 1) && integer(e.repMax, 1000, 1) && Number(e.repMin) <= Number(e.repMax) && integer(e.restSeconds, 3600))

/** Used by both backup imports and authenticated API writes. */
export function validateRecord(collection: Collection, value: unknown): value is StoredRecord {
  if (!object(value) || !str(value.id)) return false
  const v = value
  if (collection === 'settings') return v.id === 'settings' && ['en', 'fi'].includes(String(v.language)) && ['kg', 'lb'].includes(String(v.unit)) && typeof v.onboardingDone === 'boolean' && typeof v.autoRest === 'boolean' && str(v.activeProgramId) && Array.isArray(v.trainingDays) && v.trainingDays.length > 0 && v.trainingDays.length <= 7 && v.trainingDays.every(d => integer(d, 6))
  if (collection === 'programs') return str(v.name) && str(v.description, 4000) && integer(v.daysPerWeek, 7, 1) && str(v.duration) && str(v.focus) && str(v.level) && Array.isArray(v.workouts) && v.workouts.length > 0 && v.workouts.length <= 14 && v.workouts.every(plan)
  if (collection === 'exercises') return str(v.name) && strings(v.primary) && strings(v.secondary) && str(v.equipment) && ['Beginner', 'Intermediate'].includes(String(v.difficulty)) && Array.isArray(v.repRange) && v.repRange.length === 2 && v.repRange.every(n => integer(n, 1000, 1)) && integer(v.restSeconds, 3600) && strings(v.instructions) && strings(v.mistakes)
  if (collection !== 'workouts') return false
  return str(v.programId) && str(v.workoutId) && str(v.workoutName) && date(v.startedAt) && optional(v.finishedAt, date) && optional(v.updatedAt, date) && optional(v.durationSeconds, n => num(n, 31536000)) && optional(v.notes, n => typeof n === 'string' && n.length <= 10000) && optional(v.plan, plan) && optional(v.progress, p => object(p) && integer(p.exerciseIndex, 99) && (p.restEndsAt === null || num(p.restEndsAt, 8640000000000000))) && Array.isArray(v.exercises) && v.exercises.length > 0 && v.exercises.length <= 100 && v.exercises.every(e => object(e) && str(e.exerciseId) && Array.isArray(e.sets) && e.sets.length <= 100 && new Set(e.sets.map(s => object(s) ? s.id : null)).size === e.sets.length && e.sets.every(s => object(s) && str(s.id) && num(s.weightKg, 1000) && integer(s.reps, 1000) && typeof s.completed === 'boolean' && optional(s.warmup, b => typeof b === 'boolean') && optional(s.weightInput, n => typeof n === 'string' && n.length <= 16) && optional(s.repsInput, n => typeof n === 'string' && n.length <= 16) && optional(s.inputUnit, n => n === 'kg' || n === 'lb'))) && (!v.finishedAt || Date.parse(String(v.finishedAt)) >= Date.parse(String(v.startedAt))) && (!v.progress || Number((v.progress as Record<string, unknown>).exerciseIndex) < v.exercises.length)
}

export function parseBackup(json: string): Record<Collection, StoredRecord[]> {
  if (json.length > 20_000_000) throw new Error('Backup is too large (maximum 20 MB).')
  const v: unknown = JSON.parse(json)
  if (!object(v) || ![1, 2].includes(Number(v.version))) throw new Error('This is not a supported IRONLOG backup.')
  for (const c of collections) {
    const list = v[c]
    if (!Array.isArray(list) || list.length > 10000 || !list.every(x => validateRecord(c, x)) || new Set(list.map(x => x.id)).size !== list.length) throw new Error(`Invalid ${c} in backup. Your existing data has not been changed.`)
  }
  if ((v.settings as unknown[]).length !== 1) throw new Error('Backup must contain exactly one settings record.')
  return v as Record<Collection, StoredRecord[]>
}
