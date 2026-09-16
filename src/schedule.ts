import type { Program, Settings, WorkoutLog } from './types'

export const weekOrder = [1, 2, 3, 4, 5, 6, 0]
export const orderedDays = (days: number[]) => weekOrder.filter(day => days.includes(day))
export const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const parseLocalDate = (key: string) => { const [year, month, day] = key.split('-').map(Number); return new Date(year!, month! - 1, day!, 12) }
export const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12)
export const startOfWeek = (date: Date) => addDays(date, -((date.getDay() + 6) % 7))
// Calendar-day arithmetic avoids 23/25-hour days at daylight-saving changes.
const ordinal = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
export const locale = (settings: Pick<Settings, 'language'>) => settings.language === 'fi' ? 'fi-FI' : 'en-GB'
export const fullDate = (date: Date, settings: Pick<Settings, 'language'>) => new Intl.DateTimeFormat(locale(settings), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
export const weekdayName = (day: number, language: Settings['language'], short = false) => new Intl.DateTimeFormat(language === 'fi' ? 'fi-FI' : 'en-GB', { weekday: short ? 'short' : 'long' }).format(new Date(2026, 8, 6 + day, 12))

/** A fixed date determines the workout; completing or skipping a session never shifts it. */
export function scheduledWorkout(program: Program | undefined, settings: Settings, date: Date) {
  if (!program?.workouts.length) return undefined
  const days = orderedDays(settings.trainingDays)
  const position = days.indexOf(date.getDay())
  const start = parseLocalDate(settings.scheduleStartDate ?? localDateKey(new Date()))
  if (position < 0 || localDateKey(date) < localDateKey(start)) return undefined
  const weeks = Math.floor((ordinal(startOfWeek(date)) - ordinal(startOfWeek(start))) / 7)
  return program.workouts[(weeks * days.length + position) % program.workouts.length]
}

export const logsOnDate = (logs: WorkoutLog[], date: Date) => logs.filter(log => localDateKey(new Date(log.startedAt)) === localDateKey(date))
export function upcomingWorkouts(program: Program | undefined, settings: Settings, logs: WorkoutLog[], from = new Date(), count = 3) {
  const result: { date: Date; workout: NonNullable<ReturnType<typeof scheduledWorkout>> }[] = []
  for (let offset = 0; offset < 56 && result.length < count; offset++) {
    const date = addDays(from, offset)
    const workout = scheduledWorkout(program, settings, date)
    if (workout && !logsOnDate(logs, date).some(log => log.finishedAt && log.programId === program?.id && log.workoutId === workout.id)) result.push({ date, workout })
  }
  return result
}
