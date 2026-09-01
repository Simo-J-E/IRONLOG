import type { LoggedSet, WorkoutLog } from './types'

export const epley = (weightKg: number, reps: number) => weightKg * (1 + reps / 30)
export const kgToLb = (kg: number) => kg * 2.2046226218
export const lbToKg = (lb: number) => lb / 2.2046226218
export const displayWeight = (kg: number, unit: 'kg'|'lb') => unit === 'kg' ? kg : kgToLb(kg)
export const inputToKg = (value: number, unit: 'kg'|'lb') => unit === 'kg' ? value : lbToKg(value)
export const roundWeight = (value: number) => Math.round(value * 10) / 10
export const volume = (sets: LoggedSet[]) => sets.filter(s => s.completed && !s.warmup).reduce((sum,s) => sum + s.weightKg*s.reps,0)
export const workoutVolume = (workout: WorkoutLog) => workout.exercises.reduce((sum,e)=>sum+volume(e.sets),0)

export function detectNewPr(previous: WorkoutLog[], exerciseId: string, sets: LoggedSet[]) {
  const priorSets = previous.flatMap(w => w.exercises.find(e=>e.exerciseId===exerciseId)?.sets ?? []).filter(s=>s.completed && !s.warmup)
  const oldBest = Math.max(0, ...priorSets.map(s=>epley(s.weightKg,s.reps)))
  const newBest = Math.max(0, ...sets.filter(s=>s.completed && !s.warmup).map(s=>epley(s.weightKg,s.reps)))
  return { isPr: newBest > oldBest + 0.01, oldBest, newBest }
}
