import { describe, expect, it } from 'vitest'
import { exercises, programs } from './data'
import { validateRecord } from './validation'
import { scheduledWorkout, parseLocalDate } from './schedule'
import type { Settings } from './types'

const four = programs.find(p => p.id === 'chest-arms')!
const three = programs.find(p => p.id === 'hollywood-heavy-3')!

describe('Hollywood Heavy programming', () => {
  it('replaces the existing featured program in place so prior selections upgrade', () => {
    expect(four).toMatchObject({ featured: true, daysPerWeek: 4, revision: 3 })
    expect(four.workouts).toHaveLength(4)
    expect(three).toMatchObject({ daysPerWeek: 3 })
    expect(three.workouts).toHaveLength(3)
  })

  it('contains valid exercises, challenging rep targets and enough time to recover', () => {
    const known = new Set(exercises.map(exercise => exercise.id))
    for (const program of [three, four]) {
      expect(validateRecord('programs', program)).toBe(true)
      for (const workout of program.workouts) {
        expect(workout.exercises.length).toBeGreaterThanOrEqual(6)
        for (const exercise of workout.exercises) {
          expect(known.has(exercise.exerciseId)).toBe(true)
          expect(exercise.sets).toBeGreaterThanOrEqual(2)
          expect(exercise.repMax).toBeLessThanOrEqual(15)
          expect(exercise.restSeconds).toBeGreaterThanOrEqual(75)
          expect(exercise.note).toBeTruthy()
        }
      }
    }
  })

  it('rotates through all four workouts in a normal four-day week', () => {
    const settings: Settings = { id: 'settings', language: 'en', unit: 'kg', onboardingDone: true, activeProgramId: four.id, trainingDays: [1, 2, 4, 6], autoRest: true, scheduleStartDate: '2026-10-05' }
    const dates = ['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-10']
    expect(dates.map(date => scheduledWorkout(four, settings, parseLocalDate(date))?.id)).toEqual(four.workouts.map(workout => workout.id))
  })
})
