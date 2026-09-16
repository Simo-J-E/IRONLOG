import { describe, expect, it } from 'vitest'
import { programs } from './data'
import { addDays, localDateKey, parseLocalDate, scheduledWorkout, upcomingWorkouts } from './schedule'
import { validateRecord } from './validation'
import type { Settings, WorkoutLog } from './types'

const settings: Settings = { id: 'settings', language: 'en', unit: 'kg', onboardingDone: true, activeProgramId: 'chest-arms', trainingDays: [5, 1, 3], autoRest: true, scheduleStartDate: '2026-09-14' }
const upper = programs.find(program => program.id === 'chest-arms')!
const date = parseLocalDate

describe('calendar scheduling', () => {
  it('assigns Monday/Wednesday/Friday by weekday order, independent of click order or missed sessions', () => {
    expect(scheduledWorkout(upper, settings, date('2026-09-14'))?.id).toBe('ca-a')
    expect(scheduledWorkout(upper, settings, date('2026-09-16'))?.id).toBe('ca-b')
    expect(scheduledWorkout(upper, settings, date('2026-09-18'))?.id).toBe('ca-c')
    expect(scheduledWorkout(upper, settings, date('2026-09-23'))?.id).toBe('ca-b')
    expect(scheduledWorkout(upper, settings, date('2026-09-15'))).toBeUndefined()
  })
  it('alternates two sessions over a three-day week, including the next week', () => {
    const program = programs.find(program => program.id === 'beginner-full')!
    expect(['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21', '2026-09-23', '2026-09-25'].map(key => scheduledWorkout(program, settings, date(key))?.id)).toEqual(['bf-a', 'bf-b', 'bf-a', 'bf-b', 'bf-a', 'bf-b'])
  })
  it('keeps Sunday last and preserves dates through DST and year boundaries', () => {
    const sunday = { ...settings, trainingDays: [0, 3, 1], scheduleStartDate: '2026-10-19' }
    expect(scheduledWorkout(upper, sunday, date('2026-10-25'))?.id).toBe('ca-c')
    expect(scheduledWorkout(upper, sunday, date('2026-10-26'))?.id).toBe('ca-a')
    expect(scheduledWorkout(upper, { ...settings, scheduleStartDate: '2026-12-28' }, date('2027-01-01'))?.id).toBe('ca-c')
    expect(localDateKey(addDays(date('2026-10-25'), 1))).toBe('2026-10-26')
  })
  it('shows the next training date on rest days and does not suggest a workout already completed today', () => {
    const log: WorkoutLog = { id: 'done', programId: upper.id, workoutId: 'ca-b', workoutName: 'Upper B', startedAt: date('2026-09-16').toISOString(), finishedAt: date('2026-09-16').toISOString(), exercises: [] }
    expect(upcomingWorkouts(upper, settings, [], date('2026-09-15'))[0]?.workout.id).toBe('ca-b')
    const next = upcomingWorkouts(upper, settings, [log], date('2026-09-16'))[0]!
    expect(localDateKey(next.date)).toBe('2026-09-18')
    expect(next.workout.id).toBe('ca-c')
  })
  it('never invents planned workouts before the current schedule started', () => {
    expect(scheduledWorkout(upper, { ...settings, scheduleStartDate: '2026-09-16' }, date('2026-09-14'))).toBeUndefined()
    expect(scheduledWorkout(upper, { ...settings, scheduleStartDate: '2026-09-16' }, date('2026-09-16'))?.id).toBe('ca-b')
  })
  it('accepts old settings while rejecting impossible calendar dates and duplicate training days', () => {
    expect(validateRecord('settings', { ...settings, scheduleStartDate: undefined })).toBe(true)
    expect(validateRecord('settings', { ...settings, scheduleStartDate: '2026-02-30' })).toBe(false)
    expect(validateRecord('settings', { ...settings, trainingDays: [1, 1, 3] })).toBe(false)
  })
})
